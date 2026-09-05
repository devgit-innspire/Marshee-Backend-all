const crypto = require("crypto");
const axios = require('axios');
const mongoose = require('mongoose');
const { randomUUID } = crypto;
const { StandardCheckoutClient, Env, StandardCheckoutPayRequest } = require("pg-sdk-node");
const { StatusCodes } = require('http-status-codes');
const Order = require('../models/order.model');
// const Order = require('../models/order.model.improved');
const Cart = require('../models/cart.model');
const User = require('../models/user.model');
const Address = require('../models/address.model');
const Partner = require('../models/partner.model');
const ErrorResponse = require('../utils/errorResponse');
const phonepeConfig = require("../config/phonePeConfig");
const razorpayService = require("../config/razorpayService");
const razorpayConfig = require("../config/razorpayConfig");
const { resolvePreOrderAmount } = require("../config/preOrderPricing");
const { PreOrder, PreOrderPayment } = require('../models/preOrderForm.model');
const WogglePreOrder = require('../models/wogglePreOrder.model');
const { createShiprocketOrderOnPaymentComplete } = require('../utils/shiprocket.orderHelper');
const { sendZapierEmail } = require('../utils/zapierEmailService');
const { queuePurchaseCapiEvent, queueInitiateCheckoutCapiEvent } = require('../utils/metaCapi');
const {
    buildEventId,
    ensureMetaPurchaseEventId,
    getMetaPurchaseSuccessQueryParams
} = require('../utils/metaPurchaseEventId');
const { createSubscriptionForServiceOrderItem } = require('./helpers/serviceSubscription.helper');

/**
 * Shown to the customer when a gateway refuses to start a payment.
 * Gateway strings (e.g. Paytm's "System Error") are internal diagnostics and must
 * never reach the storefront — they are logged server-side by logGatewayFailure.
 */
const PAYMENT_INIT_FAILED_MESSAGE =
    "We couldn't start the payment right now. Please try again in a moment, or use a different payment method.";

/**
 * Log the raw gateway failure with enough context to trace it, keeping the
 * technical detail server-side.
 */
const logGatewayFailure = (gateway, context = {}) => {
    console.error(`[${gateway}] payment initiation failed`, {
        ...context,
        at: new Date().toISOString()
    });
};

const buildUrlWithParams = (baseUrl, params = {}) => {
    if (!baseUrl) {
        return '';
    }
    try {
        const url = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    } catch (error) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        const query = Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        return query ? `${baseUrl}${separator}${query}` : baseUrl;
    }
};

/**
 * Constant-time comparison of two hex signatures.
 *
 * crypto.timingSafeEqual throws a RangeError when the buffers differ in length, and the
 * signature is attacker-controlled - so the length is checked first and a mismatch returns
 * false instead of blowing up into the catch block.
 */
function safeSignatureEqual(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(received, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Compare the amount a gateway reports against what we expect to be paid.
 * Both sides are normalised to integer paise so floating point never decides
 * whether an order is honoured.
 */
function amountsMatch(expectedRupees, receivedPaise) {
    const expectedPaise = Math.round(Number(expectedRupees) * 100);
    return Number.isFinite(expectedPaise) && expectedPaise === Number(receivedPaise);
}

async function deductStockForOrder(order) {
    try {
        console.log("📦 ========== Initiating Stock Deduction ==========");
        console.log("📦 Order ID:", order._id);
        const session = await mongoose.startSession();
        let lowStockAlertsByPartnerId = new Map();

        await session.withTransaction(async () => {
            const Product = require('../models/product.model');

            const lockedOrder = await Order.findById(order._id).session(session);
            if (!lockedOrder) return;

            lockedOrder.inventory = lockedOrder.inventory || {};
            if (lockedOrder.inventory.stockDeducted) {
                console.log("ℹ️  Stock already deducted for this order, skipping deduction");
                return;
            }

            if (lockedOrder.payment?.status !== 'completed' || lockedOrder.status !== 'confirmed') {
                console.log("ℹ️  Order not eligible for stock deduction yet (status/payment mismatch)");
                return;
            }

            for (const item of (lockedOrder.items || [])) {
                if (item.itemType !== 'product' || !item.product) continue;

                if (!item.variant) {
                    throw new Error(`Variant missing on order item for product ${item.product}`);
                }

                const qtyToDeduct = Number(item.quantity || 0);
                if (!Number.isFinite(qtyToDeduct) || qtyToDeduct <= 0) continue;

                // Read current variant stock (for threshold crossing detection)
                const productDoc = await Product.findOne(
                    { _id: item.product, 'variants._id': item.variant },
                    { partner: 1, name: 1, variants: { $elemMatch: { _id: item.variant } } }
                ).session(session);

                if (!productDoc || !productDoc.variants || productDoc.variants.length === 0) {
                    throw new Error(`Product/variant not found for stock deduction. product=${item.product}, variant=${item.variant}`);
                }

                const v = productDoc.variants[0];
                const prevQty = Number(v?.stock?.quantity ?? 0);
                const threshold = Number(v?.stock?.lowStockThreshold ?? 5);

                // Atomic decrement, ensure enough stock
                const updateRes = await Product.updateOne(
                    {
                        _id: item.product,
                        'variants._id': item.variant,
                        'variants.stock.quantity': { $gte: qtyToDeduct }
                    },
                    {
                        $inc: {
                            'variants.$.stock.quantity': -qtyToDeduct,
                            // keep cached aggregatedStock in sync (sum of variants)
                            'inventory.aggregatedStock.total': -qtyToDeduct
                        }
                    }
                ).session(session);

                const modified = updateRes?.modifiedCount ?? updateRes?.nModified ?? 0;
                if (!modified) {
                    throw new Error(`Insufficient stock while confirming order. product=${item.product}, variant=${item.variant}, needed=${qtyToDeduct}`);
                }

                const newQty = prevQty - qtyToDeduct;
                const crossedToLow = prevQty > threshold && newQty <= threshold;

                if (crossedToLow && productDoc.partner) {
                    const partnerId = String(productDoc.partner);
                    const existing = lowStockAlertsByPartnerId.get(partnerId) || [];
                    existing.push({
                        productId: String(productDoc._id),
                        productName: productDoc.name,
                        variantId: String(v._id),
                        variantName: v?.name,
                        sku: v?.sku,
                        newQty,
                        threshold
                    });
                    lowStockAlertsByPartnerId.set(partnerId, existing);
                }
            }

            lockedOrder.inventory.stockDeducted = true;
            lockedOrder.inventory.stockDeductedAt = new Date();
            await lockedOrder.save({ session });
        });

        await session.endSession();

        // Send low stock alerts outside transaction (best-effort)
        for (const [partnerId, variants] of lowStockAlertsByPartnerId.entries()) {
            try {
                const partnerDoc = await Partner.findById(partnerId).select('name contact.email').lean();
                const toEmail = partnerDoc?.contact?.email;
                if (!toEmail) continue;

                const subject = `Low stock alert (${variants.length})`;
                const message = `
                  <h2>Low stock alert</h2>
                  <p><strong>Partner:</strong> ${partnerDoc?.name || ''}</p>
                  <p><strong>Order:</strong> ${order.orderNumber || order._id}</p>
                  <hr/>
                  ${variants.map(x => `
                    <p>
                      <strong>Product:</strong> ${x.productName || x.productId}<br/>
                      <strong>Variant:</strong> ${x.variantName || x.variantId}<br/>
                      <strong>SKU:</strong> ${x.sku || ''}<br/>
                      <strong>Stock:</strong> ${x.newQty} (threshold: ${x.threshold})
                    </p>
                  `).join('')}
                `;

                const { sendZapierEmail } = require('../utils/zapierEmailService');
                if (sendZapierEmail) {
                    const emailRes = await sendZapierEmail({
                        email: toEmail,
                        subject,
                        message,
                        name: partnerDoc?.name
                    });

                    if (!emailRes?.success) {
                        console.warn('low-stock Zapier email failed:', emailRes?.error || emailRes);
                    }
                }
            } catch (e) {
                console.warn('low-stock alert error:', e?.message || e);
            }
        }
        console.log("📦 ========== Stock Deduction Completed ==========");
    } catch (error) {
        console.error('❌ Stock deduction transaction failed:', error.message);
        throw error;
    }
}

// PhonePe configuration (via config/phonePeConfig.js)
const clientId = phonepeConfig.CLIENT_ID;
const clientSecret = phonepeConfig.CLIENT_SECRET;
const clientVersion = Number(phonepeConfig.CLIENT_VERSION || 1);
// const env = (process.env.NODE_ENV === 'production') ? Env.PRODUCTION : Env.UAT;
const env = (process.env.NODE_ENV === 'production') ? Env.PRODUCTION : Env.SANDBOX;


// console.log("clientId:", clientId);
// console.log("clientSecret:", clientSecret);
// console.log("clientVersion:", clientVersion);
// console.log("env:", env);
// console.log("phonepeConfig:", phonepeConfig);


let client = null;
try {
    if (clientId && clientSecret) {
        client = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);
    } else {
        console.warn('PhonePe CLIENT_ID/CLIENT_SECRET not configured. Using sandbox simulation.');
    }
} catch (e) {
    console.warn('PhonePe SDK init failed. Falling back to simulation. Error:', e?.message);
}

class PaymentController {

    async createPaymentFromCart(req, res, next) {
        try {
            const userId = req.user.id;
            console.log("PaymentController createPaymentFromCart userId:", userId);
            const { shippingAddressId, billingAddressId } = req.body;
            console.log("PaymentController createPaymentFromCart shippingAddressId:", shippingAddressId);
            console.log("PaymentController createPaymentFromCart billingAddressId:", billingAddressId);

            const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

            // Get user's cart and addresses
            const [cart, user, shippingAddress, billingAddress] = await Promise.all([
                Cart.findOne({ user: userId })
                    .populate({
                        path: 'items.product',
                        select: 'name sku pricing inventory partner'
                    })
                    .populate({
                        path: 'items.variant',
                        select: 'name attributes price stock commission'
                    })
                    .populate({
                        path: 'items.service',
                        select: 'name slug shortDescription serviceType category pricing images isActive isVerified partner'
                    }),
                User.findById(userId).select('phoneNumber email name'),
                shippingAddressId ? Address.findOne({ _id: shippingAddressId, user: userId, isDeleted: false }) : null,
                billingAddressId ? Address.findOne({ _id: billingAddressId, user: userId, isDeleted: false }) : null
            ]);

            if (!cart || cart.items.length === 0) {
                throw new ErrorResponse('Cart is empty', StatusCodes.BAD_REQUEST);
            }

            // Use provided addresses or get default shipping address
            let finalShippingAddressId, finalBillingAddressId;
            
            // Shipping address resolution
            if (shippingAddressId) {
                if (!isValidObjectId(shippingAddressId)) {
                    throw new ErrorResponse('Invalid shippingAddressId', StatusCodes.BAD_REQUEST);
                }
                if (!shippingAddress) {
                    throw new ErrorResponse('Shipping address not found or does not belong to user', StatusCodes.NOT_FOUND);
                }
                finalShippingAddressId = shippingAddressId;
            } else {
                // No ID provided → try default shipping
                const defaultAddress = await Address.findOne({ user: userId, isDefaultShipping: true, isDeleted: false });
                if (!defaultAddress) {
                    throw new ErrorResponse('No shipping address found. Please add a shipping address first.', StatusCodes.BAD_REQUEST);
                }
                finalShippingAddressId = defaultAddress._id;
            }

            // Billing address resolution
            if (billingAddressId) {
                if (!isValidObjectId(billingAddressId)) {
                    throw new ErrorResponse('Invalid billingAddressId', StatusCodes.BAD_REQUEST);
                }
                if (!billingAddress) {
                    throw new ErrorResponse('Billing address not found or does not belong to user', StatusCodes.NOT_FOUND);
                }
                finalBillingAddressId = billingAddressId;
            } else {
                // Default to shipping address if not provided
                finalBillingAddressId = finalShippingAddressId;
            }

            // Calculate cart totals
            cart.calculateTotals();
            await cart.save();

            // Debug: Log cart totals
            console.log('Cart totals:', {
                subtotal: cart.subtotal,
                totalDiscount: cart.totalDiscount,
                shippingCost: cart.shippingCost,
                totalAmount: cart.totalAmount
            });

            // Create order from cart
            // Filter out items with missing products/services before creating order items
            const validCartItems = cart.items.filter(item => {
              const itemType = item.itemType || (item.service ? 'service' : 'product');
              
              if (itemType === 'service') {
                if (!item.service) {
                  console.warn(`Cart item has null service, skipping: ${item._id}`);
                  return false;
                }
              } else {
                if (!item.product) {
                  console.warn(`Cart item has null product, skipping: ${item._id}`);
                  return false;
                }
              }
              return true;
            });

            // Validate that we have at least one valid item
            if (validCartItems.length === 0) {
              throw new ErrorResponse('Cart contains no valid items. Some products/services may have been deleted.', StatusCodes.BAD_REQUEST);
            }

            const orderItems = await Promise.all(validCartItems.map(async (item) => {
              const itemType = item.itemType || (item.service ? 'service' : 'product');
              
              // Handle Services
              if (itemType === 'service') {
                const service = item.service;
                if (!service) {
                  throw new ErrorResponse(`Service not found for cart item ${item._id}`, StatusCodes.NOT_FOUND);
                }
                
                // Use cart item's prices (already calculated correctly)
                // Fallback to service pricing if cart item prices are missing
                const originalPrice = Number(item.originalPrice ?? service.pricing?.mrp ?? service.pricing?.listPrice ?? 0);
                const price = Number(item.price ?? service.pricing?.listPrice ?? service.pricing?.mrp ?? originalPrice);
                const perUnitDiscount = Number(item.discount ?? 0);
                const quantity = Number(item.quantity ?? 1);
                
                // Calculate extras total (per unit)
                const extrasTotal = item.selectedExtras ? item.selectedExtras.reduce((sum, extra) => sum + (Number(extra.price) || 0), 0) : 0;
                
                // Service commission (if applicable)
                const commissionPercentage = 0;
                const commissionAmount = 0;
                
                // Total price: (listPrice + extrasTotal) * quantity (discount applied at order level)
                const totalPrice = Math.max(0, ((price + extrasTotal) * quantity) - (perUnitDiscount * quantity));
                
                // Handle partner - service.partner is an embedded schema with partnerId field
                const partnerId = (service.partner && typeof service.partner === 'object' && service.partner.partnerId) 
                  ? service.partner.partnerId 
                  : null;
                
                const subscriptionId = await createSubscriptionForServiceOrderItem({
                  userId,
                  service,
                  cartItem: item,
                  quantity,
                  amountPaid: totalPrice
                });

                return {
                  itemType: 'service',
                  service: service._id,
                  subscription: subscriptionId,
                  name: service.name || 'Service',
                  quantity,
                  price,
                  originalPrice,
                  discount: perUnitDiscount,
                  totalPrice,
                  selectedExtras: item.selectedExtras || [],
                  selectedDate: item.selectedDate || null,
                  serviceNotes: item.notes || null,
                  commission: {
                    percentage: commissionPercentage,
                    amount: commissionAmount
                  },
                  partner: partnerId
                };
              }
              
              // Handle Products
              const commissionPercentage = Number(
                (item.variant && item.variant.commission && item.variant.commission.percentage) ??
                (item.product && item.product.pricing && item.product.pricing.commission && item.product.pricing.commission.percentage) ??
                0
              );
            
              // Prefer item's price; fallback to variant/product price
              const fallbackVariantPrice =
                item.variant && item.variant.price && (item.variant.price.listPrice ?? item.variant.price.price);
              const fallbackProductPrice =
                item.product && item.product.pricing && item.product.pricing.basePrice;
            
              const price = Number(item.price ?? fallbackVariantPrice ?? fallbackProductPrice ?? 0);
              const perUnitDiscount = Number(item.discount ?? 0);
              const quantity = Number(item.quantity ?? 1);
            
              // Guard against NaN
              const commissionAmount = Math.max(
                0,
                Number.isFinite(price) && Number.isFinite(commissionPercentage)
                  ? (price * commissionPercentage) / 100
                  : 0
              );
            
              const totalPrice = Math.max(0, (price - perUnitDiscount) * quantity);
            
                return {
                itemType: 'product',
                product: item.product._id,
                variant: item.variant?._id || null,
                quantity,
                price,
                originalPrice: Number(item.originalPrice ?? price),
                discount: perUnitDiscount,
                totalPrice,
                commission: {
                  percentage: commissionPercentage,
                  amount: commissionAmount
                },
                partner: item.product.partner || null
              };
            }));

            // Fetch address docs so we can set snapshots (required for Shiprocket after payment)
            const [shippingAddrDoc, billingAddrDoc] = await Promise.all([
                Address.findById(finalShippingAddressId),
                Address.findById(finalBillingAddressId)
            ]);
            if (!shippingAddrDoc) {
                throw new ErrorResponse('Shipping address not found', StatusCodes.NOT_FOUND);
            }
            if (!billingAddrDoc) {
                throw new ErrorResponse('Billing address not found', StatusCodes.NOT_FOUND);
            }
            // Address model doesn't store phone/name, so we source buyer phone from the User record.
            const buyerFullName = user?.name || undefined;
            const buyerPhone = user?.phoneNumber || undefined;

            const shippingSnapshot = {
                fullName: buyerFullName,
                phone: buyerPhone,
                line1: shippingAddrDoc.shippingAddress?.street || '',
                city: shippingAddrDoc.shippingAddress?.city || '',
                state: shippingAddrDoc.shippingAddress?.state || '',
                postalCode: shippingAddrDoc.shippingAddress?.postalCode || '',
                country: shippingAddrDoc.shippingAddress?.country || 'IN'
            };
            const billingSnapshot = {
                fullName: buyerFullName,
                phone: buyerPhone,
                line1: billingAddrDoc.billingAddress?.street || '',
                city: billingAddrDoc.billingAddress?.city || '',
                state: billingAddrDoc.billingAddress?.state || '',
                postalCode: billingAddrDoc.billingAddress?.postalCode || '',
                country: billingAddrDoc.billingAddress?.country || 'IN'
            };

            const order = await Order.create({
                user: userId,
                items: orderItems,
                subtotal: cart.subtotal,
                totalDiscount: cart.totalDiscount,
                shippingCost: cart.shippingCost,
                taxAmount: cart.taxAmount,
                totalAmount: cart.totalAmount,
                appliedCoupon: cart.appliedCoupon,
                shippingAddress: finalShippingAddressId,
                billingAddress: finalBillingAddressId,
                contact: {
                    email: user?.email || undefined,
                    phone: user?.phoneNumber || undefined
                },
                shippingAddressSnapshot: shippingSnapshot,
                billingAddressSnapshot: billingSnapshot,
                payment: {
                    method: 'online',
                    status: 'pending'
                },
                shipping: {
                    method: 'Standard Delivery',
                    estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            });

            // Calculate partner payments
            order.calculatePartnerPayments();
            await order.save();

            // Create payment
            const merchantOrderId = randomUUID();
            // const redirectUrl = `${process.env.BASE_URL || 'http://localhost:5001'}/api/v1/payments/check-status?merchantOrderId=${merchantOrderId}`;

            // Update order with payment transaction ID
            order.payment.transactionId = merchantOrderId;
            order.payment.gateway = 'phonepe';
            await order.save();

            // Debug: Log order totals and PhonePe amount
            console.log('Order totals:', {
                subtotal: order.subtotal,
                totalDiscount: order.totalDiscount,
                shippingCost: order.shippingCost,
                taxAmount: order.taxAmount,
                totalAmount: order.totalAmount
            });
            console.log('PhonePe amount being sent:', order.totalAmount);

          // Convert amount to paise (PhonePe expects amount in smallest currency unit)
const amountInPaise = Math.round(order.totalAmount * 100);
console.log('Amount in rupees:', order.totalAmount, 'Amount in paise:', amountInPaise);

// Create PhonePe payment order using SDK
if (!client) {
  throw new ErrorResponse('PhonePe client not initialized properly', StatusCodes.INTERNAL_SERVER_ERROR);
}

// Prefer configured callback URL if present; fallback to API route
const callbackBaseUrl = phonepeConfig.CALLBACK_URL
  ? phonepeConfig.CALLBACK_URL
  : `${process.env.BASE_URL || 'http://localhost:3000'}/payment/status`;

console.log("callbackBaseUrl:", callbackBaseUrl);

const metaPurchaseQs = await getMetaPurchaseSuccessQueryParams(order, {});
const redirectUrl = buildUrlWithParams(callbackBaseUrl, {
  merchantOrderId,
  orderId: metaPurchaseQs.orderId,
  orderNumber: metaPurchaseQs.orderNumber,
  meta_event_id: metaPurchaseQs.meta_event_id,
  value: metaPurchaseQs.value,
  currency: metaPurchaseQs.currency
});

console.log("redirectUrl:", redirectUrl);

const payRequest = StandardCheckoutPayRequest.builder()
  .merchantOrderId(merchantOrderId)
  .amount(amountInPaise)
  .redirectUrl(redirectUrl)
  .build();

 // --- PhonePe OAuth Token Integration ---
      // Prepare token request
      const tokenUrl =
        process.env.NODE_ENV === "production"
          ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
          : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

          console.log("tokenUrl:", tokenUrl);

      const tokenBody = new URLSearchParams({
        client_id: phonepeConfig.CLIENT_ID,
        client_version: phonepeConfig.CLIENT_VERSION,
        client_secret: phonepeConfig.CLIENT_SECRET,
        grant_type: "client_credentials",
      }).toString();

      let phonepeToken = null;
      let tokenExpiresAt = null;
      try {
        // Use axios instead of fetch
        const tokenRes = await axios.post(tokenUrl, tokenBody, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        const tokenJson = tokenRes.data;
        phonepeToken = tokenJson.access_token;
        tokenExpiresAt = tokenJson.expires_at;
      } catch (tokenErr) {
        console.error("PhonePe token fetch error", {
          error: tokenErr.message,
          endpoint: req.originalUrl,
        });
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to fetch PhonePe authorization token",
          error: tokenErr.message,
        });
      }

// Call PhonePe SDK
const phonepeResponse = await client.pay(payRequest);
console.log("PhonePe payment initiated successfully");

// ✅ Return proper checkout URL
const checkoutPageUrl = phonepeResponse.redirectUrl 
  || `https://mercury-t2.phonepe.com/transact/pay/${phonepeResponse.token}`; // Sandbox fallback

// Basic customer info (Address model doesn’t store name/phone/email fields)
const customerInfo = {
  name: user?.name || 'Customer',
  phone: user?.phoneNumber || '9999999999',
  email: user?.email || 'customer@example.com'
};

            // Server-side CAPI InitiateCheckout (best-effort, non-blocking)
            queueInitiateCheckoutCapiEvent({ req, order });

// Send success response with checkout URL
return res.status(StatusCodes.OK).json({
  success: true,
  checkoutPageUrl,
  orderId: order._id,
  orderNumber: order.orderNumber,
  merchantOrderId: merchantOrderId,
  metaPurchaseEventId: buildEventId(order),
  amount: order.totalAmount,
  customerInfo,
  orderSummary: {
    subtotal: order.subtotal,
    totalDiscount: order.totalDiscount,
    shippingCost: order.shippingCost,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount
  }
});


        } catch (error) {
            console.error("Error creating payment from cart:", error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: error.message || "Error creating payment from cart"
            });
        }
    }

    // inside PaymentController class
    async checkStatus(req, res, next) {
    try {
      const merchantOrderId = req.query.merchantOrderId;
      const { preOrderPaymentId, details = false, errorContext = false } = req.body;
      console.log("checkStatus inputs:", { merchantOrderId, preOrderPaymentId, details, errorContext });
  
      if (!merchantOrderId && !preOrderPaymentId) {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'merchantOrderId or preOrderPaymentId is required' });
      }
  
      // If preOrderPaymentId provided, validate but we will NOT update preOrder/preOrderPayment (per your request)
      if (preOrderPaymentId && !mongoose.Types.ObjectId.isValid(String(preOrderPaymentId))) {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid preOrderPaymentId' });
      }
  
      const mOrderId = merchantOrderId || null;
      if (!mOrderId) {
        return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'merchantOrderId not available' });
      }
  
      // --- Fetch token (O-Bearer <token>) ---
      const tokenUrl =
        process.env.NODE_ENV === "production"
          ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
          : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";
  
      const tokenBody = new URLSearchParams({
        client_id: phonepeConfig.CLIENT_ID,
        client_version: phonepeConfig.CLIENT_VERSION,
        client_secret: phonepeConfig.CLIENT_SECRET,
        grant_type: "client_credentials",
      }).toString();
  
      let phonepeToken = null;
      try {
        const tokenRes = await axios.post(tokenUrl, tokenBody, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        phonepeToken = tokenRes.data?.access_token || tokenRes.data?.accessToken || null;
        if (!phonepeToken) {
          console.error('PhonePe token response did not contain access_token', tokenRes.data);
          return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ success: false, message: 'PhonePe auth failed (no token)' });
        }
      } catch (tokenErr) {
        console.error('PhonePe token fetch error', tokenErr?.response?.data || tokenErr.message || tokenErr);
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Failed to fetch PhonePe authorization token',
          error: tokenErr?.response?.data || tokenErr.message
        });
      }
  
      const authHeader = `O-Bearer ${phonepeToken}`;
  
      // Build status URL with query params
      const base = process.env.NODE_ENV === 'production'
        ? 'https://api.phonepe.com/apis/pg/checkout/v2/order'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order';
      const url = `${base}/${encodeURIComponent(mOrderId)}/status?details=${details}&errorContext=${errorContext}`;
  
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      };
      if (phonepeConfig.MERCHANT_ID) {
        headers['X-MERCHANT-ID'] = phonepeConfig.MERCHANT_ID;
      }
  
      // Call PhonePe status endpoint
      const resp = await axios.get(url, { headers, validateStatus: null });
      const data = resp.data;
      console.log('PhonePe status response received for order:', mOrderId);
  
      // Handle invalid merchant order id from PhonePe
      if (data && data.code === 'INVALID_MERCHANT_ORDER_ID') {
        return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: data.message || 'Invalid merchantOrderId', code: data.code, data });
      }
  
      // Normalize values
      const state = data?.state ? String(data.state).toUpperCase() : null;
      const paymentDetails = Array.isArray(data?.paymentDetails) ? data.paymentDetails : [];
      const latest = paymentDetails.length ? paymentDetails[paymentDetails.length - 1] : null;
  
      // helper: paise -> rupees
      const paiseToRupees = (p) => (typeof p === 'number' ? (p / 100) : (p ? Number(p) / 100 : null));
  
      // map PhonePe states to your order/payment enums
      const mapStateToPaymentStatus = (s) => {
        if (!s) return 'pending';
        switch (s.toUpperCase()) {
          case 'COMPLETED': return 'completed';
          case 'SUCCESS': return 'completed';
          case 'FAILED': return 'failed';
          case 'CANCELLED': return 'failed';
          case 'PENDING': return 'pending';
          default: return s.toLowerCase();
        }
      };
  
      const paymentUpdate = {
        rawResponse: data,
        merchantOrderId: mOrderId,
        stateRaw: state,
        status: mapStateToPaymentStatus(state),
        updatedAt: new Date()
      };
  
      if (data?.amount) paymentUpdate.amount = paiseToRupees(data.amount);
      else if (latest?.amount) paymentUpdate.amount = paiseToRupees(latest.amount);
  
      if (latest) {
        paymentUpdate.transactionId = latest.transactionId || null;
        paymentUpdate.paymentMode = latest.paymentMode || null;
        paymentUpdate.attemptState = latest.state || null;
        paymentUpdate.attemptTimestamp = latest.timestamp ? new Date(latest.timestamp) : null;
        paymentUpdate.rail = latest.rail || undefined;
        paymentUpdate.instrument = latest.instrument || undefined;
        if (latest.errorCode) paymentUpdate.errorCode = latest.errorCode;
        if (latest.detailedErrorCode) paymentUpdate.detailedErrorCode = latest.detailedErrorCode;
      }
  
      // === NEW: Find & update Order by payment.transactionId === merchantOrderId FIRST ===
      let order = null;
      try {
        // 1) Find by payment.transactionId === mOrderId
        order = await Order.findOne({ 'payment.transactionId': mOrderId });
  
        // 2) fallback: find by payment.merchantOrderId (if you sometimes store it there)
        if (!order) {
          order = await Order.findOne({ 'payment.merchantOrderId': mOrderId });
        }
  
        // 3) fallback: find by orderNumber equals merchantOrderId
        if (!order) {
          order = await Order.findOne({ orderNumber: mOrderId });
        }
  
        if (order) {
          // BOLA Guard: Enforce ownership check (BUG-19)
          if (req.user && order.user.toString() !== req.user.id.toString() && req.user.role !== 'admin') {
              console.warn(`[checkStatus BOLA alert] User ${req.user.id} attempted status check for order ${order._id} owned by user ${order.user}`);
              return res.status(StatusCodes.FORBIDDEN).json({
                  success: false,
                  message: 'Forbidden: You do not own this order.'
              });
          }

          // update order.payment fields
          order.payment = order.payment || {};
          const prevPaymentStatus = order.payment.status;
  
          // Set canonical fields
          order.payment.status = paymentUpdate.status; // 'completed'|'failed'|'pending'
          // ensure transactionId is set (if PhonePe returned it)
          if (paymentUpdate.transactionId) {
            order.payment.transactionId = paymentUpdate.transactionId;
          } else {
            // If we found order by transactionId, mOrderId already is transaction id
            if (!order.payment.transactionId) order.payment.transactionId = mOrderId;
          }
          if (paymentUpdate.amount != null) {
            order.payment.amount = paymentUpdate.amount;
          }
          order.payment.gateway = order.payment.gateway || 'phonepe';
  
          // Set paidAt when payment moves to completed
          if (paymentUpdate.status === 'completed' && !order.payment.paidAt) {
            order.payment.paidAt = paymentUpdate.attemptTimestamp || new Date();
          }
  
          // Push paymentAttempts entry (avoid duplicates)
          const attempt = {
            method: order.payment.method || 'online',
            gateway: order.payment.gateway,
            transactionId: order.payment.transactionId,
            status: paymentUpdate.status === 'completed' ? 'completed' : (paymentUpdate.status === 'failed' ? 'failed' : 'pending'),
            errorCode: paymentUpdate.errorCode || undefined,
            errorMessage: (paymentUpdate.rawResponse && paymentUpdate.rawResponse.message) || undefined,
            attemptedAt: paymentUpdate.attemptTimestamp || new Date()
          };
  
          const duplicate = order.paymentAttempts && attempt.transactionId
            ? order.paymentAttempts.find(pa => pa.transactionId === attempt.transactionId && pa.gateway === attempt.gateway && pa.status === attempt.status)
            : null;
          if (!duplicate) {
            order.paymentAttempts = order.paymentAttempts || [];
            order.paymentAttempts.push(attempt);
          }
  
          // Business logic: auto-confirm if payment completed and order was pending
          if (paymentUpdate.status === 'completed' && ['pending', 'confirmed'].includes(order.status)) {
            if (typeof order.updateStatus === 'function') {
              order.updateStatus('confirmed');
            } else {
              order.status = 'confirmed';
              order.statusHistory = order.statusHistory || [];
              order.statusHistory.push({ status: 'confirmed', note: 'Auto-confirmed on successful payment', at: new Date() });
              order.confirmedAt = order.confirmedAt || new Date();
            }
          }
  
          // If failed, add a history note but DO NOT auto-cancel (safe default)
          if (paymentUpdate.status === 'failed') {
            order.statusHistory = order.statusHistory || [];
            order.statusHistory.push({ status: order.status, note: `Payment failed via PhonePe: ${paymentUpdate.errorCode || ''}`, at: new Date() });
          }
  
          order.updatedAt = new Date();
          await order.save();
          try {
            await deductStockForOrder(order);
          } catch (stockErr) {
            console.error('[PhonePe checkStatus] Stock deduction failed:', stockErr.message);
          }

          // Create Shiprocket order when payment is completed
          if (paymentUpdate.status === 'completed') {
            console.log('Creating Shiprocket order for order:', order._id);
            await createShiprocketOrderOnPaymentComplete(order);
            // Best-effort analytics event (do not block status endpoint)
            queuePurchaseCapiEvent({ req, order });
          }
        } else {
          console.warn('No Order found matching payment.transactionId or payment.merchantOrderId or orderNumber for:', mOrderId);
        }
      } catch (orderErr) {
        console.error('Error updating Order payment fields:', orderErr?.message || orderErr);
      }
  
      // Note: per your request we do NOT modify PreOrderPayment or PreOrder here.
  
      // Return normalized response
      return res.status(StatusCodes.OK).json({
        success: true,
        merchantOrderId: mOrderId,
        state,
        paymentDetails,
        local: order ? {
          id: order._id,
          orderNumber: order.orderNumber,
          payment: {
            status: order.payment.status,
            transactionId: order.payment.transactionId,
            paidAt: order.payment.paidAt,
            amount: order.payment.amount,
            gateway: order.payment.gateway
          },
          status: order.status
        } : null,
        data
      });
  
    } catch (error) {
      console.error("Error checking status of payment:", error?.response?.data || error.message || error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || "Error checking status of payment",
        error: error?.response?.data || error.message
      });
    }
  }

    // async checkStatus(req, res, next) {
    //     try {
    //         const { merchantOrderId } = req.query;
    
    //         if (!merchantOrderId) {
    //             return res.status(StatusCodes.BAD_REQUEST).json({
    //                 success: false,
    //                 message: "merchantOrderId is required"
    //             });
    //         }
    
    //         // Find order by payment.transactionId
    //         const order = await Order.findOne({
    //             'payment.transactionId': merchantOrderId
    //         });
    
    //         const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    //         const successRedirectBase = phonepeConfig.SUCCESS_URL || `${frontendBase}/payment/success`;
    //         const failureRedirectBase = phonepeConfig.FAILURE_URL || `${frontendBase}/payment/failure`;
    
    //         const failureRedirect = buildUrlWithParams(failureRedirectBase, {
    //             merchantOrderId,
    //             error: 'order_not_found'
    //         });
    
    //         if (!order) {
    //             console.log('Order not found for merchantOrderId:', merchantOrderId);
    //             return res.redirect(failureRedirect);
    //         }
    
    //         console.log('Checking payment status for order:', order._id, 'merchantOrderId:', merchantOrderId);
    
    //         // Determine PhonePe endpoints
    //         const isProd = process.env.NODE_ENV === 'production';
    //         const tokenUrl = isProd
    //             ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
    //             : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';
    //         const baseStatusUrl = isProd
    //             ? 'https://api.phonepe.com/apis/pg/checkout/v2'
    //             : 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2';
    //         const statusUrl = `${baseStatusUrl}/order/${encodeURIComponent(merchantOrderId)}/status`;
    
    //         // 1) Fetch OAuth token (client credentials)
    //         let phonepeToken = null;
    //         try {
    //             const tokenBody = new URLSearchParams({
    //                 client_id: phonepeConfig.CLIENT_ID,
    //                 client_version: phonepeConfig.CLIENT_VERSION,
    //                 client_secret: phonepeConfig.CLIENT_SECRET,
    //                 grant_type: "client_credentials"
    //             }).toString();
    
    //             const tokenRes = await axios.post(tokenUrl, tokenBody, {
    //                 headers: { "Content-Type": "application/x-www-form-urlencoded" },
    //                 timeout: 10000
    //             });
    
    //             const tokenJson = tokenRes.data;
    //             phonepeToken = tokenJson?.access_token || tokenJson?.accessToken || null;
    //             console.log('PhonePe token fetched, expires_in:', tokenJson?.expires_in || tokenJson?.expiresAt);
    //         } catch (tokenErr) {
    //             console.warn('Failed to fetch PhonePe token:', tokenErr?.message || tokenErr);
    //             // Continue without token if not required by sandbox - but prefer to fail safely
    //             // Redirect to failure since we couldn't verify status securely
    //             const fallbackRedirect = buildUrlWithParams(failureRedirectBase, { merchantOrderId, error: 'token_fetch_failed' });
    //             return res.redirect(fallbackRedirect);
    //         }
    
    //         // 2) Call PhonePe status endpoint
    //         let phonepeResp = null;
    //         try {
    //             const headers = {
    //                 "Content-Type": "application/json",
    //             };
    //             if (phonepeToken) headers['Authorization'] = `Bearer ${phonepeToken}`;
    
    //             const resp = await axios.get(statusUrl, { headers, timeout: 10000 });
    //             phonepeResp = resp?.data || null;
    //             console.log('PhonePe status response:', JSON.stringify(phonepeResp).slice(0, 1000));
    //         } catch (statusErr) {
    //             console.warn('PhonePe status API call failed:', statusErr?.message || statusErr);
    //             // fallback: redirect to failure page (or you could fallback to simulated behavior)
    //             const fallbackRedirect = buildUrlWithParams(failureRedirectBase, { merchantOrderId, error: 'status_api_failed' });
    //             return res.redirect(fallbackRedirect);
    //         }
    
    //         // 3) Normalize response and extract state/amount/txn id
    //         // Common response shapes:
    //         // { code: 'SUCCESS', message:'OK', data: { transactionId: '...', state: 'COMPLETED', amount: 10000 } }
    //         // or { success: true, response: { transactionId: '...', state: 'COMPLETED', amount: 10000 } }
    //         const payload = phonepeResp?.data || phonepeResp?.response || phonepeResp || {};
    //         const state = (payload.state || payload.status || payload.transactionStatus || payload.transactionState || '').toString().toUpperCase();
    //         const txnId = payload.transactionId || payload.txnId || payload.transaction_id || null;
    //         const amountFromPhonePe = payload.amount || payload.orderAmount || payload.value || null; // usually in paise
    
    //         // 4) Map to our statuses and update order/payment atomically
    //         // Simple mapping: COMPLETED -> completed, else failed/pending
    //         const isCompleted = ['COMPLETED', 'SUCCESS', 'PAYMENT_SUCCESS', 'CAPTURED'].includes(state);
    //         const isFailed = ['FAILED', 'ERROR', 'PAYMENT_ERROR', 'DECLINED', 'CANCELLED', 'ABORTED'].includes(state);
    
    //         // Idempotent: only change if different
    //         if (isCompleted && order.payment.status !== 'completed') {
    //             order.payment.status = 'completed';
    //             order.payment.paidAt = order.payment.paidAt || new Date();
    //             if (txnId) order.payment.gatewayTransactionId = txnId;
    //             // Optionally store amount in rupees (convert from paise)
    //             if (amountFromPhonePe) {
    //                 const numeric = Number(amountFromPhonePe);
    //                 if (!Number.isNaN(numeric)) {
    //                     order.payment.amount = numeric >= 100 ? (numeric / 100) : (numeric / 100); // convert paise->rupees
    //                 }
    //             }
    //             order.status = 'confirmed';
    //             await order.save();
    
    //             // Clear user's cart now that payment is confirmed (best-effort)
    //             try {
    //                 const userCart = await Cart.findOne({ user: order.user });
    //                 if (userCart) {
    //                     if (typeof userCart.clearCart === 'function') {
    //                         userCart.clearCart();
    //                     } else {
    //                         userCart.items = [];
    //                     }
    //                     await userCart.save();
    //                 }
    //             } catch (e) {
    //                 console.warn('Cart clear after payment failed:', e?.message || e);
    //             }
    
    //             console.log('Payment completed for order:', order._id);
    //             const successRedirect = buildUrlWithParams(successRedirectBase, {
    //                 orderId: order._id.toString(),
    //                 orderNumber: order.orderNumber,
    //                 merchantOrderId
    //             });
    //             return res.redirect(successRedirect);
    //         }
    
    //         if (isFailed && order.payment.status !== 'failed') {
    //             order.payment.status = 'failed';
    //             if (txnId) order.payment.gatewayTransactionId = txnId;
    //             order.status = 'cancelled';
    //             await order.save();
    
    //             console.log('Payment failed for order:', order._id);
    //             const failureRedirectWithOrder = buildUrlWithParams(failureRedirectBase, {
    //                 orderId: order._id.toString(),
    //                 orderNumber: order.orderNumber,
    //                 merchantOrderId
    //             });
    //             return res.redirect(failureRedirectWithOrder);
    //         }
    
    //         // If neither changed (maybe status still pending) — redirect to a pending/failure page
    //         console.log('Payment status unchanged or pending for order:', order._id, 'state:', state);
    //         const pendingRedirect = buildUrlWithParams(failureRedirectBase, {
    //             orderId: order._id.toString(),
    //             orderNumber: order.orderNumber,
    //             merchantOrderId,
    //             status: state || 'PENDING'
    //         });
    //         return res.redirect(pendingRedirect);
    
    //     } catch (error) {
    //         console.error("Error checking payment status:", error && (error.stack || error.message || error));
    //         const fallbackRedirect = buildUrlWithParams(
    //             phonepeConfig.FAILURE_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
    //             { error: 'server_error' }
    //         );
    //         return res.redirect(fallbackRedirect);
    //     }
    // }
    
    async phonePeWebhook(req, res, next) {
        // This endpoint is decommissioned — it accepted unsigned payloads.
        // All PhonePe webhooks must go to POST /api/v1/payments/phonepe/webhook.
        return res.status(410).json({
            success: false,
            message: 'This webhook endpoint is deprecated. Update your PhonePe dashboard to use /api/v1/payments/phonepe/webhook.'
        });
    }

    // Keep existing PhonePe methods for backward compatibility
    async initiatePhonePePayment(req, res, next) {
        try {
            const userId = req.user.id;
            const { amount, merchantTransactionId, callbackUrl } = req.body;

            console.log("userid in initiatePhonePePayment:", userId);
            console.log("amount in initiatePhonePePayment:", amount);
            console.log("merchantTransactionId in initiatePhonePePayment:", merchantTransactionId);
            console.log("callbackUrl in initiatePhonePePayment:", callbackUrl);

            if (!amount || !merchantTransactionId) {
                return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'amount and merchantTransactionId are required' });
            }

            const payload = {
                merchantId: process.env.PHONEPE_MERCHANT_ID,
                merchantTransactionId,
                merchantUserId: String(userId),
                amount: Math.round(Number(amount) * 100), // paise
                redirectUrl: callbackUrl,
                redirectMode: 'POST',
                callbackUrl,
                paymentInstrument: { type: 'PAY_PAGE' }
            };

            const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
            const concatenated = base64Payload + '/pg/v1/pay' + process.env.PHONEPE_SALT_KEY;
            const sha256 = crypto.createHash('sha256').update(concatenated).digest('hex');
            const xVerify = sha256 + '###' + process.env.PHONEPE_SALT_INDEX;

            const base = process.env.PHONEPE_BASE_URL || 'https://api.phonepe.com';
            const payUrl = base + '/apis/pg-sandbox/pg/v1/pay';

            const phonePeRes = await fetch(payUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-VERIFY': xVerify,
                    'X-MERCHANT-ID': process.env.PHONEPE_MERCHANT_ID
                },
                body: JSON.stringify({ request: base64Payload })
            });

            const phonePeJson = await phonePeRes.json().catch(() => ({}));

            if (!phonePeRes.ok || phonePeJson.success === false) {
                return res.status(StatusCodes.BAD_GATEWAY).json({
                    success: false,
                    message: 'Failed to initiate payment',
                    details: phonePeJson
                });
            }

            // Extract hosted checkout URL if available
            const checkoutUrl = phonePeJson?.data?.instrumentResponse?.redirectInfo?.url
                || phonePeJson?.data?.redirectUrl
                || phonePeJson?.data?.url
                || null;
            const deepLink = phonePeJson?.data?.instrumentResponse?.redirectInfo?.deeplink
                || phonePeJson?.data?.deeplink
                || null;

            return res.status(StatusCodes.OK).json({
                success: true,
                checkoutUrl, // preferred HTTPS URL for web checkout
                deepLink,    // optional fallback if needed by client
                gatewayResponse: phonePeJson
            });
        } catch (error) {
            next(error);
        }
    }

    async phonePeCallback(req, res, next) {
        try {
            // PhonePe posts transaction status to this URL
            // You can verify signature here if needed and update order/payment status
            return res.status(StatusCodes.OK).json({ success: true });
        } catch (error) {
            next(error);
        }
    }

    async phonePeStatus(req, res, next) {
        try {
            const { merchantTransactionId } = req.params;
            if (!merchantTransactionId) {
                return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'merchantTransactionId is required' });
            }

            const path = `/pg/v1/status/${process.env.PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;
            const concatenated = path + process.env.PHONEPE_SALT_KEY;
            const sha256 = crypto.createHash('sha256').update(concatenated).digest('hex');
            const xVerify = sha256 + '###' + process.env.PHONEPE_SALT_INDEX;

            const url = (process.env.PHONEPE_BASE_URL || 'https://api.phonepe.com') + '/apis/pg-sandbox' + path;

            return res.status(StatusCodes.OK).json({ success: true, url, headers: { 'X-VERIFY': xVerify } });
        } catch (error) {
            next(error);
        }
    }

    // Payment simulation endpoint for testing
    async simulatePayment(req, res, next) {
        try {
            const { merchantOrderId, amount } = req.query;

            if (!merchantOrderId) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: "MerchantOrderId is required"
                });
            }

            // Find order by payment transaction ID
            const order = await Order.findOne({ 
                'payment.transactionId': merchantOrderId 
            });

            if (!order) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    success: false,
                    message: "Order not found"
                });
            }

            // Simulate successful payment
            order.payment.status = 'completed';
            order.payment.paidAt = new Date();
            order.status = 'confirmed';
            await order.save();

            // Clear user's cart now that payment is confirmed
            try {
                const userCart = await Cart.findOne({ user: order.user });
                if (userCart) {
                    userCart.clearCart();
                    await userCart.save();
                }
            } catch (e) {
                console.warn('Cart clear after payment failed:', e?.message);
            }

            // Return success page HTML
            const successHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Payment Successful</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .success { color: #28a745; }
                        .order-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    <h1 class="success">✅ Payment Successful!</h1>
                    <div class="order-details">
                        <h3>Order Details</h3>
                        <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                        <p><strong>Amount:</strong> ₹${order.totalAmount}</p>
                        <p><strong>Status:</strong> ${order.status}</p>
                        <p><strong>Payment ID:</strong> ${merchantOrderId}</p>
                    </div>
                    <p>Your order has been confirmed and will be processed shortly.</p>
                    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/orders">View Orders</a></p>
                </body>
                </html>
            `;

            res.setHeader('Content-Type', 'text/html');
            return res.send(successHtml);

        } catch (error) {
            console.error("Error in payment simulation:", error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: error.message || "Payment simulation failed"
            });
        }
    }

    // inside PaymentController class
    async checkPreOrderPaymentStatus(req, res, next) {
        try {
            const merchantOrderId = req.query.merchantOrderId;
            const { preOrderPaymentId, details = false, errorContext = false } = req.body;
            console.log("checkPreOrderPaymentStatus inputs:", { merchantOrderId, preOrderPaymentId, details, errorContext });

            if (!merchantOrderId && !preOrderPaymentId) {
                return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'merchantOrderId or preOrderPaymentId is required' });
            }

            // If preOrderPaymentId provided, validate and resolve merchantOrderId from DB
            let preOrderPayment = null;
            if (preOrderPaymentId) {
                if (!mongoose.Types.ObjectId.isValid(String(preOrderPaymentId))) {
                    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid preOrderPaymentId' });
                }
                preOrderPayment = await PreOrderPayment.findById(preOrderPaymentId);
                if (!preOrderPayment) {
                    return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'PreOrderPayment not found' });
                }
            }

            const mOrderId = merchantOrderId || (preOrderPayment && preOrderPayment.payment && preOrderPayment.payment.merchantOrderId);
            if (!mOrderId) {
                return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'merchantOrderId not available' });
            }

            // --- Fetch token (O-Bearer <token>) ---
            const tokenUrl =
                process.env.NODE_ENV === "production"
                    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
                    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

            const tokenBody = new URLSearchParams({
                client_id: phonepeConfig.CLIENT_ID,
                client_version: phonepeConfig.CLIENT_VERSION,
                client_secret: phonepeConfig.CLIENT_SECRET,
                grant_type: "client_credentials",
            }).toString();

            let phonepeToken = null;
            try {
                const tokenRes = await axios.post(tokenUrl, tokenBody, {
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                });
                phonepeToken = tokenRes.data?.access_token || tokenRes.data?.accessToken || null;
                if (!phonepeToken) {
                    console.error('PhonePe token response did not contain access_token', tokenRes.data);
                    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ success: false, message: 'PhonePe auth failed (no token)' });
                }
            } catch (tokenErr) {
                console.error('PhonePe token fetch error', tokenErr?.response?.data || tokenErr.message || tokenErr);
                return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Failed to fetch PhonePe authorization token',
                    error: tokenErr?.response?.data || tokenErr.message
                });
            }

            const authHeader = `O-Bearer ${phonepeToken}`;

            // Build status URL with query params
            const base = process.env.NODE_ENV === 'production'
                ? 'https://api.phonepe.com/apis/pg/checkout/v2/order'
                : 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order';
            const url = `${base}/${encodeURIComponent(mOrderId)}/status?details=${details}&errorContext=${errorContext}`;

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            };
            if (phonepeConfig.MERCHANT_ID) {
                headers['X-MERCHANT-ID'] = phonepeConfig.MERCHANT_ID;
            }

            // Call PhonePe status endpoint
            const resp = await axios.get(url, { headers, validateStatus: null });
            const data = resp.data;
            console.log('PhonePe status response:', data);

            // Handle invalid merchant order id from PhonePe
            if (data && data.code === 'INVALID_MERCHANT_ORDER_ID') {
                return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: data.message || 'Invalid merchantOrderId', code: data.code, data });
            }

            // Normalize values
            const state = data?.state ? String(data.state).toUpperCase() : null;
            const paymentDetails = Array.isArray(data?.paymentDetails) ? data.paymentDetails : [];
            const latest = paymentDetails.length ? paymentDetails[paymentDetails.length - 1] : null;

            // helper: paise -> rupees
            const paiseToRupees = (p) => (typeof p === 'number' ? (p / 100) : (p ? Number(p) / 100 : null));

            // map PhonePe states to your payment enums
            const mapStateToPaymentStatus = (s) => {
                if (!s) return 'pending';
                switch (s.toUpperCase()) {
                    case 'COMPLETED': return 'completed';
                    case 'SUCCESS': return 'completed';
                    case 'FAILED': return 'failed';
                    case 'CANCELLED': return 'failed';
                    case 'PENDING': return 'pending';
                    default: return s.toLowerCase();
                }
            };

            const paymentUpdate = {
                rawResponse: data,
                merchantOrderId: mOrderId,
                stateRaw: state,
                status: mapStateToPaymentStatus(state),
                updatedAt: new Date()
            };

            if (data?.amount) paymentUpdate.amount = paiseToRupees(data.amount);
            else if (latest?.amount) paymentUpdate.amount = paiseToRupees(latest.amount);

            if (latest) {
                paymentUpdate.transactionId = latest.transactionId || null;
                paymentUpdate.paymentMode = latest.paymentMode || null;
                paymentUpdate.attemptState = latest.state || null;
                paymentUpdate.attemptTimestamp = latest.timestamp ? new Date(latest.timestamp) : null;
                paymentUpdate.rail = latest.rail || undefined;
                paymentUpdate.instrument = latest.instrument || undefined;
                if (latest.errorCode) paymentUpdate.errorCode = latest.errorCode;
                if (latest.detailedErrorCode) paymentUpdate.detailedErrorCode = latest.detailedErrorCode;
            }

            // === Find & update PreOrderPayment by payment.merchantOrderId ===
            if (!preOrderPayment) {
                // If we didn't have preOrderPayment earlier, try to find by merchantOrderId
                preOrderPayment = await PreOrderPayment.findOne({ 'payment.merchantOrderId': mOrderId }) || null;
            }

            if (preOrderPayment) {
                // Update PreOrderPayment payment fields
                const prevPaymentStatus = preOrderPayment.status;

                // Set canonical fields
                preOrderPayment.status = paymentUpdate.status; // 'completed'|'failed'|'pending'
                preOrderPayment.amount = paymentUpdate.amount ?? preOrderPayment.amount;
                preOrderPayment.payment = preOrderPayment.payment || {};
                preOrderPayment.payment.merchantOrderId = paymentUpdate.merchantOrderId;
                preOrderPayment.payment.transactionId = paymentUpdate.transactionId || preOrderPayment.payment.transactionId;
                preOrderPayment.payment.rawResponse = paymentUpdate.rawResponse;

                if (paymentUpdate.errorCode) preOrderPayment.payment.errorCode = paymentUpdate.errorCode;
                if (data?.errorContext) preOrderPayment.payment.errorContext = data.errorContext;

                // Set timestamps based on status
                if (paymentUpdate.status === 'completed' && !preOrderPayment.payment.completedAt) {
                    preOrderPayment.payment.completedAt = paymentUpdate.attemptTimestamp || new Date();
                }
                if (paymentUpdate.status === 'failed' && !preOrderPayment.payment.failedAt) {
                    preOrderPayment.payment.failedAt = paymentUpdate.attemptTimestamp || new Date();
                }

                preOrderPayment.updatedAt = new Date();
                await preOrderPayment.save();

                console.log(`PreOrderPayment ${preOrderPayment._id} status updated from ${prevPaymentStatus} to ${paymentUpdate.status}`);

                // Track coupon usage and send confirmation email when payment is completed
                if (paymentUpdate.status === 'completed' && prevPaymentStatus !== 'completed') {
                    try {
                        const preOrder = await PreOrder.findById(preOrderPayment.preOrder);
                        if (preOrder) {
                            // Track coupon usage if coupon was applied
                            if (preOrder.coupon && preOrder.coupon.couponId) {
                                const Coupon = require('../models/coupon.model');
                                const discountAmount = preOrder.coupon.discountAmount || 0;
                                
                                // Increment coupon usage count and analytics
                                await Coupon.incrementUsage(preOrder.coupon.couponId, discountAmount);
                                
                                console.log(`Coupon ${preOrder.coupon.code} usage incremented. Discount: ₹${discountAmount}`);
                            }

                            // Send confirmation email when payment is completed (only if not sent before)
                            if (!preOrder.emailSent?.confirmationSent) {
                                try {
                                    const { sendPreOrderConfirmationEmail } = require('../utils/emailService');
                                    
                                    const emailDetails = {
                                        orderId: preOrder._id.toString(),
                                        amount: preOrderPayment.amount || 0,
                                        couponCode: preOrder.coupon?.code || null,
                                        discountAmount: preOrder.coupon?.discountAmount || null
                                    };
                                    
                                    const emailResult = await sendPreOrderConfirmationEmail(preOrder.email, preOrder.name, emailDetails);
                                    
                                    if (emailResult.success) {
                                        // Mark email as sent
                                        preOrder.emailSent = {
                                            confirmationSent: true,
                                            confirmationSentAt: new Date()
                                        };
                                        await preOrder.save();
                                        console.log('Pre-order confirmation email sent to:', preOrder.email);
                                    }
                                } catch (emailError) {
                                    console.warn('Failed to send pre-order confirmation email:', emailError?.message || emailError);
                                    // Don't fail the payment process if email fails
                                }
                            } else {
                                console.log('Pre-order confirmation email already sent for:', preOrder._id);
                            }
                        }
                    } catch (error) {
                        console.warn('Failed to process payment completion tasks:', error?.message || error);
                    }
                }

                // Also update linked PreOrder if present
                if (preOrderPayment.preOrder) {
                    try {
                        const preOrder = await PreOrder.findById(preOrderPayment.preOrder);
                        if (preOrder) {
                            preOrder.payment = preOrder.payment || {};
                            preOrder.payment.status = paymentUpdate.status;
                            preOrder.payment.merchantOrderId = paymentUpdate.merchantOrderId;
                            preOrder.payment.transactionId = paymentUpdate.transactionId || preOrder.payment.transactionId;
                            preOrder.payment.rawResponse = paymentUpdate.rawResponse;
                            preOrder.updatedAt = new Date();
                            await preOrder.save();
                            console.log(`Linked PreOrder ${preOrder._id} payment status updated to ${paymentUpdate.status}`);
                        }
                    } catch (e) {
                        console.warn('Failed to update linked PreOrder:', e?.message || e);
                    }
                }
            } else {
                console.warn('No PreOrderPayment found matching payment.merchantOrderId for:', mOrderId);
            }

            // Return normalized response
            return res.status(StatusCodes.OK).json({
                success: true,
                merchantOrderId: mOrderId,
                state,
                paymentDetails,
                local: preOrderPayment ? {
                    id: preOrderPayment._id,
                    preOrderId: preOrderPayment.preOrder,
                    status: preOrderPayment.status,
                    amount: preOrderPayment.amount,
                    payment: {
                        merchantOrderId: preOrderPayment.payment?.merchantOrderId,
                        transactionId: preOrderPayment.payment?.transactionId,
                        completedAt: preOrderPayment.payment?.completedAt,
                        failedAt: preOrderPayment.payment?.failedAt
                    }
                } : null,
                data
            });

        } catch (error) {
            console.error("Error checking status of pre-order payment:", error?.response?.data || error.message || error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: error.message || "Error checking status of pre-order payment",
                error: error?.response?.data || error.message
            });
        }
    }

    //payment for pre-order
    // inside PaymentController class (add near other methods)
    async createPaymentForPreOrder(req, res, next) {
        try {
            // Optionally require authentication; if you don't want auth, skip user lookup
            // const userId = req.user?.id || null;
            const { amount, preOrderId } = req.body;

            console.log("amount in createPaymentForPreOrder:", amount);
            console.log("preOrderId in createPaymentForPreOrder:", preOrderId);

            // Validate preOrderId so we can track who paid from landing page form
            if (!preOrderId) {
                return res.status(400).json({
                    success: false,
                    message: "preOrderId is required."
                });
            }

            if (!mongoose.Types.ObjectId.isValid(String(preOrderId))) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid preOrderId."
                });
            }

            const preOrder = await PreOrder.findById(preOrderId);
            if (!preOrder) {
                return res.status(404).json({
                    success: false,
                    message: "Pre-order not found for the given preOrderId."
                });
            }

            // Basic validation for amount
            if (amount === undefined || amount === null) {
                return res.status(400).json({
                    success: false,
                    message: "Amount is required (in rupees)."
                });
            }

            const amountNum = Number(amount);
            if (!Number.isFinite(amountNum) || amountNum <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid amount. Must be a positive number."
                });
            }

            // Prevent abuse: optional maximum (change as needed)
            const MAX_AMOUNT_RUPEES = 1_000_000; // 10,00,000 rupees
            if (amountNum > MAX_AMOUNT_RUPEES) {
                return res.status(400).json({
                    success: false,
                    message: `Amount exceeds allowed maximum of ${MAX_AMOUNT_RUPEES} rupees.`
                });
            }

            // Create minimal pre-order payment record so you have traceability in DB
            const merchantOrderId = randomUUID();

            const minimalPaymentData = {
                preOrder: preOrder._id,
                amount: amountNum,
                currency: 'INR',
                status: 'pending',
                payment: {
                    merchantOrderId,
                    gateway: 'phonepe'
                },
                leadSnapshot: {
                    name: preOrder.name,
                    email: preOrder.email,
                    phone: preOrder.phone
                }
            };

            const preOrderPayment = await PreOrderPayment.create(minimalPaymentData);

            // Convert amount to paise (PhonePe expects integer smallest unit)
            const amountInPaise = Math.round(amountNum * 100);

            console.log("preorder:-", phonepeConfig.PREORDER_CALLBACK_URL);

            // Build redirect/callback URL for after payment (use configured callback or API route)
            const callbackBaseUrl = phonepeConfig.PREORDER_CALLBACK_URL
                ? phonepeConfig.PREORDER_CALLBACK_URL
                : `${process.env.BASE_URL || 'localhost:3000'}/pre-order/payment/status`;

                console.log("callback in preorder", callbackBaseUrl)

            const redirectUrl = buildUrlWithParams(callbackBaseUrl, {
                merchantOrderId
            });

            console.log("redirectUrl", redirectUrl);

            // Build PhonePe pay request via SDK if available
            if (!client) {
                // Fallback: return simulated sandbox link if SDK not initialized
                const fallbackCheckout = `https://mercury-t2.phonepe.com/transact/pay/sandbox-fallback?merchantOrderId=${encodeURIComponent(merchantOrderId)}&amount=${amountInPaise}`;
                // Fetch the complete preOrder with pet data for response
                const completePreOrder = await PreOrder.findById(preOrder._id);
                return res.status(200).json({
                    success: true,
                    checkoutPageUrl: fallbackCheckout,
                    preOrderPaymentId: preOrderPayment._id,
                    merchantOrderId,
                    amount: amountNum,
                    preOrder: {
                        _id: completePreOrder._id,
                        name: completePreOrder.name,
                        email: completePreOrder.email,
                        phone: completePreOrder.phone,
                        address: completePreOrder.address,
                        pet: completePreOrder.pet || null,
                        status: completePreOrder.status,
                        createdAt: completePreOrder.createdAt
                    }
                });
            }

            const payRequest = StandardCheckoutPayRequest.builder()
                .merchantOrderId(merchantOrderId)
                .amount(amountInPaise)
                .redirectUrl(redirectUrl)
                .build();

            // --- (Optional) Manual token fetch for PhonePe if you need it elsewhere ---
            // (keeping this mostly for parity with your existing code; SDK may handle auth internally)
            try {
                const tokenUrl =
                    process.env.NODE_ENV === "production"
                        ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
                        : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

                const tokenBody = new URLSearchParams({
                    client_id: phonepeConfig.CLIENT_ID,
                    client_version: phonepeConfig.CLIENT_VERSION,
                    client_secret: phonepeConfig.CLIENT_SECRET,
                    grant_type: "client_credentials",
                }).toString();

                // We do not rely on token here for SDK call but log any token errors non-fatally
                try {
                    const tokenRes = await axios.post(tokenUrl, tokenBody, {
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    });
                    // const phonepeToken = tokenRes.data.access_token; // not used directly
                } catch (tokenErr) {
                    // Log token error but continue if SDK can still operate
                    console.warn("PhonePe token fetch failed (non-fatal):", tokenErr.message);
                }
            } catch (err) {
                // ignore token helper errors
                console.warn("PhonePe token helper failed:", err?.message || err);
            }

            // Call PhonePe SDK to create the payment session
            const phonepeResponse = await client.pay(payRequest);

            // phonepeResponse shape may vary; prefer redirectUrl then token fallback
            const checkoutPageUrl = phonepeResponse?.redirectUrl
                || (phonepeResponse?.token ? `https://mercury-t2.phonepe.com/transact/pay/${phonepeResponse.token}` : null);

            if (!checkoutPageUrl) {
                // Save debug info to pre-order payment and return error
                preOrderPayment.status = 'failed';
                preOrderPayment.payment.gatewayResponse = phonepeResponse || { error: 'no checkout url' };
                preOrderPayment.payment.failedAt = new Date();
                await preOrderPayment.save();

                return res.status(500).json({
                    success: false,
                    message: "PhonePe did not return a checkout URL.",
                    debug: phonepeResponse
                });
            }

            // Save checkout URL on pre-order payment (optional)
            preOrderPayment.payment.checkoutUrl = checkoutPageUrl;
            await preOrderPayment.save();

            // Fetch the complete preOrder with pet data for response
            const completePreOrder = await PreOrder.findById(preOrder._id);

            // Return the checkout URL with preOrder data (including pet)
            return res.status(200).json({
                success: true,
                checkoutPageUrl,
                preOrderPaymentId: preOrderPayment._id,
                preOrderId: preOrder._id,
                merchantOrderId,
                amount: amountNum,
                preOrder: {
                    _id: completePreOrder._id,
                    name: completePreOrder.name,
                    email: completePreOrder.email,
                    phone: completePreOrder.phone,
                    address: completePreOrder.address,
                    pet: completePreOrder.pet || null,
                    status: completePreOrder.status,
                    createdAt: completePreOrder.createdAt
                }
            });

        } catch (error) {
            console.error("createPaymentForPreOrder error:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Error creating payment for pre-order"
            });
        }
    } 


    

    // ========== Razorpay Payment Methods ==========

//create razorpay payment from cart
    async createRazorpayPaymentFromCart(req, res, next) {
        try {
            // Identity comes from the verified token only. Accepting req.body.userId here
            // would let any caller create an order billed to another user's cart.
            const userId = req.user?.id;

            if (!userId) {
                return res.status(StatusCodes.UNAUTHORIZED).json({
                    success: false,
                    message: 'Authentication required.'
                });
            }
            
            console.log("PaymentController createRazorpayPaymentFromCart userId:", userId);
            const {
                shippingAddressId,
                billingAddressId,
                paymentMethod,
                deliveryInstructions,
                instructions,
                notes
            } = req.body;

            // Check for recent pending orders within the last 5 minutes for idempotency (BUG-04).
            // Scoped to this gateway - otherwise a stale pending Paytm order blocks Razorpay checkout.
            const recentPendingOrder = await Order.findOne({
                user: userId,
                status: 'pending',
                'payment.status': 'pending',
                'payment.gateway': 'razorpay',
                createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
            });

            if (recentPendingOrder) {
                console.log(`[Idempotency check] Found recent pending order ${recentPendingOrder._id} for user ${userId}`);
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: 'An order is already pending. Please complete or cancel the transaction before starting a new one.',
                    razorpayOrderId: recentPendingOrder.payment.transactionId,
                    merchantOrderId: recentPendingOrder.payment.merchantOrderId,
                    orderId: recentPendingOrder._id
                });
            }

            const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

            // Get user's cart and addresses
            // Fetch cart - populate product but NOT variant to preserve variant ObjectIds
            // We'll extract variant IDs directly from the document
            const [cart, user, shippingAddress, billingAddress] = await Promise.all([
                Cart.findOne({ user: userId })
                    .populate({
                        path: 'items.product',
                        select: 'name sku pricing inventory partner variants' // Include variants for embedded variants
                    })
                    .populate({
                        path: 'items.service',
                        select: 'name slug shortDescription serviceType category pricing images isActive isVerified partner'
                    }),
                User.findById(userId).select('phoneNumber email name'),
                shippingAddressId ? Address.findOne({ _id: shippingAddressId, user: userId, isDeleted: false }) : null,
                billingAddressId ? Address.findOne({ _id: billingAddressId, user: userId, isDeleted: false }) : null
            ]);

            if (!cart || cart.items.length === 0) {
                throw new ErrorResponse('Cart is empty', StatusCodes.BAD_REQUEST);
            }

            // Use provided addresses or get default shipping address
            let finalShippingAddressId, finalBillingAddressId;
            
            if (shippingAddressId) {
                if (!isValidObjectId(shippingAddressId)) {
                    throw new ErrorResponse('Invalid shippingAddressId', StatusCodes.BAD_REQUEST);
                }
                if (!shippingAddress) {
                    throw new ErrorResponse('Shipping address not found or does not belong to user', StatusCodes.NOT_FOUND);
                }
                finalShippingAddressId = shippingAddressId;
            } else {
                const defaultAddress = await Address.findOne({ user: userId, isDefaultShipping: true, isDeleted: false });
                if (!defaultAddress) {
                    throw new ErrorResponse('No shipping address found. Please add a shipping address first.', StatusCodes.BAD_REQUEST);
                }
                finalShippingAddressId = defaultAddress._id;
            }

            if (billingAddressId) {
                if (!isValidObjectId(billingAddressId)) {
                    throw new ErrorResponse('Invalid billingAddressId', StatusCodes.BAD_REQUEST);
                }
                if (!billingAddress) {
                    throw new ErrorResponse('Billing address not found or does not belong to user', StatusCodes.NOT_FOUND);
                }
                finalBillingAddressId = billingAddressId;
            } else {
                finalBillingAddressId = finalShippingAddressId;
            }

            // Calculate cart totals
            cart.calculateTotals();
            await cart.save();

            // Filter out items with missing products/services
            // Convert items to plain objects to access raw variant IDs
            const validCartItems = cart.items
                .map(item => {
                    // Convert to plain object to access raw data
                    const itemObj = item.toObject ? item.toObject() : item;
                    // Re-attach populated docs if they exist
                    if (item.product) {
                        itemObj.product = item.product;
                    }
                    if (item.service) {
                        itemObj.service = item.service;
                    }
                    return itemObj;
                })
                .filter(item => {
                    const itemType = item.itemType || (item.service ? 'service' : 'product');
                    if (itemType === 'service') {
                        if (!item.service) {
                            console.warn(`Cart item has null service, skipping: ${item._id}`);
                            return false;
                        }
                        return true;
                    }
                    if (!item.product) {
                        console.warn(`Cart item has null product, skipping: ${item._id}`);
                        return false;
                    }
                    return true;
                });

            if (validCartItems.length === 0) {
                throw new ErrorResponse('Cart contains no valid items. Some products/services may have been deleted.', StatusCodes.BAD_REQUEST);
            }

            const serviceCartItems = validCartItems.filter(item => (item.itemType || (item.service ? 'service' : 'product')) === 'service');
            const productCartItems = validCartItems.filter(item => (item.itemType || (item.service ? 'service' : 'product')) !== 'service');

            // ========== PRICE VERIFICATION: Re-calculate prices from database ==========
            // This prevents price manipulation on frontend by verifying all prices against database
            
            const Product = require('../models/product.model');
            
            // Fetch fresh product and variant data from database for price verification
            const productIds = [...new Set(productCartItems.map(item => item.product._id.toString()))];
            // Extract variant IDs - items are now plain objects from toObject()
            const variantIds = productCartItems
                .map(item => {
                    if (!item.variant) return null;
                    
                    // item.variant should be ObjectId or string (from toObject conversion)
                    if (item.variant instanceof mongoose.Types.ObjectId) {
                        return item.variant.toString();
                    }
                    if (typeof item.variant === 'string' && mongoose.Types.ObjectId.isValid(item.variant)) {
                        return item.variant;
                    }
                    if (item.variant._id) {
                        return item.variant._id.toString();
                    }
                    if (item.variant.toString && mongoose.Types.ObjectId.isValid(item.variant.toString())) {
                        return item.variant.toString();
                    }
                    return null;
                })
                .filter(id => id !== null)
                .filter((id, index, self) => self.indexOf(id) === index);

            // Fetch fresh products with embedded variants for price verification
            // Note: Products may not have 'pricing' field - prices are in variants
            const freshProducts = await Product.find({ _id: { $in: productIds } })
                .select('_id pricing partner variants'); // Include variants array for embedded variants

            // Try to fetch separate variant documents if they exist (optional)
            let freshVariants = [];
            let variantMap = new Map();
            
            if (variantIds.length > 0) {
                try {
                    const { Variant } = require('../models/variant.model');
                    if (Variant) {
                        freshVariants = await Variant.find({ _id: { $in: variantIds } })
                            .select('_id price commission')
                            .catch(() => []); // If Variant model doesn't exist, continue without it
                        variantMap = new Map(freshVariants.map(v => [v._id.toString(), v]));
                    }
                } catch (error) {
                    // Variant model might not be available or variants might be embedded
                    console.log('Variants appear to be embedded in products, using embedded variants');
                }
            }

            // Create lookup maps for faster access
            const productMap = new Map(freshProducts.map(p => [p._id.toString(), p]));

            // Build verified service order items from cart snapshot
            const verifiedServiceOrderItems = await Promise.all(serviceCartItems.map(async (item) => {
                const service = item.service;
                const originalPrice = Number(item.originalPrice ?? service?.pricing?.mrp ?? service?.pricing?.listPrice ?? 0);
                const price = Number(item.price ?? service?.pricing?.listPrice ?? service?.pricing?.mrp ?? originalPrice);
                const perUnitDiscount = Number(item.discount ?? 0);
                const quantity = Number(item.quantity ?? 1);
                const extrasTotal = item.selectedExtras ? item.selectedExtras.reduce((sum, extra) => sum + (Number(extra.price) || 0), 0) : 0;
                const totalPrice = Math.max(0, ((price + extrasTotal) * quantity) - (perUnitDiscount * quantity));
                const partnerId = (service?.partner && typeof service.partner === 'object' && service.partner.partnerId)
                    ? service.partner.partnerId
                    : null;
                const subscriptionId = await createSubscriptionForServiceOrderItem({
                    userId,
                    service,
                    cartItem: item,
                    quantity,
                    amountPaid: totalPrice
                });

                return {
                    itemType: 'service',
                    service: service._id,
                    subscription: subscriptionId,
                    name: service?.name || 'Service',
                    quantity,
                    price,
                    originalPrice,
                    discount: perUnitDiscount,
                    totalPrice,
                    selectedExtras: item.selectedExtras || [],
                    selectedDate: item.selectedDate || null,
                    serviceNotes: item.notes || null,
                    commission: {
                        percentage: 0,
                        amount: 0
                    },
                    partner: partnerId
                };
            }));

            // Price verification and recalculation
            const priceMismatches = [];
            const verifiedOrderItems = [...verifiedServiceOrderItems];

            for (const item of productCartItems) {
                const productId = item.product._id.toString();
                
                // Get variant ID from cart item (now a plain object from toObject())
                // Since we didn't populate variant, item.variant should be the ObjectId directly
                let variantId = null;
                
                if (item.variant) {
                    // item.variant should be an ObjectId (since we didn't populate it)
                    if (item.variant instanceof mongoose.Types.ObjectId) {
                        variantId = item.variant.toString();
                    } 
                    // If it's already a string (from toObject conversion)
                    else if (typeof item.variant === 'string' && mongoose.Types.ObjectId.isValid(item.variant)) {
                        variantId = item.variant;
                    }
                    // If it's an object with _id (shouldn't happen if not populated, but just in case)
                    else if (item.variant._id) {
                        variantId = item.variant._id.toString();
                    }
                    // If it's an object with toString (ObjectId-like)
                    else if (item.variant.toString && mongoose.Types.ObjectId.isValid(item.variant.toString())) {
                        variantId = item.variant.toString();
                    }
                }
                
                // Debug logging
                if (variantId) {
                    console.log(`✅ Extracted variant ID for product ${productId}: ${variantId}`);
                } else {
                    console.warn(`⚠️  Could not extract variant ID for product ${productId}. Item variant:`, item.variant, 'Type:', typeof item.variant, 'IsValid:', item.variant ? mongoose.Types.ObjectId.isValid(item.variant) : 'N/A');
                }
                
                // Get fresh data from database
                const freshProduct = productMap.get(productId);
                
                if (!freshProduct) {
                    throw new ErrorResponse(`Product ${productId} not found in database. It may have been deleted.`, StatusCodes.BAD_REQUEST);
                }

                // Get variant from separate collection or embedded in product
                let freshVariant = null;
                
                // Try database lookup using variantId
                if (variantId) {
                    // First try separate variant collection
                    freshVariant = variantMap.get(variantId);
                    
                    // If not found, try embedded variants in product
                    if (!freshVariant && freshProduct.variants && Array.isArray(freshProduct.variants)) {
                        // Find variant by _id (embedded variants have _id)
                        freshVariant = freshProduct.variants.find(v => {
                            if (!v) return false;
                            // Try matching by _id (ObjectId or string)
                            const vId = v._id ? v._id.toString() : null;
                            return vId === variantId || vId === variantId.toString();
                        });
                        
                        // If still not found, try by variantId field (some variants use variantId instead of _id)
                        if (!freshVariant) {
                            freshVariant = freshProduct.variants.find(v => 
                                v && v.variantId && v.variantId.toString() === variantId
                            );
                        }
                        
                        // Last resort: if product has variants but we can't match by ID, use first variant
                        if (!freshVariant && freshProduct.variants.length > 0) {
                            console.warn(`Could not match variant ${variantId}, using first available variant for product ${productId}`);
                            freshVariant = freshProduct.variants[0];
                        }
                    }
                }

                // Debug logging for troubleshooting
                if (variantId && !freshVariant) {
                    console.warn(`Variant ${variantId} not found for product ${productId}. Available variants:`, 
                        freshProduct.variants?.map(v => ({ 
                            _id: v?._id?.toString(), 
                            variantId: v?.variantId,
                            hasPrice: !!v?.price 
                        })) || 'none'
                    );
                }

                // Get authoritative price from database
                // Priority: variant price > product price
                let databasePrice = null;
                let databaseOriginalPrice = null;

                if (freshVariant && freshVariant.price) {
                    const variantPrices = freshVariant.price;
                    // Use only listPrice and mrp (no discounted, no costPrice)
                    databaseOriginalPrice = Number(variantPrices.mrp ?? variantPrices.listPrice ?? 0);
                    databasePrice = Number(variantPrices.listPrice ?? variantPrices.mrp ?? 0);
                    console.log(`Found variant price for ${productId}:`, {
                        variantId: variantId,
                        originalPrice: databaseOriginalPrice,
                        sellingPrice: databasePrice
                    });
                } else if (item.variant && item.variant.price) {
                    console.log(`Using cart item variant price for product ${productId}`);
                    const cartVariantPrice = item.variant.price;
                    databaseOriginalPrice = Number(cartVariantPrice.mrp ?? cartVariantPrice.listPrice ?? 0);
                    databasePrice = Number(cartVariantPrice.listPrice ?? cartVariantPrice.mrp ?? 0);
                } else if (freshProduct.pricing && freshProduct.pricing.basePrice) {
                    // Fallback to product pricing if variant not available
                    databaseOriginalPrice = Number(freshProduct.pricing.basePrice || 0);
                    databasePrice = Number(freshProduct.pricing.basePrice || 0);
                } else {
                    // Last resort: check if product has any variants and use first one
                    if (freshProduct.variants && Array.isArray(freshProduct.variants) && freshProduct.variants.length > 0) {
                        const firstVariant = freshProduct.variants[0];
                        if (firstVariant && firstVariant.price) {
                            console.warn(`Using first available variant price for product ${productId} as fallback`);
                            const variantPrices = firstVariant.price;
                            databaseOriginalPrice = Number(variantPrices.mrp ?? variantPrices.listPrice ?? 0);
                            databasePrice = Number(variantPrices.listPrice ?? variantPrices.mrp ?? 0);
                        } else {
                            throw new ErrorResponse(
                                `Price not found for product ${productId}${variantId ? ` variant ${variantId}` : ''}. Product has ${freshProduct.variants.length} variant(s) but none have valid price data.`, 
                                StatusCodes.BAD_REQUEST
                            );
                        }
                    } else {
                        throw new ErrorResponse(
                            `Price not found for product ${productId}${variantId ? ` variant ${variantId}` : ''}. Product has no variants and no base price. Product may be unavailable.`, 
                            StatusCodes.BAD_REQUEST
                        );
                    }
                }

                // Validate prices are valid numbers
                if (!Number.isFinite(databasePrice) || databasePrice <= 0) {
                    throw new ErrorResponse(`Invalid price for product ${productId}. Please contact support.`, StatusCodes.BAD_REQUEST);
                }

                // Get cart prices for comparison
                const cartPrice = Number(item.price || 0);
                const cartOriginalPrice = Number(item.originalPrice || cartPrice || databaseOriginalPrice);
                const cartDiscount = Number(item.discount || 0);
                const quantity = Number(item.quantity || 1);

                // Calculate expected price from database
                const expectedPrice = databasePrice; // Current selling price from database
                const expectedOriginalPrice = databaseOriginalPrice; // MRP/List price from database
                
                // Calculate discount from database prices
                const databaseDiscount = Math.max(0, expectedOriginalPrice - expectedPrice);
                
                // Verify prices match (allow small floating point differences)
                const priceTolerance = 0.01; // 1 paise tolerance
                const priceDifference = Math.abs(cartPrice - expectedPrice);
                const originalPriceDifference = Math.abs(cartOriginalPrice - expectedOriginalPrice);

                // Check for price manipulation
                if (priceDifference > priceTolerance) {
                    priceMismatches.push({
                        productId,
                        variantId,
                        cartPrice,
                        databasePrice: expectedPrice,
                        difference: priceDifference
                    });
                    console.warn(`⚠️  PRICE MISMATCH detected for product ${productId}: Cart=${cartPrice}, DB=${expectedPrice}, Diff=${priceDifference}`);
                }

                if (originalPriceDifference > priceTolerance) {
                    console.warn(`⚠️  ORIGINAL PRICE MISMATCH for product ${productId}: Cart=${cartOriginalPrice}, DB=${expectedOriginalPrice}, Diff=${originalPriceDifference}`);
                }

                // Use database prices only (ignore cart prices for security)
                const verifiedPrice = expectedPrice;
                const verifiedOriginalPrice = expectedOriginalPrice;
                const verifiedDiscount = databaseDiscount;

                // Get commission from database
                const commissionPercentage = Number(
                    (freshVariant && freshVariant.commission && freshVariant.commission.percentage) ??
                    (freshProduct.pricing && freshProduct.pricing.commission && freshProduct.pricing.commission.percentage) ??
                    0
                );

                const commissionAmount = Math.max(
                    0,
                    Number.isFinite(verifiedPrice) && Number.isFinite(commissionPercentage)
                        ? (verifiedPrice * commissionPercentage) / 100
                        : 0
                );

                const totalPrice = Math.max(0, verifiedPrice * quantity);

                // Get variant ObjectId for order item
                const variantObjectId = variantId && mongoose.Types.ObjectId.isValid(variantId) 
                    ? new mongoose.Types.ObjectId(variantId) 
                    : null;

                verifiedOrderItems.push({
                    product: item.product._id,
                    variant: variantObjectId,
                    quantity,
                    price: verifiedOriginalPrice, // Set price to the original MRP price as expected by orderItem schema hook
                    originalPrice: verifiedOriginalPrice, // Use verified database original price
                    discount: verifiedDiscount, // Use verified database discount
                    totalPrice,
                    commission: {
                        percentage: commissionPercentage,
                        amount: commissionAmount
                    },
                    partner: freshProduct.partner || null
                });
            }

            // On price mismatch: use verified DB prices and update cart (do not reject)
            if (priceMismatches.length > 0) {
                console.warn('⚠️ Price mismatch(es) – using verified DB prices:', { userId, timestamp: new Date().toISOString(), mismatches: priceMismatches });
                for (let i = 0; i < cart.items.length; i++) {
                    const item = cart.items[i];
                    if (item.itemType === 'service' || !item.product) {
                        continue;
                    }
                    const verified = verifiedOrderItems.find(
                        v => v.itemType === 'product' &&
                             v.product.toString() === item.product._id.toString() &&
                             (v.variant?.toString() || '') === (item.variant?.toString() || '')
                    );
                    if (verified) {
                        item.price = verified.price;
                        item.originalPrice = verified.originalPrice;
                        item.discount = verified.discount;
                    }
                }
                cart.calculateTotals();
                await cart.save();
            }

            // Recalculate cart totals using verified prices
            let verifiedSubtotal = 0;
            let verifiedTotalDiscount = 0;

            verifiedOrderItems.forEach(item => {
                verifiedSubtotal += item.originalPrice * item.quantity;
                verifiedTotalDiscount += item.discount * item.quantity;
            });

            // ========== COUPON VERIFICATION: Verify coupon discount from database ==========
            let verifiedCouponDiscount = 0;
            let appliedCouponData = null;

            // Amount after product discounts (sale price total) — coupon applies on this, not on MRP
            const verifiedAmountAfterProductDiscount = verifiedSubtotal - verifiedTotalDiscount;

            if (cart.appliedCoupon && cart.appliedCoupon.coupon) {
                const Coupon = require('../models/coupon.model');
                
                // Fetch fresh coupon from database for verification
                const couponId = cart.appliedCoupon.coupon._id || cart.appliedCoupon.coupon;
                const coupon = await Coupon.findById(couponId);

                if (!coupon) {
                    console.warn(`⚠️  Coupon ${couponId} not found in database. Ignoring coupon discount.`);
                    // Don't throw error, just ignore invalid coupon
                } else {
                    // Verify coupon is valid
                    if (!coupon.isValid) {
                        console.warn(`⚠️  Coupon ${coupon.code} is expired or inactive. Ignoring coupon discount.`);
                    } else if (!coupon.canUserUse(userId, verifiedAmountAfterProductDiscount)) {
                        console.warn(`⚠️  Coupon ${coupon.code} cannot be used by user or for this order amount. Ignoring coupon discount.`);
                    } else {
                        // Calculate discount from database (re-verify discount amount)
                        verifiedCouponDiscount = coupon.calculateDiscount(verifiedAmountAfterProductDiscount);
                        
                        // Compare with cart discount amount to detect manipulation
                        const cartCouponDiscount = Number(cart.appliedCoupon.discountAmount || 0);
                        const discountDifference = Math.abs(verifiedCouponDiscount - cartCouponDiscount);
                        
                        if (discountDifference > 0.01) {
                            console.warn(`⚠️  COUPON DISCOUNT MISMATCH: Cart=${cartCouponDiscount}, DB=${verifiedCouponDiscount}, Diff=${discountDifference}`);
                            console.error('🚨 COUPON DISCOUNT MANIPULATION ATTEMPT DETECTED:', {
                                userId,
                                couponCode: coupon.code,
                                cartDiscount: cartCouponDiscount,
                                verifiedDiscount: verifiedCouponDiscount,
                                timestamp: new Date().toISOString()
                            });
                            // Use verified discount (from database), ignore cart discount
                        }
                        
                        appliedCouponData = {
                            coupon: coupon._id,
                            code: coupon.code,
                            discountAmount: verifiedCouponDiscount // Use verified amount
                        };
                    }
                }
            }

            // Apply verified coupon discount
            verifiedTotalDiscount += verifiedCouponDiscount;

            const verifiedTotalAmount = verifiedSubtotal - verifiedTotalDiscount + cart.shippingCost;

            // Compare with cart totals (with tolerance)
            const cartTotalDifference = Math.abs(verifiedTotalAmount - cart.totalAmount);
            if (cartTotalDifference > 0.01) {
                console.warn(`⚠️  CART TOTAL MISMATCH: Cart Total=${cart.totalAmount}, Verified Total=${verifiedTotalAmount}, Diff=${cartTotalDifference}`);
            }

            // Use verified prices for order creation
            const orderItems = verifiedOrderItems;

            // Fetch address docs so we can set snapshots (required for Shiprocket after payment)
            const [shippingAddrDoc, billingAddrDoc] = await Promise.all([
                Address.findById(finalShippingAddressId),
                Address.findById(finalBillingAddressId)
            ]);
            if (!shippingAddrDoc) {
                throw new ErrorResponse('Shipping address not found', StatusCodes.NOT_FOUND);
            }
            if (!billingAddrDoc) {
                throw new ErrorResponse('Billing address not found', StatusCodes.NOT_FOUND);
            }
            // Address model doesn't store phone/name, so we source buyer phone from the User record.
            const buyerFullName = user?.name || undefined;
            const buyerPhone = user?.phoneNumber || undefined;

            const shippingSnapshot = {
                fullName: buyerFullName,
                phone: buyerPhone,
                line1: shippingAddrDoc.shippingAddress?.street || '',
                city: shippingAddrDoc.shippingAddress?.city || '',
                state: shippingAddrDoc.shippingAddress?.state || '',
                postalCode: shippingAddrDoc.shippingAddress?.postalCode || '',
                country: shippingAddrDoc.shippingAddress?.country || 'IN'
            };
            const billingSnapshot = {
                fullName: buyerFullName,
                phone: buyerPhone,
                line1: billingAddrDoc.billingAddress?.street || '',
                city: billingAddrDoc.billingAddress?.city || '',
                state: billingAddrDoc.billingAddress?.state || '',
                postalCode: billingAddrDoc.billingAddress?.postalCode || '',
                country: billingAddrDoc.billingAddress?.country || 'IN'
            };

            const notesObj = typeof notes === 'object' && notes !== null ? notes : {};
            // Non-blocking preference handling: only save customer instructions.
            const customerInstructions = (
                (typeof deliveryInstructions === 'string' && deliveryInstructions.trim()) ||
                (typeof instructions === 'string' && instructions.trim()) ||
                (typeof notesObj.customer === 'string' && notesObj.customer.trim()) ||
                (cart.checkoutPreferences?.deliveryInstructions &&
                    String(cart.checkoutPreferences.deliveryInstructions).trim()) ||
                ''
            ).slice(0, 2000);

            const effectivePaymentMethod = ['cod', 'online', 'wallet', 'upi'].includes(paymentMethod)
                ? paymentMethod
                : (cart.checkoutPreferences?.paymentMethod || 'online');

            // Create order with verified prices from database
            const order = await Order.create({
                user: userId,
                items: orderItems,
                subtotal: verifiedSubtotal, // Use verified subtotal
                totalDiscount: verifiedTotalDiscount, // Use verified discount (includes verified coupon)
                shippingCost: cart.shippingCost,
                taxAmount: cart.taxAmount,
                totalAmount: verifiedTotalAmount, // Use verified total amount
                appliedCoupon: appliedCouponData || cart.appliedCoupon, // Use verified coupon data
                shippingAddress: finalShippingAddressId,
                billingAddress: finalBillingAddressId,
                contact: {
                    email: user?.email || undefined,
                    phone: user?.phoneNumber || undefined
                },
                shippingAddressSnapshot: shippingSnapshot,
                billingAddressSnapshot: billingSnapshot,
                payment: {
                    method: effectivePaymentMethod,
                    status: 'pending',
                    gateway: 'razorpay'
                },
                deliveryPreferences: {
                    instructions: customerInstructions || undefined,
                    contactless: false
                },
                shipping: {
                    method: 'Standard Delivery',
                    estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
                notes: {
                    customer: customerInstructions || '',
                    internal: notesObj.internal || ''
                }
            });

            // Calculate partner payments
            order.calculatePartnerPayments();
            await order.save();

            // Create Razorpay order (no payment link)
            const merchantOrderId = order.orderNumber || order._id.toString();
            const razorpayOrder = await razorpayService.createOrder({
                amount: order.totalAmount,
                currency: 'INR',
                merchantOrderId,
                receipt: order.orderNumber,
                notes: {
                    orderId: order._id.toString(),
                    orderNumber: order.orderNumber,
                    userId: userId.toString()
                }
            });

            if (!razorpayOrder.success) {
                throw new ErrorResponse(razorpayOrder.message || 'Failed to create Razorpay order', StatusCodes.INTERNAL_SERVER_ERROR);
            }

            // Store order details for later verification (status remains pending; webhook updates it)
            order.payment.transactionId = razorpayOrder.orderId;
            order.payment.merchantOrderId = merchantOrderId;
            order.payment.keyId = razorpayService.getKeyId();
            order.payment.currency = 'INR';
            order.payment.amount = order.totalAmount;
            await order.save();

            await ensureMetaPurchaseEventId(order, {});

            // Server-side CAPI InitiateCheckout (best-effort, non-blocking)
            queueInitiateCheckoutCapiEvent({ req, order });

            console.log('✅ Razorpay order created:', {
                orderId: order._id,
                orderNumber: order.orderNumber,
                razorpayOrderId: razorpayOrder.orderId,
                merchantOrderId: merchantOrderId
            });

            // Build verify URL for frontend to redirect after payment (uses env-configured callback)
            // Note: razorpay_payment_id and razorpay_signature will be added by Razorpay after payment
            const verifyUrl = razorpayService.buildCallbackUrl({
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                merchantOrderId,
                razorpay_order_id: razorpayOrder.orderId // Razorpay expects this parameter name
            });

            console.log("verifyUrl:", verifyUrl);

            return res.status(StatusCodes.OK).json({
                success: true,
                keyId: razorpayService.getKeyId(),
                razorpayOrderId: razorpayOrder.orderId,
                merchantOrderId,
                amountInPaise: razorpayOrder.amount,
                amount: order.totalAmount,
                currency: 'INR',
                verifyUrl, // Frontend should redirect here after payment with query params
                order: {
                    id: order._id,
                    orderNumber: order.orderNumber,
                    totalAmount: order.totalAmount,
                    metaPurchaseEventId: buildEventId(order)
                },
                orderSummary: {
                    subtotal: order.subtotal,
                    totalDiscount: order.totalDiscount,
                    shippingCost: order.shippingCost,
                    taxAmount: order.taxAmount,
                    totalAmount: order.totalAmount
                }
            });

        } catch (error) {
            console.error("Error creating Razorpay payment from cart:", error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: error.message || "Error creating Razorpay payment from cart"
            });
        }
    }

//verify razorpay payment
    async verifyRazorpayPayment(req, res, next) {
        try {

            console.log("verifyRazorpayPayment started");
            // Accept from query (GET callback) or body (POST webhook)
            const payload = { ...req.query, ...req.body };
            
            const {
                razorpay_payment_id,
                razorpay_order_id,
                razorpay_signature
            } = payload;

            console.log("razorpay_payment_id in verifyRazorpayPayment:", razorpay_payment_id);
            console.log("razorpay_order_id in verifyRazorpayPayment:", razorpay_order_id);

            if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: 'Missing razorpay_payment_id, razorpay_order_id or razorpay_signature'
                });
            }

            // Build signature body: order_id|payment_id
            const body = `${razorpay_order_id}|${razorpay_payment_id}`;

            // Resolve via razorpayConfig so prefixed (RAZORPAY_TEST_/RAZORPAY_PROD_) and
            // generic (RAZORPAY_) env names both work, matching razorpayService.
            const secret = razorpayConfig.KEY_SECRET;
            if (!secret) {
                return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
                    success: false, 
                    message: 'Razorpay secret not configured' 
                });
            }

            const expectedSignature = crypto
                .createHmac("sha256", secret)
                .update(body.toString())
                .digest("hex");

            const isValid = safeSignatureEqual(razorpay_signature, expectedSignature);

            if (!isValid) {
                // Build failure URL and redirect
                const failureUrl = razorpayService.buildFailureUrl({
                    status: 'failed',
                    reason: 'Invalid signature',
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id
                });
                
                // Try to find and update order with callback verification failure (if order exists)
                try {
                    const orderForCallback = await Order.findOne({ 'payment.transactionId': razorpay_order_id });
                    if (orderForCallback) {
                        orderForCallback.payment.callbackVerification = {
                            verified: true,
                            status: 'invalid_signature',
                            verifiedAt: new Date(),
                            razorpayPaymentId: razorpay_payment_id,
                            razorpayOrderId: razorpay_order_id,
                            signatureValid: false,
                            error: 'Invalid signature',
                            redirectUrl: failureUrl
                        };
                        await orderForCallback.save();
                    }
                } catch (err) {
                    console.warn('Failed to save callback verification for invalid signature:', err.message);
                }
                
                // Check if request wants JSON response
                const wantsJson = req.headers.accept?.includes('application/json') || 
                                 req.query.format === 'json';
                
                if (wantsJson) {
                    return res.status(StatusCodes.BAD_REQUEST).json({ 
                        success: false, 
                        message: "Invalid signature",
                        redirectUrl: failureUrl
                    });
                }
                
                return res.redirect(failureUrl);
            }

            // Find order by razorpay order_id (do not mutate status here - webhook is source of truth)
            // Also check for pre-order payments
            let order = await Order.findOne({ 'payment.transactionId': razorpay_order_id });
            let preOrderPayment = null;
            
            // If order not found, check for pre-order payment
            if (!order) {
                preOrderPayment = await PreOrderPayment.findOne({ 'payment.transactionId': razorpay_order_id });
            }

            if (!order && !preOrderPayment) {
                console.warn('Order or PreOrderPayment not found for Razorpay order_id:', razorpay_order_id);
                
                const failureUrl = razorpayService.buildFailureUrl({
                    status: 'failed',
                    reason: 'Order/PreOrderPayment not found',
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id
                });
                
                // Note: Can't save callback verification since order/preOrderPayment doesn't exist
                
                // Check if request wants JSON response
                const wantsJson = req.headers.accept?.includes('application/json') || 
                                 req.query.format === 'json';
                
                if (wantsJson) {
                    return res.status(StatusCodes.NOT_FOUND).json({
                        success: false,
                        message: 'Order or PreOrderPayment not found. Please check if razorpay_order_id is correct.',
                        redirectUrl: failureUrl
                    });
                }

                // Browser request: redirect to the failure page. Without this return the
                // handler fell through with successUrl/failureUrl unset and hit
                // res.redirect(undefined) further down, surfacing a 500 instead.
                return res.redirect(failureUrl);
            }

            // BOLA check: Ensure that if an order has an associated user and req.user exists, they match (or user is admin)
            if (order && order.user && req.user && order.user.toString() !== req.user.id && req.user.role !== 'admin') {
                return res.status(StatusCodes.FORBIDDEN).json({
                    success: false,
                    message: "Access denied: You are not authorized to verify this order's payment"
                });
            }

            // Fetch payment status from Razorpay to determine success/failure
            const paymentResult = await razorpayService.fetchPayment(razorpay_payment_id);
            const isPaymentSuccessful = paymentResult.success && 
                                       paymentResult.payment && 
                                       (paymentResult.payment.status === 'captured' || 
                                        paymentResult.payment.status === 'authorized');

            // Determine if this is an Order or PreOrderPayment
            const isPreOrder = !!preOrderPayment;
            const entity = order || preOrderPayment;

            // Do NOT mutate order/payment status here. Webhook is the source of truth.
            if (order) {
                console.log('ℹ️  Skipping order status update in verifyRazorpayPayment (webhook is source of truth).', {
                    currentPaymentStatus: order.payment.status,
                    currentOrderStatus: order.status,
                    razorpayPaymentStatus: paymentResult.payment?.status
                });
            } else if (preOrderPayment) {
                console.log('ℹ️  Skipping pre-order payment status update in verifyRazorpayPayment (webhook is source of truth).', {
                    currentPaymentStatus: preOrderPayment.status,
                    razorpayPaymentStatus: paymentResult.payment?.status
                });
            }

            // Build redirect URLs (different for Orders vs PreOrderPayments)
            let successUrl, failureUrl;
            
            if (order) {
                // Marketplace order: align Pixel eventID with CAPI event_id (Meta dedup)
                if (isPaymentSuccessful) {
                    const metaPurchaseParams = await getMetaPurchaseSuccessQueryParams(order, {
                        gatewayTransactionId: razorpay_payment_id
                    });
                    successUrl = razorpayService.buildSuccessUrl({
                        orderId: metaPurchaseParams.orderId,
                        orderNumber: metaPurchaseParams.orderNumber,
                        paymentId: razorpay_payment_id,
                        razorpayOrderId: razorpay_order_id,
                        status: 'success',
                        meta_event_id: metaPurchaseParams.meta_event_id,
                        value: metaPurchaseParams.value,
                        currency: metaPurchaseParams.currency
                    });
                } else {
                    successUrl = razorpayService.buildSuccessUrl({
                        orderId: order._id.toString(),
                        orderNumber: order.orderNumber,
                        paymentId: razorpay_payment_id,
                        razorpayOrderId: razorpay_order_id,
                        status: 'success'
                    });
                }

                failureUrl = razorpayService.buildFailureUrl({
                    orderId: order._id.toString(),
                    orderNumber: order.orderNumber,
                    paymentId: razorpay_payment_id,
                    razorpayOrderId: razorpay_order_id,
                    status: 'failed',
                    reason: paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'
                });
            } else if (preOrderPayment) {
                // For pre-order payments
                successUrl = razorpayService.buildSuccessUrl({
                    preOrderPaymentId: preOrderPayment._id.toString(),
                    preOrderId: preOrderPayment.preOrder.toString(),
                    paymentId: razorpay_payment_id,
                    razorpayOrderId: razorpay_order_id,
                    status: 'success'
                });

                failureUrl = razorpayService.buildFailureUrl({
                    preOrderPaymentId: preOrderPayment._id.toString(),
                    preOrderId: preOrderPayment.preOrder.toString(),
                    paymentId: razorpay_payment_id,
                    razorpayOrderId: razorpay_order_id,
                    status: 'failed',
                    reason: paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'
                });
            }

            // Check if request wants JSON response (API call) or redirect (browser)
            const wantsJson = req.headers.accept?.includes('application/json') || 
                             req.query.format === 'json' ||
                             req.body.format === 'json';

            // Save callback verification data to order or pre-order payment
            try {
                if (order) {
                    order.payment.callbackVerification = {
                        verified: true,
                        status: isPaymentSuccessful ? 'success' : 'failed',
                        verifiedAt: new Date(),
                        razorpayPaymentId: razorpay_payment_id,
                        razorpayOrderId: razorpay_order_id,
                        signatureValid: true, // We already passed signature validation above
                        paymentStatus: paymentResult.payment?.status || 'unknown',
                        error: isPaymentSuccessful ? null : (paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'),
                        responseType: wantsJson ? 'json' : 'redirect'
                    };
                    await order.save();
                    console.log('✅ Callback verification data saved to order:', order.orderNumber);
                } else if (preOrderPayment) {
                    const previousStatus = preOrderPayment.payment.callbackVerification?.status;
                    preOrderPayment.payment.callbackVerification = {
                        verified: true,
                        status: isPaymentSuccessful ? 'success' : 'failed',
                        verifiedAt: new Date(),
                        razorpayPaymentId: razorpay_payment_id,
                        razorpayOrderId: razorpay_order_id,
                        signatureValid: true, // We already passed signature validation above
                        paymentStatus: paymentResult.payment?.status || 'unknown',
                        error: isPaymentSuccessful ? null : (paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'),
                        responseType: wantsJson ? 'json' : 'redirect'
                    };
                    await preOrderPayment.save();
                    console.log('✅ Callback verification data saved to pre-order payment:', preOrderPayment._id);

                    // Send confirmation email when callback verification status is 'success' (only if not sent before)
                    if (isPaymentSuccessful && preOrderPayment.payment.callbackVerification.status === 'success') {
                        try {
                            // Populate preOrder if not already populated
                            const preOrder = await PreOrder.findById(preOrderPayment.preOrder);
                            
                            if (preOrder && !preOrder.emailSent?.confirmationSent) {
                                const { sendPreOrderConfirmationEmail } = require('../utils/emailService');
                                
                                const emailDetails = {
                                    orderId: preOrder._id.toString(),
                                    amount: preOrderPayment.amount || 0,
                                    couponCode: preOrder.coupon?.code || null,
                                    discountAmount: preOrder.coupon?.discountAmount || null
                                };
                                
                                const emailResult = await sendPreOrderConfirmationEmail(preOrder.email, preOrder.name, emailDetails);
                                
                                if (emailResult.success) {
                                    // Mark email as sent
                                    preOrder.emailSent = {
                                        confirmationSent: true,
                                        confirmationSentAt: new Date()
                                    };
                                    await preOrder.save();
                                    console.log('✅ Pre-order confirmation email sent to:', preOrder.email);
                                } else {
                                    console.warn('⚠️  Failed to send pre-order confirmation email:', emailResult.error);
                                }
                            } else if (preOrder?.emailSent?.confirmationSent) {
                                console.log('ℹ️  Pre-order confirmation email already sent for:', preOrder._id);
                            }
                        } catch (emailError) {
                            console.warn('⚠️  Failed to send pre-order confirmation email:', emailError?.message || emailError);
                            // Don't fail the payment verification if email fails
                        }
                    }
                }
            } catch (err) {
                console.warn('⚠️  Failed to save callback verification data:', err.message);
                // Continue execution even if saving fails
            }

            if (wantsJson) {
                // Return JSON for API calls
                const response = {
                    success: isPaymentSuccessful, 
                    message: isPaymentSuccessful ? "Payment verified successfully" : "Payment verification failed", 
                    verified: true,
                    redirectUrl: isPaymentSuccessful ? successUrl : failureUrl,
                    data: { 
                        razorpay_order_id, 
                        razorpay_payment_id 
                    },
                    payment: {
                        id: razorpay_payment_id,
                        status: paymentResult.payment?.status
                    }
                };

                // Add order or preOrderPayment data based on what was found
                if (order) {
                    response.order = {
                        id: order._id,
                        orderNumber: order.orderNumber,
                        status: order.status,
                        paymentStatus: order.payment.status
                    };
                    if (isPaymentSuccessful) {
                        response.order.metaPurchaseEventId = buildEventId(order);
                    }
                } else if (preOrderPayment) {
                    response.preOrderPayment = {
                        id: preOrderPayment._id,
                        preOrderId: preOrderPayment.preOrder,
                        status: preOrderPayment.status,
                        amount: preOrderPayment.amount
                    };
                }

                return res.status(StatusCodes.OK).json(response);
            }

            // Redirect to frontend success/failure page (browser requests)
            if (isPaymentSuccessful) {
                console.log('✅ Payment verified successfully, redirecting to success page:', successUrl);
                return res.redirect(successUrl);
            } else {
                console.log('❌ Payment verification failed, redirecting to failure page:', failureUrl);
                return res.redirect(failureUrl);
            }

        } catch (error) {
            console.error("Error verifying Razorpay payment:", error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
                success: false, 
                message: error.message || "Error verifying Razorpay payment"
            });
        }
    }


//razorpay webhook
    async razorpayWebhook(req, res, next) {
        try {
            console.log("🔔 ========== Razorpay Webhook Received ==========");
            console.log("📥 Request Method:", req.method);
            console.log("📥 Request URL:", req.url);
            console.log("📥 Request Headers:", {
                'content-type': req.headers['content-type'],
                'x-razorpay-signature': req.headers['x-razorpay-signature'] ? 'present' : 'missing'
            });

            // Resolve via razorpayConfig so prefixed (RAZORPAY_TEST_/RAZORPAY_PROD_) and
            // generic (RAZORPAY_) env names both work. Lets test and live coexist in one deploy.
            const webhookSecret = razorpayConfig.WEBHOOK_SECRET;
            
            const razorpaySignature = req.headers["x-razorpay-signature"];
            
            console.log("🔑 Webhook Secret:", webhookSecret ? `${webhookSecret.substring(0, 5)}...` : 'NOT SET');
            console.log("🔑 Razorpay Signature:", razorpaySignature ? `${razorpaySignature.substring(0, 20)}...` : 'MISSING');

            // Validate webhook secret is configured
            if (!webhookSecret) {
                console.error("❌ RAZORPAY_WEBHOOK_SECRET not configured");
                return res.status(500).json({ success: false, message: "Webhook secret not configured" });
            }

            // Validate signature header is present
            if (!razorpaySignature) {
                console.error("❌ Missing x-razorpay-signature header");
                return res.status(400).json({ success: false, message: "Missing signature" });
            }

            // Ensure body is a Buffer (raw body)
            let body = req.body;
            console.log("📦 Body Type:", Buffer.isBuffer(body) ? 'Buffer ✅' : typeof body);
            console.log("📦 Body Length:", Buffer.isBuffer(body) ? body.length : 'N/A');
            
            if (!Buffer.isBuffer(body)) {
                // If body was already parsed as JSON, convert back to Buffer
                // This shouldn't happen if middleware is configured correctly
                console.warn("⚠️  Body is not a Buffer, converting from object");
                body = Buffer.from(JSON.stringify(body));
                console.log("📦 Converted body to Buffer, length:", body.length);
            }

            // Verify webhook signature
            console.log("🔐 Computing expected signature...");
            const bodyString = body.toString();
            console.log("🔐 Body (first 200 chars):", bodyString.substring(0, 200));
            console.log("🔐 Body (last 200 chars):", bodyString.substring(Math.max(0, bodyString.length - 200)));
            console.log("🔐 Body (full length):", bodyString.length, "characters");
            
            const expectedSignature = crypto
                .createHmac("sha256", webhookSecret)
                .update(body)
                .digest("hex");

            // Timing-safe, and length-guarded so a malformed header returns 400 rather than
            // throwing a RangeError into the catch block.
            const signaturesMatch = safeSignatureEqual(razorpaySignature, expectedSignature);

            if (!signaturesMatch) {
                console.error("❌ Invalid Razorpay webhook signature");
                console.error("❌ Signature mismatch - webhook rejected");
                return res.status(400).json({ success: false, message: "Invalid signature" });
            }

            console.log("✅ Razorpay webhook signature verified successfully");
            
            // Parse event
            console.log("📋 Parsing webhook event...");
            const event = JSON.parse(body.toString());
            console.log("📋 Event Type:", event?.event || 'UNKNOWN');
            console.log("📋 Event Payload Keys:", event?.payload ? Object.keys(event.payload) : 'NO PAYLOAD');

            if (!event || !event.event) {
                console.error("❌ Invalid webhook payload: missing event");
                console.error("❌ Event object:", JSON.stringify(event, null, 2));
                return res.status(400).json({ success: false, message: "Invalid payload" });
            }

            // Helper function to find order by various identifiers
            const findOrder = async (razorpayOrderId, paymentLinkId, merchantOrderId, paymentId) => {
                console.log("🔍 ========== Searching for Order ==========");
                console.log("🔍 Razorpay Order ID:", razorpayOrderId || 'NOT PROVIDED');
                console.log("🔍 Payment Link ID:", paymentLinkId || 'NOT PROVIDED');
                console.log("🔍 Merchant Order ID:", merchantOrderId || 'NOT PROVIDED');
                console.log("🔍 Payment ID:", paymentId || 'NOT PROVIDED');

                // Try finding by Razorpay Order ID (for regular orders - stored in transactionId)
                if (razorpayOrderId) {
                    console.log("🔍 Attempting to find order by Razorpay Order ID (transactionId):", razorpayOrderId);
                    let order = await Order.findOne({ 'payment.transactionId': razorpayOrderId });
                    if (order) {
                        console.log('✅ Order found by Razorpay Order ID:', order._id);
                        return { order, preOrderPayment: null };
                    }
                    // Try pre-order payment with transactionId
                    let preOrderPayment = await PreOrderPayment.findOne({ 'payment.transactionId': razorpayOrderId });
                    if (preOrderPayment) {
                        console.log('✅ PreOrderPayment found by Razorpay Order ID:', preOrderPayment._id);
                        return { order: null, preOrderPayment };
                    }
                    console.log('❌ No order/pre-order found by Razorpay Order ID');
                }

                // Try finding by payment link ID (stored in paymentLinkId)
                if (paymentLinkId) {
                    console.log("🔍 Attempting to find order by paymentLinkId:", paymentLinkId);
                    let order = await Order.findOne({ 
                        $or: [
                            { 'payment.transactionId': paymentLinkId },
                            { 'payment.paymentLinkId': paymentLinkId }
                        ]
                    });
                    if (order) {
                        console.log('✅ Order found by paymentLinkId:', order._id);
                        return { order, preOrderPayment: null };
                    }

                    let preOrderPayment = await PreOrderPayment.findOne({
                        $or: [
                            { 'payment.transactionId': paymentLinkId },
                            { 'payment.paymentLinkId': paymentLinkId }
                        ]
                    });
                    if (preOrderPayment) {
                        console.log('✅ PreOrderPayment found by paymentLinkId:', preOrderPayment._id);
                        return { order: null, preOrderPayment };
                    }

                    console.log('❌ No order/pre-order found by paymentLinkId');
                }

                // Try finding by merchantOrderId from notes
                if (merchantOrderId) {
                    console.log("🔍 Attempting to find order by merchantOrderId:", merchantOrderId);
                    let order = await Order.findOne({ 'payment.merchantOrderId': merchantOrderId });
                    if (order) {
                        console.log('✅ Order found by merchantOrderId:', order._id);
                        return { order, preOrderPayment: null };
                    }

                    let preOrderPayment = await PreOrderPayment.findOne({ 'payment.merchantOrderId': merchantOrderId });
                    if (preOrderPayment) {
                        console.log('✅ PreOrderPayment found by merchantOrderId:', preOrderPayment._id);
                        return { order: null, preOrderPayment };
                    }

                    console.log('❌ No order/pre-order found by merchantOrderId');
                }

                // Try finding by payment ID (gatewayTransactionId)
                if (paymentId) {
                    console.log("🔍 Attempting to find order by paymentId (gatewayTransactionId):", paymentId);
                    let order = await Order.findOne({ 'payment.gatewayTransactionId': paymentId });
                    if (order) {
                        console.log('✅ Order found by paymentId:', order._id);
                        return { order, preOrderPayment: null };
                    }

                    let preOrderPayment = await PreOrderPayment.findOne({ 'payment.gatewayTransactionId': paymentId });
                    if (preOrderPayment) {
                        console.log('✅ PreOrderPayment found by paymentId:', preOrderPayment._id);
                        return { order: null, preOrderPayment };
                    }

                    console.log('❌ No order/pre-order found by paymentId');
                }

                // Woggle pre-orders live in their own collection. They are checked last so
                // existing lookups are unaffected, but including them here means the main
                // webhook confirms them even if only this endpoint is registered with Razorpay.
                const woggleQueries = [
                    razorpayOrderId && { 'payment.transactionId': razorpayOrderId },
                    paymentLinkId && { $or: [{ 'payment.transactionId': paymentLinkId }, { 'payment.paymentLinkId': paymentLinkId }] },
                    merchantOrderId && { 'payment.merchantOrderId': merchantOrderId },
                    paymentId && { 'payment.gatewayTransactionId': paymentId }
                ].filter(Boolean);

                for (const query of woggleQueries) {
                    const wogglePreOrder = await WogglePreOrder.findOne(query);
                    if (wogglePreOrder) {
                        console.log('✅ WogglePreOrder found:', wogglePreOrder._id);
                        return { order: null, preOrderPayment: null, wogglePreOrder };
                    }
                }

                console.warn('❌ Order/PreOrderPayment/WogglePreOrder not found for webhook:', { razorpayOrderId, paymentLinkId, merchantOrderId, paymentId });
                return { order: null, preOrderPayment: null, wogglePreOrder: null };
            };

            /**
             * Mark a Woggle pre-order paid. Shared by payment.captured and payment_link.paid.
             * Idempotent: an already-completed record is left untouched.
             */
            const completeWogglePreOrder = async (wogglePreOrder, { paymentId, razorpayOrderId, paymentLinkId, expectedPaise, receivedPaise, event }) => {
                if (wogglePreOrder.paymentStatus === 'completed') {
                    console.log('ℹ️  WogglePreOrder already completed, skipping:', wogglePreOrder._id);
                    return;
                }
                if (!amountsMatch(wogglePreOrder.amount, receivedPaise)) {
                    console.error('🚨 AMOUNT MISMATCH - refusing to confirm Woggle pre-order', {
                        wogglePreOrderId: wogglePreOrder._id.toString(), expectedPaise, receivedPaise
                    });
                    return; // Held pending for manual review.
                }
                wogglePreOrder.paymentStatus = 'completed';
                wogglePreOrder.status = 'payment_completed';
                wogglePreOrder.payment = wogglePreOrder.payment || {};
                wogglePreOrder.payment.completedAt = wogglePreOrder.payment.completedAt || new Date();
                if (paymentId) wogglePreOrder.payment.gatewayTransactionId = paymentId;
                if (paymentLinkId) wogglePreOrder.payment.paymentLinkId = paymentLinkId;
                await wogglePreOrder.save();
                console.log(`✅ WogglePreOrder confirmed via ${event}:`, wogglePreOrder._id);
            };

            // ✅ Handle events
            console.log("🎯 Processing event:", event.event);
            switch (event.event) {
                case "payment.captured": {
                    console.log("💰 ========== Processing payment.captured Event ==========");
                    const payment = event.payload?.payment?.entity;
                    if (!payment) {
                        console.error("❌ Missing payment entity in payload");
                        console.error("❌ Payload structure:", JSON.stringify(event.payload, null, 2));
                        break;
                    }

                    console.log("💰 Payment ID:", payment.id);
                    console.log("💰 Payment Status:", payment.status);
                    console.log("💰 Payment Amount:", payment.amount);
                    console.log("💰 Payment Currency:", payment.currency);
                    console.log("💰 Payment Method:", payment.method);
                    console.log("💰 Payment Order ID:", payment.order_id);
                    console.log("💰 Payment Notes:", payment.notes);
                    
                    // Extract identifiers
                    const paymentId = payment.id;
                    // For regular Razorpay orders, order_id is in payment.order_id
                    const razorpayOrderId = payment.order_id;
                    // For payment links, paymentLinkId might be in notes or payment_link entity
                    const paymentLinkId = payment.notes?.paymentLinkId || event.payload?.payment_link?.entity?.id;
                    // merchantOrderId is usually in payment.notes or payment_link notes
                    const merchantOrderId = payment.notes?.merchantOrderId || 
                                           payment.notes?.orderNumber ||
                                           event.payload?.payment_link?.entity?.notes?.merchantOrderId ||
                                           event.payload?.payment_link?.entity?.notes?.orderNumber;

                    console.log("🔑 Extracted Identifiers:", {
                        paymentId,
                        razorpayOrderId: razorpayOrderId || 'NOT FOUND',
                        paymentLinkId: paymentLinkId || 'NOT FOUND',
                        merchantOrderId: merchantOrderId || 'NOT FOUND'
                    });

                    // Find order (pass razorpayOrderId first for regular orders)
                    const { order, preOrderPayment, wogglePreOrder } = await findOrder(razorpayOrderId, paymentLinkId, merchantOrderId, paymentId);

                    if (wogglePreOrder) {
                        await completeWogglePreOrder(wogglePreOrder, {
                            paymentId, razorpayOrderId, paymentLinkId,
                            expectedPaise: Math.round(Number(wogglePreOrder.amount) * 100),
                            receivedPaise: payment.amount,
                            event: 'payment.captured'
                        });
                        break;
                    }

                    if (!order && !preOrderPayment) {
                        console.warn("⚠️  Order/PreOrderPayment not found - webhook processed but no record updated");
                        break;
                    }

                    if (order) {
                        if (order.payment.status === 'completed') {
                            console.log("ℹ️  Order payment already completed, skipping update");
                            break;
                        }

                        // Never confirm an order for less (or more) than it costs.
                        if (!amountsMatch(order.totalAmount, payment.amount)) {
                            const expectedPaise = Math.round(Number(order.totalAmount) * 100);
                            console.error('🚨 AMOUNT MISMATCH - refusing to confirm order', {
                                orderNumber: order.orderNumber,
                                expectedPaise,
                                receivedPaise: payment.amount,
                                paymentId
                            });
                            order.payment.amountMismatch = {
                                expectedPaise,
                                receivedPaise: payment.amount,
                                detectedAt: new Date(),
                                event: 'payment.captured'
                            };
                            order.payment.gatewayTransactionId = paymentId;
                            order.updatedAt = new Date();
                            await order.save();
                            break; // Held pending for manual review - no stock deduction, no shipping.
                        }

                        console.log("📝 ========== Updating Order ==========");
                        console.log("📝 Order ID:", order._id);
                        console.log("📝 Current Payment Status:", order.payment.status);
                        console.log("📝 Current Order Status:", order.status);

                        // Update order payment status
                        order.payment.status = 'completed';
                        order.payment.paidAt = new Date();
                        order.payment.gatewayTransactionId = paymentId;
                        console.log("📝 Updated payment status to: completed");
                        console.log("📝 Set paidAt:", order.payment.paidAt);

                        // Update order status if pending
                        if (['pending', 'confirmed'].includes(order.status)) {
                            console.log("📝 Updating order status from", order.status, "to confirmed");
                            if (typeof order.updateStatus === 'function') {
                                order.updateStatus('confirmed');
                                console.log("📝 Used order.updateStatus() method");
                            } else {
                                order.status = 'confirmed';
                                order.statusHistory = order.statusHistory || [];
                                order.statusHistory.push({ 
                                    status: 'confirmed', 
                                    note: 'Auto-confirmed via Razorpay webhook', 
                                    at: new Date() 
                                });
                                order.confirmedAt = order.confirmedAt || new Date();
                                console.log("📝 Updated order status manually");
                            }
                            console.log("📝 New Order Status:", order.status);
                        } else {
                            console.log("ℹ️  Order status is", order.status, "- not updating");
                        }

                        // Clear user's cart
                        console.log("🛒 ========== Clearing User Cart ==========");
                        console.log("🛒 User ID:", order.user);
                        try {
                            const userCart = await Cart.findOne({ user: order.user });
                            if (userCart) {
                                const itemsCount = userCart.items?.length || 0;
                                console.log("🛒 Cart found with", itemsCount, "items");
                                if (typeof userCart.clearCart === 'function') {
                                    userCart.clearCart();
                                    console.log("🛒 Used cart.clearCart() method");
                                } else {
                                    userCart.items = [];
                                    console.log("🛒 Cleared cart items manually");
                                }
                                await userCart.save();
                                console.log('✅ Cart cleared successfully for user:', order.user);
                            } else {
                                console.log('ℹ️  No cart found for user:', order.user);
                            }
                        } catch (e) {
                            console.error('❌ Cart clear after webhook payment failed:', e?.message);
                            console.error('❌ Error stack:', e?.stack);
                        }

                        order.updatedAt = new Date();
                        console.log("💾 Saving order to database...");
                        await order.save();
                        console.log('✅ Order updated successfully via payment.captured webhook');
                        try {
                            await deductStockForOrder(order);
                        } catch (stockErr) {
                            console.error('Stock deduction failed after order save:', stockErr.message);
                        }
                        console.log("✅ Order Number:", order.orderNumber);
                        console.log("✅ Final Payment Status:", order.payment.status);
                        console.log("✅ Final Order Status:", order.status);

                        // Create Shiprocket order when payment is completed
                        await createShiprocketOrderOnPaymentComplete(order);
                        // Best-effort analytics event (do not block webhook processing)
                        queuePurchaseCapiEvent({ req, order });
                    } else if (preOrderPayment) {
                        if (preOrderPayment.status === 'completed') {
                            console.log("ℹ️  PreOrderPayment already completed, skipping update");
                            break;
                        }

                        console.log("📝 ========== Updating PreOrderPayment ==========");
                        console.log("📝 PreOrderPayment ID:", preOrderPayment._id);
                        console.log("📝 Current Payment Status:", preOrderPayment.status);

                        preOrderPayment.status = 'completed';
                        preOrderPayment.payment = preOrderPayment.payment || {};
                        preOrderPayment.payment.gatewayTransactionId = paymentId;
                        preOrderPayment.payment.transactionId = preOrderPayment.payment.transactionId || razorpayOrderId;
                        preOrderPayment.payment.merchantOrderId = preOrderPayment.payment.merchantOrderId || merchantOrderId || null;
                        preOrderPayment.payment.completedAt = preOrderPayment.payment.completedAt || new Date();
                        preOrderPayment.payment.rawResponse = payment;
                        preOrderPayment.payment.callbackVerification = {
                            verified: true,
                            status: 'success',
                            verifiedAt: new Date(),
                            razorpayPaymentId: paymentId,
                            razorpayOrderId: razorpayOrderId,
                            signatureValid: true,
                            paymentStatus: payment.status,
                            // Schema enum allows 'json' | 'redirect'
                            responseType: 'redirect'
                        };
                        preOrderPayment.updatedAt = new Date();

                        await preOrderPayment.save();

                        // Send pre-order confirmation email if not sent already
                        try {
                            const preOrder = await PreOrder.findById(preOrderPayment.preOrder);
                            if (preOrder && !preOrder.emailSent?.confirmationSent) {
                                const { sendPreOrderConfirmationEmail } = require('../utils/emailService');
                                const emailDetails = {
                                    orderId: preOrder._id.toString(),
                                    amount: preOrderPayment.amount || 0,
                                    couponCode: preOrder.coupon?.code || null,
                                    discountAmount: preOrder.coupon?.discountAmount || null
                                };
                                const emailResult = await sendPreOrderConfirmationEmail(preOrder.email, preOrder.name, emailDetails);
                                if (emailResult.success) {
                                    preOrder.emailSent = {
                                        confirmationSent: true,
                                        confirmationSentAt: new Date()
                                    };
                                    await preOrder.save();
                                    console.log('✅ Pre-order confirmation email sent to:', preOrder.email);
                                } else {
                                    console.warn('⚠️  Failed to send pre-order confirmation email:', emailResult.error);
                                }
                            } else if (preOrder?.emailSent?.confirmationSent) {
                                console.log('ℹ️  Pre-order confirmation email already sent for:', preOrder?._id);
                            }
                        } catch (emailErr) {
                            console.warn('⚠️  Pre-order confirmation email send failed (webhook payment.captured):', emailErr?.message || emailErr);
                        }
                        console.log('✅ PreOrderPayment updated successfully via payment.captured webhook');
                        console.log("✅ PreOrderPayment Status:", preOrderPayment.status);
                    }
                    break;
                }
                case "payment_link.paid": {
                    console.log("🔗 ========== Processing payment_link.paid Event ==========");
                    const paymentLink = event.payload?.payment_link?.entity;
                    if (!paymentLink) {
                        console.error("❌ Missing payment_link entity in payload");
                        console.error("❌ Payload structure:", JSON.stringify(event.payload, null, 2));
                        break;
                    }

                    console.log("🔗 Payment Link ID:", paymentLink.id);
                    console.log("🔗 Payment Link Status:", paymentLink.status);
                    console.log("🔗 Payment Link Amount:", paymentLink.amount);
                    console.log("🔗 Payment Link Amount Paid:", paymentLink.amount_paid);
                    console.log("🔗 Payment Link Amount Due:", paymentLink.amount_due);
                    
                    // Extract identifiers
                    const paymentLinkId = paymentLink.id;
                    const merchantOrderId = paymentLink.notes?.merchantOrderId || paymentLink.notes?.orderNumber;
                    const paymentId = paymentLink.payments?.[0]?.entity?.id;
                    // Payment links don't have order_id, so pass null for razorpayOrderId
                    const razorpayOrderId = null;

                    console.log("🔑 Extracted Identifiers:", {
                        paymentLinkId,
                        merchantOrderId: merchantOrderId || 'NOT FOUND',
                        paymentId: paymentId || 'NOT FOUND'
                    });

                    // Find order (pass null for razorpayOrderId since payment links don't have it)
                    const { order, preOrderPayment, wogglePreOrder } = await findOrder(razorpayOrderId, paymentLinkId, merchantOrderId, paymentId);

                    if (wogglePreOrder) {
                        const paidPaise = paymentLink.amount_paid ?? paymentLink.amount;
                        await completeWogglePreOrder(wogglePreOrder, {
                            paymentId, razorpayOrderId, paymentLinkId,
                            expectedPaise: Math.round(Number(wogglePreOrder.amount) * 100),
                            receivedPaise: paidPaise,
                            event: 'payment_link.paid'
                        });
                        break;
                    }

                    if (!order && !preOrderPayment) {
                        console.warn("⚠️  Order/PreOrderPayment not found - webhook processed but no record updated");
                        break;
                    }

                    if (order) {
                        if (order.payment.status === 'completed') {
                            console.log("ℹ️  Order payment already completed, skipping update");
                            break;
                        }

                        // Payment links report what was actually collected in amount_paid.
                        const paidPaise = paymentLink.amount_paid ?? paymentLink.amount;
                        if (!amountsMatch(order.totalAmount, paidPaise)) {
                            const expectedPaise = Math.round(Number(order.totalAmount) * 100);
                            console.error('🚨 AMOUNT MISMATCH - refusing to confirm order', {
                                orderNumber: order.orderNumber,
                                expectedPaise,
                                receivedPaise: paidPaise,
                                paymentLinkId
                            });
                            order.payment.amountMismatch = {
                                expectedPaise,
                                receivedPaise: paidPaise,
                                detectedAt: new Date(),
                                event: 'payment_link.paid'
                            };
                            order.payment.paymentLinkId = paymentLinkId;
                            order.updatedAt = new Date();
                            await order.save();
                            break; // Held pending for manual review.
                        }

                        console.log("📝 ========== Updating Order ==========");
                        console.log("📝 Order ID:", order._id);
                        console.log("📝 Current Payment Status:", order.payment.status);
                        console.log("📝 Current Order Status:", order.status);

                        // Update order payment status
                        order.payment.status = 'completed';
                        order.payment.paidAt = new Date();
                        order.payment.paymentLinkId = paymentLinkId;
                        if (paymentId) {
                            order.payment.gatewayTransactionId = paymentId;
                            console.log("📝 Set gatewayTransactionId:", paymentId);
                        }
                        console.log("📝 Updated payment status to: completed");
                        console.log("📝 Set paidAt:", order.payment.paidAt);
                        console.log("📝 Set paymentLinkId:", paymentLinkId);

                        // Update order status if pending
                        if (['pending', 'confirmed'].includes(order.status)) {
                            console.log("📝 Updating order status from", order.status, "to confirmed");
                            if (typeof order.updateStatus === 'function') {
                                order.updateStatus('confirmed');
                                console.log("📝 Used order.updateStatus() method");
                            } else {
                                order.status = 'confirmed';
                                order.statusHistory = order.statusHistory || [];
                                order.statusHistory.push({ 
                                    status: 'confirmed', 
                                    note: 'Auto-confirmed via Razorpay payment link webhook', 
                                    at: new Date() 
                                });
                                order.confirmedAt = order.confirmedAt || new Date();
                                console.log("📝 Updated order status manually");
                            }
                            console.log("📝 New Order Status:", order.status);
                        } else {
                            console.log("ℹ️  Order status is", order.status, "- not updating");
                        }

                        // Stock deduction will be executed after saving the order to database

                        // Clear user's cart
                        console.log("🛒 ========== Clearing User Cart ==========");
                        console.log("🛒 User ID:", order.user);
                        try {
                            const userCart = await Cart.findOne({ user: order.user });
                            if (userCart) {
                                const itemsCount = userCart.items?.length || 0;
                                console.log("🛒 Cart found with", itemsCount, "items");
                                if (typeof userCart.clearCart === 'function') {
                                    userCart.clearCart();
                                    console.log("🛒 Used cart.clearCart() method");
                                } else {
                                    userCart.items = [];
                                    console.log("🛒 Cleared cart items manually");
                                }
                                await userCart.save();
                                console.log('✅ Cart cleared successfully for user:', order.user);
                            } else {
                                console.log('ℹ️  No cart found for user:', order.user);
                            }
                        } catch (e) {
                            console.error('❌ Cart clear after webhook payment failed:', e?.message);
                            console.error('❌ Error stack:', e?.stack);
                        }

                        order.updatedAt = new Date();
                        console.log("💾 Saving order to database...");
                        await order.save();
                        console.log('✅ Order updated successfully via payment_link.paid webhook');
                        try {
                            await deductStockForOrder(order);
                        } catch (stockErr) {
                            console.error('Stock deduction failed after payment confirmation:', stockErr.message);
                        }
                        console.log("✅ Order Number:", order.orderNumber);
                        console.log("✅ Final Payment Status:", order.payment.status);
                        console.log("✅ Final Order Status:", order.status);

                        // Create Shiprocket order when payment is completed
                        await createShiprocketOrderOnPaymentComplete(order);
                        // Best-effort analytics event (do not block webhook processing)
                        queuePurchaseCapiEvent({ req, order });
                    } else if (preOrderPayment) {
                        if (preOrderPayment.status === 'completed') {
                            console.log("ℹ️  PreOrderPayment already completed, skipping update");
                            break;
                        }

                        console.log("📝 ========== Updating PreOrderPayment (payment_link.paid) ==========");
                        console.log("📝 PreOrderPayment ID:", preOrderPayment._id);
                        console.log("📝 Current Payment Status:", preOrderPayment.status);

                        preOrderPayment.status = 'completed';
                        preOrderPayment.payment = preOrderPayment.payment || {};
                        preOrderPayment.payment.paymentLinkId = paymentLinkId;
                        preOrderPayment.payment.gatewayTransactionId = paymentId || preOrderPayment.payment.gatewayTransactionId;
                        preOrderPayment.payment.merchantOrderId = preOrderPayment.payment.merchantOrderId || merchantOrderId || null;
                        preOrderPayment.payment.completedAt = preOrderPayment.payment.completedAt || new Date();
                        preOrderPayment.payment.rawResponse = paymentLink;
                        preOrderPayment.payment.callbackVerification = {
                            verified: true,
                            status: 'success',
                            verifiedAt: new Date(),
                            razorpayPaymentId: paymentId || null,
                            razorpayOrderId: null,
                            signatureValid: true,
                            paymentStatus: paymentLink.status,
                            // Schema enum allows 'json' | 'redirect'
                            responseType: 'redirect'
                        };
                        preOrderPayment.updatedAt = new Date();

                        await preOrderPayment.save();

                        // Send pre-order confirmation email if not sent already
                        try {
                            const preOrder = await PreOrder.findById(preOrderPayment.preOrder);
                            if (preOrder && !preOrder.emailSent?.confirmationSent) {
                                const { sendPreOrderConfirmationEmail } = require('../utils/emailService');
                                const emailDetails = {
                                    orderId: preOrder._id.toString(),
                                    amount: preOrderPayment.amount || 0,
                                    couponCode: preOrder.coupon?.code || null,
                                    discountAmount: preOrder.coupon?.discountAmount || null
                                };
                                const emailResult = await sendPreOrderConfirmationEmail(preOrder.email, preOrder.name, emailDetails);
                                if (emailResult.success) {
                                    preOrder.emailSent = {
                                        confirmationSent: true,
                                        confirmationSentAt: new Date()
                                    };
                                    await preOrder.save();
                                    console.log('✅ Pre-order confirmation email sent to:', preOrder.email);
                                } else {
                                    console.warn('⚠️  Failed to send pre-order confirmation email:', emailResult.error);
                                }
                            } else if (preOrder?.emailSent?.confirmationSent) {
                                console.log('ℹ️  Pre-order confirmation email already sent for:', preOrder?._id);
                            }
                        } catch (emailErr) {
                            console.warn('⚠️  Pre-order confirmation email send failed (webhook payment_link.paid):', emailErr?.message || emailErr);
                        }

                        console.log('✅ PreOrderPayment updated successfully via payment_link.paid webhook');
                        console.log("✅ PreOrderPayment Status:", preOrderPayment.status);
                    }
                    break;
                }
                case "payment.failed":
                case "payment_link.expired": {
                    // Terminal negative outcomes. Without these the record stayed 'pending'
                    // forever, making a failed payment indistinguishable from an abandoned one.
                    const isLinkEvent = event.event === "payment_link.expired";
                    const paymentEntity = event.payload?.payment?.entity;
                    const linkEntity = event.payload?.payment_link?.entity;

                    const paymentId = paymentEntity?.id || null;
                    const razorpayOrderId = paymentEntity?.order_id || null;
                    const paymentLinkId = linkEntity?.id || paymentEntity?.notes?.paymentLinkId || null;
                    const merchantOrderId = paymentEntity?.notes?.merchantOrderId ||
                                           paymentEntity?.notes?.orderNumber ||
                                           linkEntity?.notes?.merchantOrderId ||
                                           linkEntity?.notes?.orderNumber;

                    const reason = isLinkEvent
                        ? 'Payment link expired'
                        : (paymentEntity?.error_description || paymentEntity?.error_reason || 'Payment failed');

                    console.log(`⚠️  Processing ${event.event}:`, { paymentId, razorpayOrderId, paymentLinkId, merchantOrderId, reason });

                    const { order, preOrderPayment, wogglePreOrder } = await findOrder(razorpayOrderId, paymentLinkId, merchantOrderId, paymentId);

                    if (wogglePreOrder) {
                        if (wogglePreOrder.paymentStatus !== 'completed') {
                            wogglePreOrder.paymentStatus = 'failed';
                            wogglePreOrder.payment = wogglePreOrder.payment || {};
                            wogglePreOrder.payment.failedAt = new Date();
                            if (paymentId) wogglePreOrder.payment.gatewayTransactionId = paymentId;
                            await wogglePreOrder.save();
                            console.log('✅ WogglePreOrder marked failed via', event.event, '-', wogglePreOrder._id);
                        }
                        break;
                    }

                    if (!order && !preOrderPayment) {
                        console.warn("⚠️  Order/PreOrderPayment not found for", event.event);
                        break;
                    }

                    if (order) {
                        // Never downgrade a payment that already succeeded (late/duplicate event).
                        if (order.payment.status === 'completed') {
                            console.log("ℹ️  Order already completed, ignoring", event.event);
                            break;
                        }
                        order.payment.status = 'failed';
                        order.payment.failedAt = new Date();
                        order.payment.failureReason = reason;
                        if (paymentId) order.payment.gatewayTransactionId = paymentId;
                        order.updatedAt = new Date();
                        await order.save();
                        console.log('✅ Order marked failed via', event.event, '-', order.orderNumber);
                    } else if (preOrderPayment) {
                        if (preOrderPayment.status === 'completed') {
                            console.log("ℹ️  PreOrderPayment already completed, ignoring", event.event);
                            break;
                        }
                        preOrderPayment.status = 'failed';
                        preOrderPayment.payment = preOrderPayment.payment || {};
                        preOrderPayment.payment.failedAt = new Date();
                        preOrderPayment.payment.failureReason = reason;
                        if (paymentId) preOrderPayment.payment.gatewayTransactionId = paymentId;
                        preOrderPayment.updatedAt = new Date();
                        await preOrderPayment.save();
                        console.log('✅ PreOrderPayment marked failed via', event.event, '-', preOrderPayment._id);
                    }
                    break;
                }
                case "payment.downtime":
                case "payment.downtime.resolved": {
                    // Razorpay sends this when a payment method (e.g. a bank) had downtime. Informational only – not a payment failure.
                    const entity = event.payload?.payment_downtime?.entity || event.payload?.payment?.entity || event.payload;
                    const method = entity?.method || 'unknown';
                    const instrument = entity?.instrument?.bank || entity?.instrument || 'unknown';
                    const status = entity?.status || 'unknown';
                    console.log("ℹ️ Razorpay payment.downtime (informational): method=" + method + ", instrument=" + instrument + ", status=" + status + " – no order update.");
                    break;
                }
                default:
                    console.log("ℹ️ ========== Unhandled Event ==========");
                    console.log("ℹ️ Event Type:", event.event);
                    console.log("ℹ️ Event Payload:", JSON.stringify(event.payload, null, 2));
            }

            console.log("✅ ========== Webhook Processing Complete ==========");
            // Always return 200 OK to acknowledge webhook receipt (even if order not found)
            return res.status(200).json({ success: true, received: true });
        } catch (error) {
            console.error("❌ ========== Webhook Error ==========");
            console.error("❌ Error Message:", error.message);
            console.error("❌ Error Stack:", error.stack);
            console.error("❌ Error Details:", {
                name: error.name,
                code: error.code,
                errno: error.errno
            });

            // A malformed body is not retryable - ack it so Razorpay stops resending.
            if (error instanceof SyntaxError) {
                return res.status(200).json({ success: false, message: 'Malformed webhook payload' });
            }

            // Anything else (failed save, DB blip, downstream call) IS retryable. Returning
            // 200 here previously stranded genuinely-paid orders in 'pending' with no retry.
            return res.status(500).json({ success: false, message: error.message });
        }
    }

   //check razorpay payment status
    // async checkRazorpayPaymentStatus(req, res, next) {
    //     try {
    //         const { orderId, merchantOrderId } = req.query;

    //         if (!orderId && !merchantOrderId) {
    //             return res.status(StatusCodes.BAD_REQUEST).json({
    //                 success: false,
    //                 message: 'orderId (Razorpay order_id) or merchantOrderId is required'
    //             });
    //         }

    //         let order = null;

    //         // Find order by Razorpay order_id or merchantOrderId
    //         if (orderId) {
    //             order = await Order.findOne({ 'payment.transactionId': orderId });
    //         }
            
    //         if (!order && merchantOrderId) {
    //             order = await Order.findOne({ 'payment.merchantOrderId': merchantOrderId });
    //         }

    //         if (!order) {
    //             return res.status(StatusCodes.NOT_FOUND).json({
    //                 success: false,
    //                 message: 'Order not found'
    //             });
    //         }

    //         // Fetch payment status from Razorpay
    //         // Check if it's a payment link (plink_xxx) or order (order_xxx)
    //         const razorpayId = order.payment.transactionId || order.payment.paymentLinkId;
    //         let razorpayStatus = null;
    //         let razorpayData = null;

    //         if (razorpayId) {
    //             // Check if it's a payment link or order
    //             if (razorpayId.startsWith('plink_')) {
    //                 // It's a Payment Link - fetch payment link status
    //                 console.log('Fetching Payment Link status:', razorpayId);
    //                 const paymentLinkResult = await razorpayService.fetchPaymentLink(razorpayId);
                    
    //                 if (paymentLinkResult.success) {
    //                     razorpayData = paymentLinkResult.paymentLink;
    //                     // Map payment link status to payment status
    //                     // Payment Link statuses: 'created', 'paid', 'partially_paid', 'expired'
    //                     if (paymentLinkResult.paymentLink.status === 'paid') {
    //                         razorpayStatus = 'completed';
    //                     } else if (paymentLinkResult.paymentLink.status === 'expired') {
    //                         razorpayStatus = 'failed';
    //                     } else {
    //                         razorpayStatus = 'pending';
    //                     }
    //                 }
    //             } else if (razorpayId.startsWith('order_')) {
    //                 // It's an Order - fetch order status
    //                 console.log('Fetching Order status:', razorpayId);
    //                 const orderResult = await razorpayService.fetchOrder(razorpayId);
                    
    //                 if (orderResult.success) {
    //                     razorpayData = orderResult.order;
    //                     // Map order status to payment status
    //                     // Order statuses: 'created', 'attempted', 'paid'
    //                     if (orderResult.order.status === 'paid') {
    //                         razorpayStatus = 'completed';
    //                     } else {
    //                         razorpayStatus = 'pending';
    //                     }
    //                 }
    //             }
                
    //             // Update local order if status changed
    //             if (razorpayStatus === 'completed' && order.payment.status !== 'completed') {
    //                 order.payment.status = 'completed';
    //                 order.payment.paidAt = new Date();
                    
    //                 // Store payment link/order data if available
    //                 if (razorpayData && razorpayData.id) {
    //                     order.payment.gatewayTransactionId = razorpayData.id;
    //                 }
                    
    //                 if (['pending', 'confirmed'].includes(order.status)) {
    //                     if (typeof order.updateStatus === 'function') {
    //                         order.updateStatus('confirmed');
    //                     } else {
    //                         order.status = 'confirmed';
    //                         order.statusHistory = order.statusHistory || [];
    //                         order.statusHistory.push({ 
    //                             status: 'confirmed', 
    //                             note: 'Confirmed from Razorpay status check', 
    //                             at: new Date() 
    //                         });
    //                         order.confirmedAt = order.confirmedAt || new Date();
    //                     }
    //                 }

    //                 // Clear user's cart on successful payment
    //                 try {
    //                     const userCart = await Cart.findOne({ user: order.user });
    //                     if (userCart) {
    //                         if (typeof userCart.clearCart === 'function') {
    //                             userCart.clearCart();
    //                         } else {
    //                             userCart.items = [];
    //                         }
    //                         await userCart.save();
    //                     }
    //                 } catch (e) {
    //                     console.warn('Cart clear after status check failed:', e?.message);
    //                 }

    //                 await order.save();
    //             } else if (razorpayStatus === 'failed' && order.payment.status === 'pending') {
    //                 order.payment.status = 'failed';
    //                 order.statusHistory = order.statusHistory || [];
    //                 order.statusHistory.push({ 
    //                     status: order.status, 
    //                     note: 'Payment link expired or failed', 
    //                     at: new Date() 
    //                 });
    //                 await order.save();
    //             }
    //         }

    //         return res.status(StatusCodes.OK).json({
    //             success: true,
    //             order: {
    //                 id: order._id,
    //                 orderNumber: order.orderNumber,
    //                 status: order.status,
    //                 payment: {
    //                     status: order.payment.status,
    //                     transactionId: order.payment.transactionId,
    //                     merchantOrderId: order.payment.merchantOrderId,
    //                     paidAt: order.payment.paidAt,
    //                     gateway: order.payment.gateway,
    //                     gatewayTransactionId: order.payment.gatewayTransactionId
    //                 }
    //             },
    //             razorpay: razorpayData ? {
    //                 status: razorpayStatus,
    //                 amount: razorpayData.amount || razorpayData.amountPaid,
    //                 currency: razorpayData.currency,
    //                 updatedAt: razorpayData.updatedAt || razorpayData.createdAt
    //             } : null
    //         });

    //     } catch (error) {
    //         console.error("Error checking Razorpay payment status:", error);
    //         return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    //             success: false,
    //             message: error.message || "Error checking Razorpay payment status"
    //         });
    //     }
    // }

    async createRazorpayPaymentForPreOrder(req, res, next) {
        try {
            const { amount, preOrderId } = req.body;

            console.log("amount in createRazorpayPaymentForPreOrder:", amount);
            console.log("preOrderId in createRazorpayPaymentForPreOrder:", preOrderId);

            if (!preOrderId) {
                return res.status(400).json({
                    success: false,
                    message: "preOrderId is required."
                });
            }

            if (!mongoose.Types.ObjectId.isValid(String(preOrderId))) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid preOrderId."
                });
            }

            const preOrder = await PreOrder.findById(preOrderId);
            if (!preOrder) {
                return res.status(404).json({
                    success: false,
                    message: "Pre-order not found for the given preOrderId."
                });
            }

            // Amount is derived from the PreOrder record (server-priced, coupon applied
            // server-side). Any `amount` in the request body is ignored - this route is
            // public, so trusting it would let anyone pay whatever they liked.
            const amountNum = resolvePreOrderAmount(preOrder);
            if (!Number.isFinite(amountNum) || amountNum <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "This pre-order has no payable amount."
                });
            }
            if (amount !== undefined && Number(amount) !== amountNum) {
                console.warn('[PreOrder] Ignoring client-supplied amount', {
                    preOrderId: preOrder._id.toString(),
                    clientAmount: amount,
                    serverAmount: amountNum
                });
            }

            // Create pre-order payment record
            const merchantOrderId = randomUUID();

            const minimalPaymentData = {
                preOrder: preOrder._id,
                amount: amountNum,
                currency: 'INR',
                status: 'pending',
                payment: {
                    merchantOrderId,
                    gateway: 'razorpay'
                },
                leadSnapshot: {
                    name: preOrder.name,
                    email: preOrder.email,
                    phone: preOrder.phone
                }
            };

            const preOrderPayment = await PreOrderPayment.create(minimalPaymentData);

            // Create Razorpay order (same as createRazorpayPaymentFromCart)
            const razorpayOrder = await razorpayService.createOrder({
                amount: amountNum,
                currency: 'INR',
                merchantOrderId: merchantOrderId,
                receipt: `PRE-${preOrder._id.toString().slice(-6)}`,
                notes: {
                    preOrderId: preOrder._id.toString(),
                    preOrderPaymentId: preOrderPayment._id.toString(),
                    orderNumber: merchantOrderId
                }
            });

            console.log("razorpayOrder in createRazorpayPaymentForPreOrder:", razorpayOrder);

            if (!razorpayOrder.success) {
                preOrderPayment.status = 'failed';
                preOrderPayment.payment.failedAt = new Date();
                preOrderPayment.payment.gatewayResponse = razorpayOrder.error || { error: 'order creation failed' };
                await preOrderPayment.save();

                return res.status(500).json({
                    success: false,
                    message: razorpayOrder.message || "Failed to create Razorpay order."
                });
            }

            // Store order details for later verification (status remains pending; webhook updates it)
            preOrderPayment.payment.transactionId = razorpayOrder.orderId;
            preOrderPayment.payment.keyId = razorpayService.getKeyId();
            preOrderPayment.payment.currency = 'INR';
            preOrderPayment.payment.amount = amountNum;
            await preOrderPayment.save();

            console.log('✅ Razorpay order created for pre-order:', {
                preOrderPaymentId: preOrderPayment._id,
                preOrderId: preOrder._id,
                razorpayOrderId: razorpayOrder.orderId,
                merchantOrderId: merchantOrderId
            });

            // Build verify URL for frontend to redirect after payment (same as cart controller)
            // Note: razorpay_payment_id and razorpay_signature will be added by Razorpay after payment
            const verifyUrl = razorpayService.buildCallbackUrl({
                preOrderId: preOrder._id.toString(),
                preOrderPaymentId: preOrderPayment._id.toString(),
                merchantOrderId,
                razorpay_order_id: razorpayOrder.orderId // Razorpay expects this parameter name
            });

            console.log("verifyUrl for pre-order:", verifyUrl);

            // Return response similar to createRazorpayPaymentFromCart
            return res.status(200).json({
                success: true,
                keyId: razorpayService.getKeyId(),
                razorpayOrderId: razorpayOrder.orderId,
                merchantOrderId,
                amountInPaise: razorpayOrder.amount,
                amount: amountNum,
                currency: 'INR',
                verifyUrl, // Frontend should redirect here after payment with query params
                preOrderPayment: {
                    id: preOrderPayment._id,
                    preOrderId: preOrder._id,
                    amount: amountNum
                }
            });

        } catch (error) {
            console.error("createRazorpayPaymentForPreOrder error:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Error creating Razorpay payment for pre-order"
            });
        }
    }

    async phonePeWebhookHandler(req, res) {
        try {
            const receivedSignature = req.headers['x-verify'];
            const signingKey = phonepeConfig.CLIENT_SECRET;

            // Fail safe: signing key must be configured in non-development environments
            if (!signingKey) {
                if (process.env.NODE_ENV !== 'development') {
                    console.error('[PhonePe Webhook] CLIENT_SECRET not configured — rejecting request');
                    return res.status(400).json({ success: false, message: 'Webhook signing key not configured on server' });
                }
                console.warn('[PhonePe Webhook] CLIENT_SECRET not set — sandbox mode, skipping signature check');
            }

            // x-verify is mandatory outside of development
            if (!receivedSignature) {
                if (process.env.NODE_ENV !== 'development') {
                    return res.status(400).json({ success: false, message: 'x-verify signature header is required' });
                }
                console.warn('[PhonePe Webhook] x-verify absent — sandbox mode, proceeding without signature check');
            }

            // Normalize payload (handle multiple possible field names from PhonePe)
            const payload = req.body || {};
            const merchantOrderId = payload.merchantOrderId || payload.merchantTransactionId || payload.orderId;
            const transactionId   = payload.transactionId  || payload.providerReferenceId   || payload.pgTransactionId;
            const rawStatus       = payload.status         || payload.state                  || payload.code || payload.responseCode;

            if (!merchantOrderId) {
                console.error('[PhonePe Webhook] Missing merchantOrderId in payload');
                return res.status(400).json({ success: false, message: 'merchantOrderId is required' });
            }

            // Timing-safe signature verification when both values are available
            if (receivedSignature && signingKey) {
                const expected = crypto
                    .createHash('sha256')
                    .update(`${merchantOrderId}${signingKey}`)
                    .digest('hex');

                const expBuf = Buffer.from(expected);
                const recBuf = Buffer.from(receivedSignature);
                const signaturesMatch = expBuf.length === recBuf.length
                    && crypto.timingSafeEqual(expBuf, recBuf);

                if (!signaturesMatch) {
                    console.warn(`[PhonePe Webhook] Invalid signature for order ${merchantOrderId}`);
                    return res.status(401).json({ success: false, message: 'Invalid signature' });
                }
            }

            const order = await Order.findOne({ 'payment.transactionId': merchantOrderId });
            if (!order) {
                console.error('[PhonePe Webhook] Order not found for merchantOrderId:', merchantOrderId);
                // Return 200 so PhonePe does not endlessly retry for genuinely unknown orders
                return res.status(200).json({ success: false, message: 'Order not found' });
            }

            // Idempotency guard
            if (order.payment && order.payment.status === 'completed') {
                return res.status(200).json({ success: true, message: 'Already processed' });
            }

            const status = String(rawStatus || '').toUpperCase();

            // Find matching payment attempt, fall back to the latest one
            let paymentAttempt = null;
            if (order.paymentAttempts && order.paymentAttempts.length > 0) {
                paymentAttempt = order.paymentAttempts.find(
                    a => a.transactionId === merchantOrderId
                ) || order.paymentAttempts[order.paymentAttempts.length - 1];
            }

            if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'PAYMENT_SUCCESS') {
                order.payment.status    = 'completed';
                order.payment.gateway   = 'PhonePe';
                order.payment.transactionId = merchantOrderId;
                order.payment.paidAt    = new Date();

                if (paymentAttempt) {
                    paymentAttempt.status = 'completed';
                    paymentAttempt.transactionId = transactionId || merchantOrderId;
                }

                if (typeof order.updateStatus === 'function') {
                    order.updateStatus('confirmed');
                } else {
                    order.status = 'confirmed';
                }

                try {
                    const userCart = await Cart.findOne({ user: order.user });
                    if (userCart) {
                        userCart.clearCart();
                        await userCart.save();
                    }
                } catch (cartError) {
                    console.warn('[PhonePe Webhook] Cart clear failed:', cartError?.message);
                }

                await order.save();
                try {
                    await deductStockForOrder(order);
                } catch (stockErr) {
                    console.error('[PhonePe Webhook] Stock deduction failed:', stockErr.message);
                }
                console.log(`[PhonePe Webhook] Payment SUCCESS for order ${order.orderNumber}`);
                queuePurchaseCapiEvent({ req, order });
                return res.status(200).json({ success: true, message: 'Payment completed' });

            } else if (status === 'FAILED' || status === 'FAILURE' || status === 'PAYMENT_FAILED' || status === 'PAYMENT_ERROR') {
                order.payment.status    = 'failed';
                order.payment.gateway   = 'PhonePe';
                order.payment.transactionId = merchantOrderId;

                if (paymentAttempt) {
                    paymentAttempt.status       = 'failed';
                    paymentAttempt.errorCode    = payload.errorCode || payload.code || 'PAYMENT_FAILED';
                    paymentAttempt.errorMessage = payload.message   || payload.errorMessage || 'Payment failed';
                    if (transactionId) paymentAttempt.transactionId = transactionId;
                }

                await order.save();
                console.log(`[PhonePe Webhook] Payment FAILED for order ${order.orderNumber}`);
                return res.status(200).json({ success: true, message: 'Payment failed recorded' });

            } else {
                console.warn(`[PhonePe Webhook] Unrecognized status "${rawStatus}" for order ${order.orderNumber}`);
                return res.status(200).json({ success: true, message: 'Unknown status acknowledged' });
            }

        } catch (error) {
            console.error('[PhonePe Webhook] Unexpected error:', error.message);
            // Always 200 — prevents PhonePe from retrying our internal errors
            return res.status(200).json({ success: false, message: 'Webhook processing error' });
        }
    }

    // =========================================================================
    // PAYTM PAYMENT METHODS
    // =========================================================================

    /**
     * POST /api/v1/payments/paytm/create-from-cart
     * Creates an order from the user's cart and initiates a Paytm hosted checkout.
     * Mirrors createRazorpayPaymentFromCart in structure and security.
     */
    async createPaytmPaymentFromCart(req, res, next) {
        try {
            const paytmService = require('../config/paytmService');
            const userId = req.user?.id;
            if (!userId) {
                return res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: 'Authentication required' });
            }

            if (!paytmService.isConfigured()) {
                return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
                    success: false,
                    message: 'Paytm payment gateway is not configured on this server.'
                });
            }

            console.log('[Paytm] createPaytmPaymentFromCart userId:', userId);
            const { shippingAddressId, billingAddressId } = req.body;

            const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

            // --- Check for recent pending Paytm orders (idempotency) ---
            const recentPendingOrder = await Order.findOne({
                user: userId,
                status: 'pending',
                'payment.status': 'pending',
                'payment.gateway': 'paytm',
                createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
            });
            if (recentPendingOrder) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: 'A Paytm order is already pending. Please complete or cancel it before starting a new one.',
                    orderId: recentPendingOrder._id,
                    merchantOrderId: recentPendingOrder.orderNumber
                });
            }

            // --- Fetch cart, user, and addresses ---
            const [cart, user, shippingAddress, billingAddress] = await Promise.all([
                Cart.findOne({ user: userId })
                    .populate({ path: 'items.product', select: 'name sku pricing inventory partner' })
                    .populate({ path: 'items.variant', select: 'name attributes price stock commission' })
                    .populate({ path: 'items.service', select: 'name slug shortDescription serviceType category pricing images isActive isVerified partner' }),
                User.findById(userId).select('phoneNumber email name'),
                shippingAddressId ? Address.findOne({ _id: shippingAddressId, user: userId, isDeleted: false }) : null,
                billingAddressId ? Address.findOne({ _id: billingAddressId, user: userId, isDeleted: false }) : null
            ]);

            if (!cart || cart.items.length === 0) {
                throw new ErrorResponse('Cart is empty', StatusCodes.BAD_REQUEST);
            }

            // --- Resolve shipping and billing addresses ---
            let finalShippingAddressId, finalBillingAddressId;
            if (shippingAddressId) {
                if (!isValidObjectId(shippingAddressId)) throw new ErrorResponse('Invalid shippingAddressId', StatusCodes.BAD_REQUEST);
                if (!shippingAddress) throw new ErrorResponse('Shipping address not found or does not belong to user', StatusCodes.NOT_FOUND);
                finalShippingAddressId = shippingAddressId;
            } else {
                const defaultAddress = await Address.findOne({ user: userId, isDefaultShipping: true, isDeleted: false });
                if (!defaultAddress) throw new ErrorResponse('No shipping address found. Please add a shipping address first.', StatusCodes.BAD_REQUEST);
                finalShippingAddressId = defaultAddress._id;
            }
            finalBillingAddressId = billingAddressId && isValidObjectId(billingAddressId) && billingAddress
                ? billingAddressId
                : finalShippingAddressId;

            // --- Calculate cart totals ---
            cart.calculateTotals();
            await cart.save();

            // --- Build order items (skip null products/services) ---
            const validCartItems = cart.items.filter(item => {
                const itype = item.itemType || (item.service ? 'service' : 'product');
                return itype === 'service' ? !!item.service : !!item.product;
            });
            if (validCartItems.length === 0) {
                throw new ErrorResponse('Cart contains no valid items.', StatusCodes.BAD_REQUEST);
            }

            const orderItems = validCartItems.map(item => {
                const itype = item.itemType || (item.service ? 'service' : 'product');
                if (itype === 'service') {
                    const svc = item.service;
                    const price = Number(item.price ?? svc.pricing?.listPrice ?? svc.pricing?.mrp ?? 0);
                    const qty = Number(item.quantity ?? 1);
                    const disc = Number(item.discount ?? 0);
                    const extrasTotal = (item.selectedExtras || []).reduce((s, e) => s + (Number(e.price) || 0), 0);
                    const totalPrice = Math.max(0, ((price + extrasTotal) * qty) - (disc * qty));
                    const partnerId = (svc.partner && typeof svc.partner === 'object' && svc.partner.partnerId) ? svc.partner.partnerId : null;
                    return { itemType: 'service', service: svc._id, name: svc.name || 'Service', quantity: qty, price, originalPrice: Number(item.originalPrice ?? price), discount: disc, totalPrice, selectedExtras: item.selectedExtras || [], selectedDate: item.selectedDate || null, serviceNotes: item.notes || null, commission: { percentage: 0, amount: 0 }, partner: partnerId };
                }
                const commPct = Number((item.variant?.commission?.percentage) ?? (item.product?.pricing?.commission?.percentage) ?? 0);
                const price = Number(item.price ?? item.variant?.price?.listPrice ?? item.variant?.price?.price ?? item.product?.pricing?.basePrice ?? 0);
                const qty = Number(item.quantity ?? 1);
                const disc = Number(item.discount ?? 0);
                const commAmt = Math.max(0, Number.isFinite(price) && Number.isFinite(commPct) ? (price * commPct) / 100 : 0);
                const totalPrice = Math.max(0, (price - disc) * qty);
                return { itemType: 'product', product: item.product._id, variant: item.variant?._id || null, quantity: qty, price, originalPrice: Number(item.originalPrice ?? price), discount: disc, totalPrice, commission: { percentage: commPct, amount: commAmt }, partner: item.product.partner || null };
            });

            // --- Address snapshots ---
            const [shippingAddrDoc, billingAddrDoc] = await Promise.all([
                Address.findById(finalShippingAddressId),
                Address.findById(finalBillingAddressId)
            ]);
            if (!shippingAddrDoc) throw new ErrorResponse('Shipping address not found', StatusCodes.NOT_FOUND);
            if (!billingAddrDoc) throw new ErrorResponse('Billing address not found', StatusCodes.NOT_FOUND);

            const buyerFullName = user?.name;
            const buyerPhone = user?.phoneNumber;
            const shippingSnapshot = { fullName: buyerFullName, phone: buyerPhone, line1: shippingAddrDoc.shippingAddress?.street || '', city: shippingAddrDoc.shippingAddress?.city || '', state: shippingAddrDoc.shippingAddress?.state || '', postalCode: shippingAddrDoc.shippingAddress?.postalCode || '', country: shippingAddrDoc.shippingAddress?.country || 'IN' };
            const billingSnapshot = { fullName: buyerFullName, phone: buyerPhone, line1: billingAddrDoc.billingAddress?.street || '', city: billingAddrDoc.billingAddress?.city || '', state: billingAddrDoc.billingAddress?.state || '', postalCode: billingAddrDoc.billingAddress?.postalCode || '', country: billingAddrDoc.billingAddress?.country || 'IN' };

            // --- Create order ---
            const order = await Order.create({
                user: userId,
                items: orderItems,
                subtotal: cart.subtotal,
                totalDiscount: cart.totalDiscount,
                shippingCost: cart.shippingCost,
                taxAmount: cart.taxAmount,
                totalAmount: cart.totalAmount,
                appliedCoupon: cart.appliedCoupon,
                shippingAddress: finalShippingAddressId,
                billingAddress: finalBillingAddressId,
                contact: { email: user?.email, phone: user?.phoneNumber },
                shippingAddressSnapshot: shippingSnapshot,
                billingAddressSnapshot: billingSnapshot,
                payment: { method: 'online', status: 'pending', gateway: 'paytm' },
                shipping: { method: 'Standard Delivery', estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
            });
            order.calculatePartnerPayments();
            await order.save();

            // --- Use orderNumber as Paytm orderId (alphanumeric, ≤50 chars) ---
            const paytmOrderId = order.orderNumber;

            // Build callback URL (Paytm will POST here after payment)
            const callbackUrl = paytmService.buildCallbackUrl({ orderId: paytmOrderId, internalOrderId: order._id.toString() });

            // --- Initiate Paytm transaction ---
            const txnResult = await paytmService.initiateTransaction({
                amount: order.totalAmount,
                orderId: paytmOrderId,
                customerId: userId,
                email: user?.email,
                phone: user?.phoneNumber,
                callbackUrl
            });

            if (!txnResult.success) {
                // Mark order as failed (best-effort). The gateway's own wording is
                // logged, not returned — the customer gets a generic message plus a
                // reference they can quote to support.
                order.payment.status = 'failed';
                await order.save().catch(() => {});
                logGatewayFailure('Paytm', {
                    flow: 'cart-checkout',
                    orderNumber: paytmOrderId,
                    orderId: order._id.toString(),
                    gatewayMessage: txnResult.message,
                    gatewayError: txnResult.error
                });
                return res.status(StatusCodes.BAD_GATEWAY).json({
                    success: false,
                    message: PAYMENT_INIT_FAILED_MESSAGE,
                    reference: paytmOrderId
                });
            }

            // Persist the Paytm txnToken and orderId on the order
            order.payment.transactionId = paytmOrderId;
            order.payment.merchantOrderId = paytmOrderId;
            order.payment.amount = order.totalAmount;
            order.payment.currency = 'INR';
            await order.save();

            // Best-effort analytics event
            queueInitiateCheckoutCapiEvent({ req, order });

            console.log('[Paytm] ✅ Transaction initiated:', { orderId: order._id, orderNumber: paytmOrderId, txnToken: txnResult.txnToken });

            return res.status(StatusCodes.OK).json({
                success: true,
                txnToken: txnResult.txnToken,
                checkoutUrl: txnResult.checkoutUrl,
                mid: paytmService.getMid(),
                paytmOrderId,
                orderId: order._id,
                orderNumber: order.orderNumber,
                amount: order.totalAmount,
                currency: 'INR',
                orderSummary: {
                    subtotal: order.subtotal,
                    totalDiscount: order.totalDiscount,
                    shippingCost: order.shippingCost,
                    taxAmount: order.taxAmount,
                    totalAmount: order.totalAmount
                }
            });

        } catch (error) {
            console.error('[Paytm] createPaytmPaymentFromCart error:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: PAYMENT_INIT_FAILED_MESSAGE
            });
        }
    }

    /**
     * POST /api/v1/payments/paytm/create-for-pre-order
     * Initiates a Paytm transaction for a pre-order form submission.
     * No auth required (public pre-order flow).
     */
    async createPaytmPaymentForPreOrder(req, res, next) {
        try {
            const paytmService = require('../config/paytmService');
            const { amount, preOrderId } = req.body;

            if (!paytmService.isConfigured()) {
                return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
                    success: false,
                    message: 'Paytm payment gateway is not configured on this server.'
                });
            }

            if (!preOrderId) {
                return res.status(400).json({ success: false, message: 'preOrderId is required.' });
            }
            if (!mongoose.Types.ObjectId.isValid(String(preOrderId))) {
                return res.status(400).json({ success: false, message: 'Invalid preOrderId.' });
            }

            const preOrder = await PreOrder.findById(preOrderId);
            if (!preOrder) {
                return res.status(404).json({ success: false, message: 'Pre-order not found.' });
            }

            // Server-derived amount - see createRazorpayPaymentForPreOrder. Public route.
            const amountNum = resolvePreOrderAmount(preOrder);
            if (!Number.isFinite(amountNum) || amountNum <= 0) {
                return res.status(400).json({ success: false, message: 'This pre-order has no payable amount.' });
            }
            if (amount !== undefined && Number(amount) !== amountNum) {
                console.warn('[Paytm PreOrder] Ignoring client-supplied amount', {
                    preOrderId: preOrder._id.toString(),
                    clientAmount: amount,
                    serverAmount: amountNum
                });
            }

            // Unique orderId for Paytm (≤50 chars alphanumeric)
            const paytmOrderId = `PRE${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;

            // Create PreOrderPayment record
            const preOrderPayment = await PreOrderPayment.create({
                preOrder: preOrder._id,
                amount: amountNum,
                currency: 'INR',
                status: 'pending',
                payment: { merchantOrderId: paytmOrderId, gateway: 'paytm' },
                leadSnapshot: { name: preOrder.name, email: preOrder.email, phone: preOrder.phone }
            });

            const callbackUrl = paytmService.buildCallbackUrl({
                orderId: paytmOrderId,
                preOrderPaymentId: preOrderPayment._id.toString()
            });

            const txnResult = await paytmService.initiateTransaction({
                amount: amountNum,
                orderId: paytmOrderId,
                customerId: preOrder.phone || preOrder.email || preOrder._id.toString(),
                email: preOrder.email,
                phone: preOrder.phone,
                callbackUrl
            });

            if (!txnResult.success) {
                preOrderPayment.status = 'failed';
                await preOrderPayment.save().catch(() => {});
                logGatewayFailure('Paytm', {
                    flow: 'pre-order',
                    orderNumber: paytmOrderId,
                    preOrderPaymentId: preOrderPayment._id.toString(),
                    gatewayMessage: txnResult.message,
                    gatewayError: txnResult.error
                });
                return res.status(StatusCodes.BAD_GATEWAY).json({
                    success: false,
                    message: PAYMENT_INIT_FAILED_MESSAGE,
                    reference: paytmOrderId
                });
            }

            preOrderPayment.payment.checkoutUrl = txnResult.checkoutUrl;
            await preOrderPayment.save();

            return res.status(200).json({
                success: true,
                txnToken: txnResult.txnToken,
                checkoutUrl: txnResult.checkoutUrl,
                mid: paytmService.getMid(),
                paytmOrderId,
                preOrderPaymentId: preOrderPayment._id,
                preOrderId: preOrder._id,
                amount: amountNum
            });

        } catch (error) {
            console.error('[Paytm] createPaytmPaymentForPreOrder error:', error);
            return res.status(500).json({ success: false, message: PAYMENT_INIT_FAILED_MESSAGE });
        }
    }

    /**
     * GET /api/v1/payments/paytm/status?orderId=<paytmOrderId>
     * Queries Paytm Order Status API and syncs the order in our DB.
     */
    async checkPaytmPaymentStatus(req, res, next) {
        try {
            const paytmService = require('../config/paytmService');
            const { orderId } = req.query;

            if (!orderId) {
                return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'orderId is required' });
            }

            // --- Fetch status from Paytm ---
            const statusResult = await paytmService.fetchOrderStatus(orderId);
            if (!statusResult.success) {
                return res.status(StatusCodes.BAD_GATEWAY).json({
                    success: false,
                    message: statusResult.message || 'Failed to fetch order status from Paytm',
                    error: statusResult.error
                });
            }

            const paymentStatus = paytmService.mapTxnStatusToPaymentStatus(statusResult.txnStatus);

            // --- Find and update our Order ---
            let order = await Order.findOne({ 'payment.merchantOrderId': orderId })
                || await Order.findOne({ 'payment.transactionId': orderId })
                || await Order.findOne({ orderNumber: orderId });

            if (order) {
                // BOLA: check ownership
                if (req.user && order.user.toString() !== req.user.id.toString() && req.user.role !== 'admin') {
                    return res.status(StatusCodes.FORBIDDEN).json({ success: false, message: 'Forbidden: You do not own this order.' });
                }

                if (order.payment.status !== paymentStatus) {
                    order.payment.status = paymentStatus;
                    if (paymentStatus === 'completed') {
                        order.payment.paidAt = order.payment.paidAt || new Date();
                        if (statusResult.txnId) order.payment.gatewayTransactionId = statusResult.txnId;
                        if (statusResult.amount) order.payment.amount = statusResult.amount;
                        order.payment.gateway = 'paytm';

                        if (['pending', 'confirmed'].includes(order.status)) {
                            if (typeof order.updateStatus === 'function') {
                                order.updateStatus('confirmed');
                            } else {
                                order.status = 'confirmed';
                                order.statusHistory = order.statusHistory || [];
                                order.statusHistory.push({ status: 'confirmed', note: 'Auto-confirmed via Paytm status check', at: new Date() });
                                order.confirmedAt = order.confirmedAt || new Date();
                            }
                        }
                        order.updatedAt = new Date();
                        await order.save();
                        try { await deductStockForOrder(order); } catch (e) { console.error('[Paytm checkStatus] Stock deduction failed:', e.message); }
                        await createShiprocketOrderOnPaymentComplete(order);
                        queuePurchaseCapiEvent({ req, order });
                    } else {
                        order.updatedAt = new Date();
                        await order.save();
                    }
                }
            } else {
                console.warn('[Paytm] checkPaytmPaymentStatus: No order found for orderId:', orderId);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                paytmOrderId: orderId,
                txnStatus: statusResult.txnStatus,
                paymentStatus,
                txnId: statusResult.txnId,
                amount: statusResult.amount,
                local: order ? {
                    id: order._id,
                    orderNumber: order.orderNumber,
                    payment: { status: order.payment.status, paidAt: order.payment.paidAt, gateway: order.payment.gateway },
                    status: order.status
                } : null,
                raw: statusResult.raw
            });

        } catch (error) {
            console.error('[Paytm] checkPaytmPaymentStatus error:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message || 'Error checking Paytm payment status' });
        }
    }

    /**
     * POST /api/v1/payments/paytm/callback
     * Paytm redirects the user to this URL after payment (success or failure).
     * Paytm POSTs URL-encoded params including CHECKSUMHASH.
     * Verifies the checksum, updates the order, and redirects to the frontend.
     */
    async paytmCallback(req, res, next) {
        try {
            const paytmService = require('../config/paytmService');
            console.log('[Paytm] ========== Callback Received ==========');

            // Paytm sends application/x-www-form-urlencoded
            const params = { ...req.body, ...req.query };
            const { CHECKSUMHASH, ORDERID: paytmOrderId, STATUS: txnStatus, TXNID, TXNAMOUNT } = params;

            console.log('[Paytm] Callback params (redacted):', { paytmOrderId, txnStatus, TXNID, TXNAMOUNT });

            if (!CHECKSUMHASH || !paytmOrderId) {
                console.error('[Paytm] Callback missing CHECKSUMHASH or ORDERID');
                return res.redirect(paytmService.buildFailureUrl({ reason: 'invalid_callback', orderId: paytmOrderId }));
            }

            // --- Verify checksum ---
            const paramsWithoutChecksum = { ...params };
            delete paramsWithoutChecksum.CHECKSUMHASH;

            const { isValid } = await paytmService.verifyCallbackChecksum(paramsWithoutChecksum, CHECKSUMHASH);
            if (!isValid) {
                console.error('[Paytm] Callback checksum INVALID for orderId:', paytmOrderId);
                return res.redirect(paytmService.buildFailureUrl({ reason: 'invalid_checksum', orderId: paytmOrderId }));
            }

            console.log('[Paytm] ✅ Callback checksum valid for orderId:', paytmOrderId);

            // --- Cross-verify with Paytm Order Status API (source of truth) ---
            const statusResult = await paytmService.fetchOrderStatus(paytmOrderId);
            const paymentStatus = paytmService.mapTxnStatusToPaymentStatus(statusResult.txnStatus || txnStatus);

            // --- Find order or pre-order payment ---
            let order = await Order.findOne({ 'payment.merchantOrderId': paytmOrderId })
                || await Order.findOne({ 'payment.transactionId': paytmOrderId })
                || await Order.findOne({ orderNumber: paytmOrderId });

            let preOrderPayment = null;
            if (!order) {
                preOrderPayment = await PreOrderPayment.findOne({ 'payment.merchantOrderId': paytmOrderId });
            }

            if (order) {
                if (order.payment.status !== 'completed') {
                    order.payment.status = paymentStatus;
                    order.payment.gateway = 'paytm';
                    if (statusResult.txnId || TXNID) order.payment.gatewayTransactionId = statusResult.txnId || TXNID;
                    if (statusResult.amount || TXNAMOUNT) order.payment.amount = statusResult.amount || Number(TXNAMOUNT);
                    order.payment.rawResponse = { ...params, statusApi: statusResult.raw };

                    if (paymentStatus === 'completed') {
                        order.payment.paidAt = order.payment.paidAt || new Date();
                        if (['pending', 'confirmed'].includes(order.status)) {
                            if (typeof order.updateStatus === 'function') {
                                order.updateStatus('confirmed');
                            } else {
                                order.status = 'confirmed';
                                order.statusHistory = order.statusHistory || [];
                                order.statusHistory.push({ status: 'confirmed', note: 'Confirmed via Paytm callback', at: new Date() });
                                order.confirmedAt = order.confirmedAt || new Date();
                            }
                        }
                        // Clear cart
                        try {
                            const userCart = await Cart.findOne({ user: order.user });
                            if (userCart) {
                                typeof userCart.clearCart === 'function' ? userCart.clearCart() : (userCart.items = []);
                                await userCart.save();
                            }
                        } catch (e) { console.warn('[Paytm] Cart clear failed:', e.message); }
                    }

                    order.updatedAt = new Date();
                    await order.save();

                    if (paymentStatus === 'completed') {
                        try { await deductStockForOrder(order); } catch (e) { console.error('[Paytm Callback] Stock deduction failed:', e.message); }
                        await createShiprocketOrderOnPaymentComplete(order);
                        queuePurchaseCapiEvent({ req, order });
                    }
                }

                const redirectUrl = paymentStatus === 'completed'
                    ? paytmService.buildSuccessUrl({ orderId: order._id.toString(), orderNumber: order.orderNumber, paytmOrderId, gateway: 'paytm' })
                    : paytmService.buildFailureUrl({ orderId: order._id.toString(), orderNumber: order.orderNumber, paytmOrderId, reason: 'payment_failed' });

                return res.redirect(redirectUrl);

            } else if (preOrderPayment) {
                if (preOrderPayment.status !== 'completed') {
                    preOrderPayment.status = paymentStatus;
                    preOrderPayment.payment = preOrderPayment.payment || {};
                    if (statusResult.txnId || TXNID) preOrderPayment.payment.gatewayTransactionId = statusResult.txnId || TXNID;
                    if (paymentStatus === 'completed') preOrderPayment.payment.completedAt = new Date();
                    preOrderPayment.payment.rawResponse = params;
                    preOrderPayment.updatedAt = new Date();
                    await preOrderPayment.save();
                }

                const redirectUrl = paymentStatus === 'completed'
                    ? paytmService.buildSuccessUrl({ preOrderPaymentId: preOrderPayment._id.toString(), paytmOrderId })
                    : paytmService.buildFailureUrl({ preOrderPaymentId: preOrderPayment._id.toString(), paytmOrderId, reason: 'payment_failed' });

                return res.redirect(redirectUrl);

            } else {
                console.warn('[Paytm] Callback: No order or preOrderPayment found for orderId:', paytmOrderId);
                return res.redirect(paytmService.buildFailureUrl({ reason: 'order_not_found', orderId: paytmOrderId }));
            }

        } catch (error) {
            console.error('[Paytm] paytmCallback error:', error);
            // Do not expose server errors — redirect to failure
            const paytmService = require('../config/paytmService');
            return res.redirect(paytmService.buildFailureUrl({ reason: 'server_error' }));
        }
    }

    /**
     * POST /api/v1/payments/paytm/webhook
     * Server-to-server notification from Paytm.
     * Raw body is preserved for checksum verification (configured in middleware/webhook.js).
     * Always responds 200 to prevent Paytm from retrying.
     */
    async paytmWebhook(req, res, next) {
        try {
            const paytmService = require('../config/paytmService');
            console.log('[Paytm] ========== Webhook Received ==========');

            // Parse body: could be Buffer (raw) or already-parsed object
            let params = {};
            if (Buffer.isBuffer(req.body)) {
                try {
                    // Paytm may send JSON or URL-encoded — try JSON first
                    params = JSON.parse(req.body.toString());
                } catch {
                    // Fallback: URL-encoded
                    const qs = new URLSearchParams(req.body.toString());
                    qs.forEach((v, k) => { params[k] = v; });
                }
            } else if (typeof req.body === 'object') {
                params = req.body;
            }

            const { CHECKSUMHASH, ORDERID: paytmOrderId, STATUS: txnStatus, TXNID } = params;

            if (!CHECKSUMHASH || !paytmOrderId) {
                console.error('[Paytm] Webhook missing CHECKSUMHASH or ORDERID');
                return res.status(200).json({ success: false, message: 'Missing required fields' });
            }

            // --- Verify checksum ---
            const paramsWithoutChecksum = { ...params };
            delete paramsWithoutChecksum.CHECKSUMHASH;

            const { isValid } = await paytmService.verifyCallbackChecksum(paramsWithoutChecksum, CHECKSUMHASH);
            if (!isValid) {
                console.error('[Paytm] Webhook checksum INVALID for orderId:', paytmOrderId);
                return res.status(200).json({ success: false, message: 'Invalid checksum' });
            }

            console.log('[Paytm] ✅ Webhook checksum valid, orderId:', paytmOrderId, 'status:', txnStatus);

            // --- Cross-verify with Paytm status API ---
            const statusResult = await paytmService.fetchOrderStatus(paytmOrderId);
            const paymentStatus = paytmService.mapTxnStatusToPaymentStatus(statusResult.txnStatus || txnStatus);

            // --- Find and update order or pre-order payment ---
            let order = await Order.findOne({ 'payment.merchantOrderId': paytmOrderId })
                || await Order.findOne({ 'payment.transactionId': paytmOrderId })
                || await Order.findOne({ orderNumber: paytmOrderId });

            let preOrderPayment = null;
            if (!order) {
                preOrderPayment = await PreOrderPayment.findOne({ 'payment.merchantOrderId': paytmOrderId });
            }

            if (order) {
                if (order.payment.status === 'completed') {
                    console.log('[Paytm] Webhook: Order already completed, skipping:', order._id);
                    return res.status(200).json({ success: true, message: 'Already processed' });
                }

                order.payment.status = paymentStatus;
                order.payment.gateway = 'paytm';
                order.payment.rawResponse = { webhookParams: params, statusApi: statusResult.raw };
                if (statusResult.txnId || TXNID) order.payment.gatewayTransactionId = statusResult.txnId || TXNID;

                if (paymentStatus === 'completed') {
                    order.payment.paidAt = order.payment.paidAt || new Date();
                    if (['pending', 'confirmed'].includes(order.status)) {
                        if (typeof order.updateStatus === 'function') {
                            order.updateStatus('confirmed');
                        } else {
                            order.status = 'confirmed';
                            order.statusHistory = order.statusHistory || [];
                            order.statusHistory.push({ status: 'confirmed', note: 'Auto-confirmed via Paytm webhook', at: new Date() });
                            order.confirmedAt = order.confirmedAt || new Date();
                        }
                    }
                    // Clear cart
                    try {
                        const userCart = await Cart.findOne({ user: order.user });
                        if (userCart) {
                            typeof userCart.clearCart === 'function' ? userCart.clearCart() : (userCart.items = []);
                            await userCart.save();
                        }
                    } catch (e) { console.warn('[Paytm] Webhook cart clear failed:', e.message); }
                }

                order.updatedAt = new Date();
                await order.save();

                if (paymentStatus === 'completed') {
                    try { await deductStockForOrder(order); } catch (e) { console.error('[Paytm Webhook] Stock deduction failed:', e.message); }
                    await createShiprocketOrderOnPaymentComplete(order);
                    queuePurchaseCapiEvent({ req, order });
                    console.log('[Paytm] ✅ Webhook: Payment SUCCESS for order:', order.orderNumber);
                } else {
                    console.log('[Paytm] Webhook: Payment', paymentStatus, 'for order:', order.orderNumber);
                }

                return res.status(200).json({ success: true, message: `Payment ${paymentStatus}` });

            } else if (preOrderPayment) {
                if (preOrderPayment.status === 'completed') {
                    return res.status(200).json({ success: true, message: 'Already processed' });
                }

                preOrderPayment.status = paymentStatus;
                preOrderPayment.payment = preOrderPayment.payment || {};
                if (statusResult.txnId || TXNID) preOrderPayment.payment.gatewayTransactionId = statusResult.txnId || TXNID;
                if (paymentStatus === 'completed') preOrderPayment.payment.completedAt = new Date();
                preOrderPayment.payment.rawResponse = params;
                preOrderPayment.updatedAt = new Date();
                await preOrderPayment.save();

                console.log('[Paytm] ✅ Webhook: PreOrderPayment', paymentStatus, ':', preOrderPayment._id);
                return res.status(200).json({ success: true, message: `Pre-order payment ${paymentStatus}` });

            } else {
                console.warn('[Paytm] Webhook: No order found for orderId:', paytmOrderId);
                return res.status(200).json({ success: false, message: 'Order not found' });
            }

        } catch (error) {
            console.error('[Paytm] paytmWebhook error:', error.message);
            // Always 200 to stop Paytm retries
            return res.status(200).json({ success: false, message: 'Webhook processing error' });
        }
    }

}

module.exports = new PaymentController();