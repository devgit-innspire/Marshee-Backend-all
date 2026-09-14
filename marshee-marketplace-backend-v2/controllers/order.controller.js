const Order = require('../models/order.model');
// const Order = require('../models/order.model.improved');
const Cart = require('../models/cart.model');
const Product = require('../models/product.model');
const { Service } = require('../models/service.model');
const Coupon = require('../models/coupon.model');
const Address = require('../models/address.model');
const User = require('../models/user.model');
const Partner = require('../models/partner.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');
const { createSubscriptionForServiceOrderItem } = require('./helpers/serviceSubscription.helper');
const { isStaff } = require('../utils/roles');

/** Resolve partner IDs for a partner user (for filtering orders by items.partner). */
async function getPartnerIdsForUser(user) {
    if (user.role !== 'partner') return null;
    const userId = user._id || user.id;
    if (!userId) return null;
    let partner = await Partner.findOne({ user: userId }).lean();
    if (!partner && user.email) {
        partner = await Partner.findOne({ 'contact.email': user.email }).lean();
    }
    if (!partner) return null;
    return [partner._id, userId]; // include userId for legacy products with User _id as partner
}

/**
 * Post-process orders to attach variant images from the product's embedded
 * variants array, since variants are subdocuments of Product (not standalone
 * Variant collection docs) and the populate on items.variant may return nulls.
 */
function enrichOrdersWithVariantImages(orders) {
    return orders.map(order => {
        const o = order.toObject({ virtuals: true });
        for (const item of o.items) {
            if (!item.product || !item.variant) continue;

            const variantId = (item.variant._id || item.variant).toString();
            const productVariants = item.product.variants;
            if (!Array.isArray(productVariants)) continue;

            const matched = productVariants.find(
                v => v._id && v._id.toString() === variantId
            );
            if (matched && matched.media) {
                item.variant.media = matched.media;
                item.variant.images = matched.media.images || [];
            } else {
                item.variant.images = [];
            }
        }
        return o;
    });
}

function normalizePackageCode(servicePackageCode) {
    if (!servicePackageCode) return null;
    return String(servicePackageCode).trim().toLowerCase();
}

class OrderController {
    async createOrder(req, res, next) {
        try {
            const userId = req.user.id;
            const { 
                shippingAddressId, 
                billingAddressId, 
                paymentMethod, 
                couponCode,
                notes,
                deliveryInstructions,
                instructions
            } = req.body;

            // Get user's cart
            const cart = await Cart.findOne({ user: userId });
            if (!cart || cart.items.length === 0) {
                throw new ErrorResponse('Cart is empty', StatusCodes.BAD_REQUEST);
            }

            // Validate shipping address ID (required)
            if (!shippingAddressId) {
                throw new ErrorResponse('Shipping address ID is required', StatusCodes.BAD_REQUEST);
            }

            // If billingAddressId is not provided, use shippingAddressId
            const finalBillingAddressId = billingAddressId || shippingAddressId;

            // Verify addresses exist and belong to user
            const [shippingAddress, billingAddress, user] = await Promise.all([
                Address.findOne({ _id: shippingAddressId, user: userId, isDeleted: false }),
                Address.findOne({ _id: finalBillingAddressId, user: userId, isDeleted: false }),
                User.findById(userId).select('email')
            ]);

            if (!shippingAddress) {
                throw new ErrorResponse('Shipping address not found or does not belong to user', StatusCodes.NOT_FOUND);
            }

            if (!billingAddress) {
                throw new ErrorResponse('Billing address not found or does not belong to user', StatusCodes.NOT_FOUND);
            }

            // Check stock availability for products and validate services
            for (const item of cart.items) {
                // Handle products - check stock
                if (item.itemType === 'product' || item.product) {
                    const product = await Product.findById(item.product);
                    if (!product) {
                        throw new ErrorResponse(`Product ${item.product} not found`, StatusCodes.NOT_FOUND);
                    }

                    // Stock is tracked per-variant. A variant must always be selected for products.
                    if (!item.variant) {
                        throw new ErrorResponse(`Variant is required for product ${product.name}`, StatusCodes.BAD_REQUEST);
                    }

                    const variant = product.variants.find(v => v._id.toString() === item.variant.toString());
                    if (!variant) {
                        throw new ErrorResponse(`Selected variant not found for product ${product.name}`, StatusCodes.BAD_REQUEST);
                    }

                    const availableStock = Number(variant.stock?.quantity) || 0;

                    if (availableStock < item.quantity) {
                        throw new ErrorResponse(`Insufficient stock for product ${product.name}`, StatusCodes.BAD_REQUEST);
                    }
                }
                // Handle services - validate they exist and are active
                else if (item.itemType === 'service' || item.service) {
                    const service = await Service.findById(item.service);
                    if (!service) {
                        throw new ErrorResponse(`Service ${item.service} not found`, StatusCodes.NOT_FOUND);
                    }
                    if (!service.isActive) {
                        throw new ErrorResponse(`Service ${service.name} is not active`, StatusCodes.BAD_REQUEST);
                    }
                }
            }

            // Coupon will be validated and applied after server-side subtotal is computed (BUG-06)
            let couponDiscount = 0;
            let appliedCoupon = {};

            // Create order items with server-side price validation for both products and services
const orderItems = await Promise.all(cart.items.map(async (item) => {
  const itemType = item.itemType || (item.service ? 'service' : 'product');
  
  // Handle Products
  if (itemType === 'product' || item.product) {
    const product = await Product.findById(item.product);
    if (!product) {
      throw new ErrorResponse(`Product ${item.product} not found`, StatusCodes.NOT_FOUND);
    }

    const variant = item.variant
      ? product.variants.find(v => v._id.toString() === item.variant.toString())
      : null;

    // Authoritative pricing from backend (ignore client-provided price/discount)
    const authoritativeOriginalPrice = Number(
      (variant && variant.price && (variant.price.mrp ?? variant.price.listPrice)) ??
      (product && product.pricing && product.pricing.basePrice) ??
      0
    );
    const authoritativeSellingPrice = Number(
      (variant && variant.price && (variant.price.discounted ?? variant.price.listPrice)) ??
      (product && product.pricing && product.pricing.basePrice) ??
      authoritativeOriginalPrice
    );

    const perUnitDiscount = Math.max(0, authoritativeOriginalPrice - authoritativeSellingPrice);
    const quantity = Math.max(1, Number(item.quantity ?? 1));

    // Commission based on effective unit price
    const commissionPercentage = Number(
      (variant && variant.commission && variant.commission.percentage) ??
      (product && product.pricing && product.pricing.commission && product.pricing.commission.percentage) ??
      0
    );
    const effectiveUnitPrice = Math.max(0, authoritativeOriginalPrice - perUnitDiscount);
    const commissionAmount = Math.max(
      0,
      Number.isFinite(effectiveUnitPrice) && Number.isFinite(commissionPercentage)
        ? (effectiveUnitPrice * commissionPercentage) / 100
        : 0
    );

    // Snapshot fields (name must be non-empty for Shiprocket invoice; include variant name and variant SKU when present)
    const snapshotSku = (variant && variant.sku) || product.sku || undefined;
    const baseName = (product.name && String(product.name).trim()) || product.slug || product.productId || (product.sku && `Product ${product.sku}`) || 'Product';
    const variantNamePart = (variant && variant.name && String(variant.name).trim()) ? ` - ${String(variant.name).trim()}` : '';
    const snapshotName = baseName + variantNamePart;
    const snapshotImage = (variant && variant.media && Array.isArray(variant.media.images) && variant.media.images[0]) || undefined;
    const snapshotAttributes =
      variant && variant.attributes
        ? variant.attributes instanceof Map
          ? Object.fromEntries(variant.attributes)
          : typeof variant.attributes === 'object'
            ? { ...variant.attributes }
            : undefined
        : undefined;

    const snapshotHsn = (product.hsnCode && String(product.hsnCode).trim()) || undefined;

    return {
      itemType: 'product',
      product: item.product,
      variant: item.variant,
      // snapshots to preserve purchase-time metadata
      sku: snapshotSku,
      name: snapshotName,
      image: snapshotImage,
      attributes: snapshotAttributes,
      hsn: snapshotHsn,
      quantity,
      // store original price and discount so total = (original - discount) * qty
      price: authoritativeOriginalPrice,
      originalPrice: authoritativeOriginalPrice,
      discount: perUnitDiscount,
    //   totalPrice: Math.max(0, (authoritativeOriginalPrice - perUnitDiscount) * quantity),
      // item-level tax and dimensions for order.model.js
      taxAmount: 0,
      weightGrams: (variant && variant.dimensions && Number(variant.dimensions.weight)) ||
                   (product && product.dimensions && Number(product.dimensions.weight_g)) ||
                   undefined,
      dimensions: {
        lengthCm: (variant && variant.dimensions && Number(variant.dimensions.length)) ||
                  (product && product.dimensions && Number(product.dimensions.length_cm)) ||
                  undefined,
        widthCm: (variant && variant.dimensions && Number(variant.dimensions.width)) ||
                 (product && product.dimensions && Number(product.dimensions.width_cm)) ||
                 undefined,
        heightCm: (variant && variant.dimensions && Number(variant.dimensions.height)) ||
                  (product && product.dimensions && Number(product.dimensions.height_cm)) ||
                  undefined
      },
      commission: {
        percentage: commissionPercentage,
        amount: commissionAmount
      },
      partner: product.partner
    };
  }
  // Handle Services
  else if (itemType === 'service' || item.service) {
    const service = await Service.findById(item.service);
    if (!service) {
      throw new ErrorResponse(`Service ${item.service} not found`, StatusCodes.NOT_FOUND);
    }

    const normalizedPackageCode = normalizePackageCode(item.servicePackageCode);
    let authoritativeOriginalPrice;
    let authoritativeSellingPrice;
    let resolvedPackageName = null;

    // Authoritative pricing from backend
    if (service.serviceType === 'training') {
      if (!normalizedPackageCode) {
        throw new ErrorResponse(`Training package is required for service ${item.service}`, StatusCodes.BAD_REQUEST);
      }
      const packages = Array.isArray(service.training?.packages) ? service.training.packages : [];
      const selectedPackage = packages.find(pkg => normalizePackageCode(pkg?.code) === normalizedPackageCode);
      if (!selectedPackage || selectedPackage.isActive === false) {
        throw new ErrorResponse(`Training package ${normalizedPackageCode} is not available`, StatusCodes.BAD_REQUEST);
      }
      authoritativeOriginalPrice = Number(selectedPackage.pricing?.mrp || selectedPackage.pricing?.listPrice || 0);
      authoritativeSellingPrice = Number(selectedPackage.pricing?.listPrice || selectedPackage.pricing?.mrp || 0);
      resolvedPackageName = selectedPackage.name || selectedPackage.code;
    } else {
      authoritativeOriginalPrice = Number(service.pricing?.mrp || service.pricing?.listPrice || 0);
      authoritativeSellingPrice = Number(service.pricing?.listPrice || service.pricing?.mrp || 0);
    }

    const perUnitDiscount = Math.max(0, authoritativeOriginalPrice - authoritativeSellingPrice);
    const quantity = Math.max(1, Number(item.quantity ?? 1));

    // Calculate extras total
    const extrasTotal = item.selectedExtras ? item.selectedExtras.reduce((sum, extra) => sum + (extra.price || 0), 0) : 0;
    const totalPriceWithExtras = (authoritativeSellingPrice + extrasTotal) * quantity;

    // Service snapshot fields
    const snapshotName = service.name || undefined;
    const snapshotImage = service.images && Array.isArray(service.images) && service.images.length > 0 
      ? service.images[0] 
      : undefined;

    const serviceSubscriptionId = await createSubscriptionForServiceOrderItem({
      userId,
      service,
      cartItem: item,
      quantity,
      amountPaid: ((authoritativeOriginalPrice - perUnitDiscount) + extrasTotal) * quantity
    });

    return {
      itemType: 'service',
      service: item.service,
      subscription: serviceSubscriptionId,
      // Service snapshots
      name: snapshotName,
      image: snapshotImage,
      quantity,
      // Pricing: price is originalPrice (MRP), discount is MRP - listPrice
      // The pre-save hook will calculate: (price - discount + extrasTotal) * quantity for services
      price: authoritativeOriginalPrice,
      originalPrice: authoritativeOriginalPrice,
      discount: perUnitDiscount,
      // Service-specific fields
      selectedExtras: item.selectedExtras || [],
      servicePackageCode: normalizedPackageCode,
      servicePackageName: resolvedPackageName || item.servicePackageName || null,
      selectedDate: item.selectedDate || null,
      serviceNotes: item.notes || null,
      // Service doesn't have tax, weight, dimensions, or commission in the same way
      taxAmount: 0,
      weightGrams: undefined,
      dimensions: undefined,
      commission: {
        percentage: 0,
        amount: 0
      },
      partner: service.partner?.partnerId || undefined
    };
  }
  
  throw new ErrorResponse('Invalid cart item: must be either product or service', StatusCodes.BAD_REQUEST);
}));

            // Calculate order totals (including service extras)
            const subtotal = orderItems.reduce((sum, item) => {
              const baseSubtotal = item.originalPrice * item.quantity;
              // Add extras total for services
              const extrasTotal = item.selectedExtras ? item.selectedExtras.reduce((extrasSum, extra) => extrasSum + (extra.price || 0), 0) * item.quantity : 0;
              return sum + baseSubtotal + extrasTotal;
            }, 0);

            // Validate and apply coupon if provided using database-verified subtotal (BUG-06)
            if (couponCode) {
                const coupon = await Coupon.findOne({ 
                    code: couponCode.toUpperCase(),
                    isActive: true
                });

                if (coupon && coupon.isValid) {
                    if (coupon.canUserUse(userId, subtotal)) {
                        couponDiscount = coupon.calculateDiscount(subtotal);
                        appliedCoupon = {
                            coupon: coupon._id,
                            discountAmount: couponDiscount,
                            code: coupon.code
                        };
                    }
                }
            }

            const totalDiscount = orderItems.reduce((sum, item) => sum + (item.discount * item.quantity), 0) + couponDiscount;
            // const taxAmount = (subtotal - totalDiscount) * 0.18;
            const totalAmount = subtotal - totalDiscount + cart.shippingCost;

            const notesObj = typeof notes === 'object' && notes !== null ? notes : {};
            const customerInstructions =
                (typeof deliveryInstructions === 'string' && deliveryInstructions.trim()) ||
                (typeof instructions === 'string' && instructions.trim()) ||
                (typeof notesObj.customer === 'string' && notesObj.customer.trim()) ||
                (cart.checkoutPreferences?.deliveryInstructions &&
                    String(cart.checkoutPreferences.deliveryInstructions).trim()) ||
                '';

            const effectivePaymentMethod = paymentMethod || cart.checkoutPreferences?.paymentMethod;
            if (!effectivePaymentMethod) {
                throw new ErrorResponse('Payment method is required', StatusCodes.BAD_REQUEST);
            }

            // Create order
            const order = await Order.create({
                user: userId,
                items: orderItems,
                subtotal,
                totalDiscount,
                shippingCost: cart.shippingCost,
                // taxAmount,
                totalAmount,
                appliedCoupon,
                shippingAddress: shippingAddressId,
                billingAddress: finalBillingAddressId,
                // store minimal contact from address
                contact: {
                    email: user?.email || undefined,
                    phone: user?.phoneNumber || undefined
                },
                // best-effort address snapshots based on available fields in Address model
                shippingAddressSnapshot: shippingAddress ? {
                    fullName: user?.name || undefined,
                    phone: user?.phoneNumber || undefined,
                    line1: shippingAddress.shippingAddress?.street,
                    line2: undefined,
                    city: shippingAddress.shippingAddress?.city,
                    state: shippingAddress.shippingAddress?.state,
                    postalCode: shippingAddress.shippingAddress?.postalCode,
                    country: shippingAddress.shippingAddress?.country || 'IN',
                    landmark: undefined,
                    geo: undefined
                } : undefined,
                billingAddressSnapshot: billingAddress ? {
                    fullName: user?.name || undefined,
                    phone: user?.phoneNumber || undefined,
                    line1: billingAddress.billingAddress?.street,
                    line2: undefined,
                    city: billingAddress.billingAddress?.city,
                    state: billingAddress.billingAddress?.state,
                    postalCode: billingAddress.billingAddress?.postalCode,
                    country: billingAddress.billingAddress?.country || 'IN',
                    gstNumber: undefined
                } : undefined,
                payment: {
                    method: effectivePaymentMethod,
                    status: 'pending',
                    gatewayOrderId: null, // for Razorpay/PhonePe/etc
                    transactionId: null,  // after success
                    amount: totalAmount,
                    currency: 'INR'
                  },
                deliveryPreferences: {
                    instructions: customerInstructions || undefined,
                    contactless: false
                },
                shipping: {
                    method: 'Standard Delivery',
                    estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
                },
                notes: {
                    customer: customerInstructions || notesObj.customer || '',
                    internal: notesObj.internal || ''
                }
            });

            // Calculate partner payments
            order.calculatePartnerPayments();
            await order.save();

            // Premature cart clearance removed (BUG-03) - cart will be cleared on payment webhook completion
            // cart.clearCart();
            // await cart.save();

            // Update coupon usage if applied
            if (appliedCoupon.coupon) {
                await Coupon.findByIdAndUpdate(appliedCoupon.coupon, {
                    $inc: { usedCount: 1, totalDiscountGiven: couponDiscount, totalOrders: 1 }
                });
            }

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Order created successfully',
                data: order
            });

        } catch (error) {
            next(error);
        }
    }

    async getOrders(req, res, next) {
        try {
            const userId = req.user.id;
            const isAdmin = isStaff(req.user);
            const isPartner = req.user.role === 'partner';
            const { 
                page = 1, 
                limit = 10, 
                status,
                paymentStatus 
            } = req.query;

            let query;
            if (isAdmin) {
                query = {}; // Admin uses getAllOrders at /admin/all; this path can still return empty or all
            } else if (isPartner) {
                const partnerIds = await getPartnerIdsForUser(req.user);
                if (!partnerIds || partnerIds.length === 0) {
                    query = { _id: null }; // No partner profile, return no orders
                } else {
                    query = { 'items.partner': { $in: partnerIds } };
                }
            } else {
                query = { user: userId };
            }

            if (status) query.status = status;
            if (paymentStatus) query['payment.status'] = paymentStatus;

            const skip = (page - 1) * limit;

            const orders = await Order.find(query)
                .populate('user', 'name email phoneNumber')
                .populate('items.product', 'name sku defaultMedia pricing variants')
                .populate('items.variant', 'name attributes media')
                .populate('items.service', 'name slug serviceType category pricing images partner')
                .populate('items.subscription')
                .populate('items.partner', 'name code')
                .populate('appliedCoupon.coupon', 'code name')
                .populate('partnerPayments.partner', 'name code')
                .populate('shippingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .populate('billingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit));

            const total = await Order.countDocuments(query);

            const ordersData = enrichOrdersWithVariantImages(orders);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: ordersData,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getMyOrders(req, res, next) {
        try {
            const userId = req.user.id;
            const {
                page = 1,
                limit = 10,
                status,
                paymentStatus
            } = req.query;

            const query = { user: userId };

            if (status) query.status = status;
            if (paymentStatus) query['payment.status'] = paymentStatus;

            const skip = (page - 1) * limit;

            const orders = await Order.find(query)
                .populate('user', 'name email phoneNumber')
                .populate('items.product', 'name sku defaultMedia pricing variants')
                .populate('items.variant', 'name attributes media')
                .populate('items.service', 'name slug serviceType category pricing images partner')
                .populate('items.subscription')
                .populate('items.partner', 'name code')
                .populate('appliedCoupon.coupon', 'code name')
                .populate('partnerPayments.partner', 'name code')
                .populate('shippingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .populate('billingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit));

            const total = await Order.countDocuments(query);

            const ordersData = enrichOrdersWithVariantImages(orders);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: ordersData,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            next(error);
        }
    }

    async getOrderById(req, res, next) {
        try {
            const userId = req.user.id;
            const isAdmin = isStaff(req.user);
            const isPartner = req.user.role === 'partner';
            const { id } = req.params;

            let order;
            if (isAdmin) {
                order = await Order.findById(id);
            } else if (isPartner) {
                const partnerIds = await getPartnerIdsForUser(req.user);
                if (!partnerIds || partnerIds.length === 0) {
                    order = null;
                } else {
                    order = await Order.findOne({ _id: id, 'items.partner': { $in: partnerIds } });
                }
            } else {
                order = await Order.findOne({ _id: id, user: userId });
            }

            if (order) {
                order = await Order.findById(order._id)
                    .populate('user', 'name email phoneNumber')
                    .populate('items.product', 'name sku description defaultMedia pricing variants')
                    .populate('items.variant', 'name attributes price media')
                    .populate('items.service', 'name slug serviceType category pricing images partner shortDescription longDescription')
                    .populate('items.subscription')
                    .populate('items.partner', 'name code contact')
                    .populate('appliedCoupon.coupon', 'code name discountType discountValue')
                    .populate('partnerPayments.partner', 'name code contact')
                    .populate('shippingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                    .populate('billingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling');
            }

            if (!order) {
                throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
            }

            const [orderData] = enrichOrdersWithVariantImages([order]);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: orderData
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get tracking info for an order (for dashboard).
     * Returns saved tracking number, URL, carrier; optionally ?live=true fetches latest status from Shiprocket.
     */
    async getOrderTracking(req, res, next) {
        try {
            const userId = req.user.id;
            const isAdmin = isStaff(req.user);
            const isPartner = req.user.role === 'partner';
            const { id } = req.params;
            const live = req.query.live === 'true' || req.query.live === '1';

            let partnerIds = null;
            let accessQuery;
            if (isAdmin) {
                accessQuery = { _id: id };
            } else if (isPartner) {
                partnerIds = await getPartnerIdsForUser(req.user);
                if (!partnerIds || partnerIds.length === 0) {
                    throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
                }
                accessQuery = { _id: id, 'items.partner': { $in: partnerIds } };
            } else {
                accessQuery = { _id: id, user: userId };
            }

            const order = await Order.findOne(accessQuery)
                .populate('items.product', 'name sku defaultMedia pricing variants')
                .populate('items.partner', 'name code')
                .lean();

            if (!order) {
                throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
            }

            // Build variant image map from products' embedded variants
            const variantMediaMap = new Map();
            for (const item of order.items) {
                if (item.product?.variants && item.variant) {
                    for (const v of item.product.variants) {
                        if (v._id) variantMediaMap.set(v._id.toString(), v.media);
                    }
                }
            }

            const items = order.items
                .filter(item => {
                    if (!isPartner || !partnerIds) return true;
                    return item.partner && partnerIds.some(
                        pId => pId.toString() === (item.partner._id || item.partner).toString()
                    );
                })
                .map(item => {
                    const variantId = (item.variant?._id || item.variant)?.toString();
                    const variantMedia = variantId ? variantMediaMap.get(variantId) : null;

                    return {
                        itemId: item._id,
                        itemType: item.itemType,
                        name: item.name || item.product?.name || null,
                        sku: item.sku || item.product?.sku || null,
                        image: item.image || null,
                        images: variantMedia?.images || [],
                        quantity: item.quantity,
                        price: item.price,
                        // totalPrice: item.totalPrice,
                        partner: item.partner?._id ? {
                            id: item.partner._id,
                            name: item.partner.name || null,
                            code: item.partner.code || null,
                        } : null,
                        fulfillment: {
                            status: item.fulfillment?.status || 'pending',
                            shippedQuantity: item.fulfillment?.shippedQuantity || 0,
                            deliveredQuantity: item.fulfillment?.deliveredQuantity || 0,
                            trackingNumber: item.fulfillment?.trackingNumber || null,
                            carrier: item.fulfillment?.carrier || null,
                            shippedAt: item.fulfillment?.shippedAt || null,
                            deliveredAt: item.fulfillment?.deliveredAt || null,
                        },
                    };
                });

            // Shipping & fulfillment tracking
            const ship = order.shipping || {};
            const sr = ship.shiprocket || {};

            let fulfillments = (sr.fulfillments || []).map(f => ({
                partnerId: f.partnerId,
                awbCode: f.awbCode,
                courierName: f.courierName,
                courierId: f.courierId,
                trackingUrl: f.trackingUrl,
                labelUrl: f.labelUrl,
                status: f.status,
                statusCode: f.statusCode,
                shippingCharge: f.shippingCharge,
                updatedAt: f.updatedAt,
            }));

            if (isPartner && partnerIds) {
                fulfillments = fulfillments.filter(f =>
                    f.partnerId && partnerIds.some(
                        pId => pId.toString() === (f.partnerId?.toString() || '')
                    )
                );
            }

            const pf = fulfillments[0] || null;

            const tracking = {
                method: ship.method || null,
                estimatedDelivery: ship.estimatedDelivery || null,
                shippedAt: ship.shippedAt || null,
                deliveredAt: ship.deliveredAt || null,
                trackingNumber: pf?.awbCode || ship.trackingNumber || null,
                awbCode: pf?.awbCode || sr.awbCode || null,
                carrier: pf?.courierName || ship.carrier || sr.courierName || null,
                trackingUrl: pf?.trackingUrl || sr.trackingUrl || null,
                labelUrl: pf?.labelUrl || sr.labelUrl || null,
                shipmentStatus: pf?.status || sr.status || null,
                fulfillments,
            };

            if (live && tracking.awbCode) {
                try {
                    const shiprocketIntegration = require('../utils/shiprocket.integration');
                    const shiprocketService = require('../utils/shiprocket.service');
                    const token = await shiprocketIntegration.getToken({});
                    const trackData = await shiprocketService.trackByAWB(token, tracking.awbCode);
                    tracking.liveStatus = trackData?.tracking_data?.shipment_status || null;
                    tracking.liveTrackUrl = trackData?.tracking_data?.track_url || tracking.trackingUrl;
                } catch (e) {
                    tracking.liveStatusError = e.message || 'Failed to fetch live tracking';
                }
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: {
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                    orderStatus: order.status,
                    orderDate: order.createdAt,
                    payment: {
                        method: order.payment?.method || null,
                        status: order.payment?.status || null,
                        gateway: order.payment?.gateway || null,
                        paidAt: order.payment?.paidAt || null,
                        amount: order.payment?.amount || order.totalAmount,
                        currency: order.payment?.currency || order.currency || 'INR',
                        transactionId: order.payment?.transactionId || null,
                    },
                    shippingAddress: order.shippingAddressSnapshot || null,
                    billingAddress: order.billingAddressSnapshot || null,
                    items,
                    tracking,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    async updateOrderStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status, trackingNumber, carrier, notes } = req.body;

            const order = await Order.findById(id);
            if (!order) {
                throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
            }

            // Update order status
            order.updateStatus(status);

            // Update shipping details if provided
            if (trackingNumber) order.shipping.trackingNumber = trackingNumber;
            if (carrier) order.shipping.carrier = carrier;
            if (notes?.internal) order.notes.internal = notes.internal;

            await order.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Order status updated successfully',
                data: order
            });

        } catch (error) {
            next(error);
        }
    }

    async cancelOrder(req, res, next) {
        try {
            const userId = req.user.id;
            const { id } = req.params;
            const { reason } = req.body;

            const order = await Order.findOne({ _id: id, user: userId });
            if (!order) {
                throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
            }

            // Check if order can be cancelled
            if (!['pending', 'confirmed'].includes(order.status)) {
                throw new ErrorResponse('Order cannot be cancelled at this stage', StatusCodes.BAD_REQUEST);
            }

            // Update order status
            order.updateStatus('cancelled');
            if (reason) order.notes.customer = reason;

            await order.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Order cancelled successfully',
                data: order
            });

        } catch (error) {
            next(error);
        }
    }

    async getAllOrders(req, res, next) {
        try {
            const isPartner = req.user.role === 'partner';
            const { 
                page = 1, 
                limit = 10, 
                status,
                paymentStatus,
                userId 
            } = req.query;

            const query = {};
            if (isPartner) {
                const partnerIds = await getPartnerIdsForUser(req.user);
                if (!partnerIds || partnerIds.length === 0) {
                    query._id = null;
                } else {
                    query['items.partner'] = { $in: partnerIds };
                }
            }
            if (status) query.status = status;
            if (paymentStatus) query['payment.status'] = paymentStatus;
            if (userId) query.user = userId;

            const skip = (page - 1) * limit;

            const orders = await Order.find(query)
                .populate('user', 'name email phoneNumber')
                .populate('items.product', 'name sku defaultMedia pricing variants')
                .populate('items.variant', 'name attributes price media')
                .populate('items.service', 'name slug serviceType category pricing images partner')
                .populate('items.subscription')
                .populate('items.partner', 'name code')
                .populate('appliedCoupon.coupon', 'code name')
                .populate('partnerPayments.partner', 'name code')
                .populate('shippingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .populate('billingAddress', 'addressType billingAddress shippingAddress isDefaultShipping isDefaultBilling')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit));

            const total = await Order.countDocuments(query);

            const ordersData = enrichOrdersWithVariantImages(orders);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: ordersData,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async updatePaymentStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { paymentStatus, transactionId, gateway } = req.body;

            const order = await Order.findById(id);
            if (!order) {
                throw new ErrorResponse('Order not found', StatusCodes.NOT_FOUND);
            }

            order.payment.status = paymentStatus;
            if (transactionId) order.payment.transactionId = transactionId;
            if (gateway) order.payment.gateway = gateway;
            if (paymentStatus === 'completed') {
                order.payment.paidAt = new Date();
            }

            await order.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Payment status updated successfully',
                data: order
            });

        } catch (error) {
            next(error);
        }
    }
    async shiprocketWebhook (req, res, next) {
        try {
          const requestId = req.headers['x-request-id'] || `shiprocket_${Date.now()}`;
          const receivedToken = req.headers['x-api-key'];
    
          const SECRET_TOKEN = process.env.SHIPROCKET_WEBHOOK_TOKEN;
    
          if (!SECRET_TOKEN) {
            console.error(`[Shiprocket Webhook] (${requestId}) SHIPROCKET_WEBHOOK_TOKEN is not set`);
            return res.status(500).json({ success: false, message: 'Webhook token not configured on server' });
          }
    
          if (!receivedToken || receivedToken !== SECRET_TOKEN) {
            console.warn(`[Shiprocket Webhook] (${requestId}) Unauthorized request (x-api-key mismatch)`);
            return res.status(401).json({ success: false, message: 'Unauthorized' });
          }
    
          const data = req.body || {};
          console.log('Shiprocket webhook payload received');
    
          const awb = data.awb || data.awb_code || data.awbCode || data.tracking_number || data.trackingNumber;
          const shiprocketCurrentStatusRaw = data.current_status || data.status;
          const shiprocketCurrentStatus = shiprocketCurrentStatusRaw
            ? String(shiprocketCurrentStatusRaw).trim().replace(/\s+/g, ' ').toUpperCase()
            : shiprocketCurrentStatusRaw;
          const statusCode = data.current_status_id ?? data.status_code ?? data.current_status_code;
    
          console.log(
            `[Shiprocket Webhook] (${requestId}) hit`,
            JSON.stringify({ awb, shiprocketCurrentStatus: shiprocketCurrentStatusRaw, normalizedStatus: shiprocketCurrentStatus, statusCode })
          );
    
          if (!awb) return res.status(400).json({ success: false, message: 'awb is required in webhook payload' });
          if (!shiprocketCurrentStatusRaw) return res.status(400).json({ success: false, message: 'current_status is required in webhook payload' });
    
          const statusMap = {
            NEW: 'pending',
            'AWB ASSIGNED': 'confirmed',
            'PICKED UP': 'shipped',
            'IN TRANSIT': 'shipped',
            'OUT FOR DELIVERY': 'out_for_delivery',
            DELIVERED: 'delivered',
            'RTO INITIATED': 'rto',
            'RTO DELIVERED': 'returned',
            CANCELLED: 'cancelled'
          };

          const mappedStatus = shiprocketCurrentStatus ? statusMap[shiprocketCurrentStatus] : undefined;
          if (!mappedStatus) {
            console.warn(
              `[Shiprocket Webhook] (${requestId}) Unknown shiprocket status: ${shiprocketCurrentStatusRaw}. Order not updated.`
            );
            return res.status(200).json({
              success: true,
              message: 'Unknown shiprocket status ignored',
              data: { awb, shiprocketCurrentStatus: shiprocketCurrentStatusRaw }
            });
          }
    
          // Your schema stores AWB at `shipping.shiprocket.awbCode` (and sometimes in shipments).
          const order = await Order.findOne({
            $or: [
              { 'shipping.shiprocket.awbCode': awb },
              { 'shipping.trackingNumber': awb },
              { 'shipments.shiprocket.awbCode': awb }
            ]
          });
    
          if (!order) {
            console.warn(`[Shiprocket Webhook] (${requestId}) Order not found for awb=${awb}`);
            return res.status(404).json({ success: false, message: 'Order not found for this awb' });
          }
    
          const previousStatus = order.status;
    
          // Refresh shipping metadata
          order.shipping = order.shipping || {};
          order.shipping.shiprocket = order.shipping.shiprocket || {};
          order.shipping.trackingNumber = order.shipping.trackingNumber || awb;
          order.shipping.shiprocket.awbCode = order.shipping.shiprocket.awbCode || awb;
          order.shipping.shiprocket.status = shiprocketCurrentStatusRaw;
          order.shipping.shiprocket.updatedAt = new Date();
          if (statusCode !== undefined && statusCode !== null && statusCode !== '') {
            const numericStatusCode = Number(statusCode);
            if (!Number.isNaN(numericStatusCode)) order.shipping.shiprocket.statusCode = numericStatusCode;
          }
    
          if (previousStatus !== mappedStatus) {
            order.updateStatus(mappedStatus, {
              note: `Shiprocket webhook: ${shiprocketCurrentStatusRaw}`,
              by: undefined
            });
    
            console.log(
              `[Shiprocket Webhook] (${requestId}) Updated order ${order.orderNumber} status: ${previousStatus} -> ${mappedStatus}`
            );
          } else {
            console.log(
              `[Shiprocket Webhook] (${requestId}) Order ${order.orderNumber} already in status=${mappedStatus}. Shipping metadata refreshed.`
            );
          }
    
          await order.save();
    
          return res.status(200).json({
            success: true,
            message: 'Order status updated from Shiprocket webhook',
            data: {
              orderId: order._id,
              orderNumber: order.orderNumber,
              awb,
              status: mappedStatus
            }
          });
        } catch (error) {
          console.error('[Shiprocket Webhook] Error:', error);
          res.status(500).json({ success: false, message: 'Error processing Shiprocket webhook' });
        }
      }
}

module.exports = new OrderController();