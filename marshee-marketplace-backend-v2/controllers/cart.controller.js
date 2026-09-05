const Cart = require('../models/cart.model');
const Product = require('../models/product.model');
const { Service, Subscription } = require('../models/service.model');
const Coupon = require('../models/coupon.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const { queueAddToCartCapiEvent } = require('../utils/metaCapi');
const mongoose = require('mongoose');
const {
  upsertSubscriptionForServiceCartItem,
  cancelPendingSubscription
} = require('./helpers/serviceSubscription.helper');

// Helpers
async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId });
  return cart;
}

// Utility function to normalize IDs - handles both string IDs and MongoDB ObjectIds
function normalizeId(id) {
  if (!id) return null;
  
  // If it's already a valid ObjectId, return it
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  
  // If it's a string that looks like an ObjectId, convert it
  if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  
  // For other string IDs, return as string
  return id.toString();
}

// Utility function to convert ID to string for comparison
function idToString(id) {
  if (!id) return null;
  return id.toString();
}

function pickVariant(product, variantId) {
  if (!variantId) {
    throw new ErrorResponse('Variant ID is required for all products', StatusCodes.BAD_REQUEST);
  }
  
  // Normalize the variantId for comparison
  const normalizedVariantId = normalizeId(variantId);
  const variantIdString = idToString(normalizedVariantId);
  
  // Try to find variant by _id first (MongoDB ObjectId)
  let variant = product.variants?.find(x => {
    const variantIdStr = idToString(x._id);
    return variantIdStr === variantIdString;
  });
  
  // If not found by _id, try to find by variantId field (string ID)
  if (!variant) {
    variant = product.variants?.find(x => {
      const variantIdStr = idToString(x.variantId);
      return variantIdStr === variantIdString;
    });
  }
  
  if (!variant) {
    throw new ErrorResponse('Variant not found for this product', StatusCodes.NOT_FOUND);
  }
  
  return variant;
}

function derivePricingAndStock(product, variant) {
  const price = Number(variant?.price?.listPrice) || 0;
  const originalPrice = Number(variant?.price?.mrp) || Number(variant?.price?.listPrice) || price;
  // Stock is tracked per-variant. Variant selection is required for products.
  const availableStock = Number(variant?.stock?.quantity ?? 0) || 0;
  return { price, originalPrice, availableStock };
}

function normalizePackageCode(servicePackageCode) {
  if (!servicePackageCode) return null;
  return String(servicePackageCode).trim().toLowerCase();
}

function deriveServicePricing(service, servicePackageCode) {
  const normalizedPackageCode = normalizePackageCode(servicePackageCode);

  if (service.serviceType === 'training') {
    if (!normalizedPackageCode) {
      throw new ErrorResponse('servicePackageCode is required for training services', StatusCodes.BAD_REQUEST);
    }

    const packages = Array.isArray(service.training?.packages) ? service.training.packages : [];
    const selectedPackage = packages.find(pkg => normalizePackageCode(pkg?.code) === normalizedPackageCode);
    if (!selectedPackage || selectedPackage.isActive === false) {
      throw new ErrorResponse('Invalid or inactive training package selected', StatusCodes.BAD_REQUEST);
    }

    const originalPrice = Number(selectedPackage.pricing?.mrp || selectedPackage.pricing?.listPrice || 0);
    const price = Number(selectedPackage.pricing?.listPrice || selectedPackage.pricing?.mrp || 0);
    if (price <= 0) {
      throw new ErrorResponse('Selected training package pricing is not available', StatusCodes.BAD_REQUEST);
    }

    return {
      price,
      originalPrice,
      servicePackageCode: normalizedPackageCode,
      servicePackageName: selectedPackage.name || selectedPackage.code
    };
  }

  const originalPrice = Number(service.pricing?.mrp || service.pricing?.listPrice || 0);
  const price = Number(service.pricing?.listPrice || service.pricing?.mrp || 0);
  if (price <= 0) {
    throw new ErrorResponse('Service pricing is not available', StatusCodes.BAD_REQUEST);
  }

  return { price, originalPrice, servicePackageCode: null, servicePackageName: null };
}

function resolveServicePricingForCart(service, {
  servicePackageCode = null,
  quotedPrice = null,
  quotedOriginalPrice = null
} = {}) {
  // Relocation supports on-demand pricing. It may be added at zero price and
  // priced later, or use a quoted override when available.
  if (service?.serviceType === 'relocation') {
    const hasValidQuote = Number(quotedPrice) > 0;
    if (hasValidQuote) {
      const price = Number(quotedPrice);
      const originalPrice = Number(quotedOriginalPrice) > 0 ? Number(quotedOriginalPrice) : price;
      return { price, originalPrice, servicePackageCode: null, servicePackageName: null };
    }
    return { price: 0, originalPrice: 0, servicePackageCode: null, servicePackageName: null };
  }

  return deriveServicePricing(service, servicePackageCode);
}

function toPetCakeId(value, fallback) {
  return String(value ?? fallback);
}

function toSelectionIds(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

function resolvePetCakeCustomizationPrice(service, petCakeBooking = {}) {
  const cakeConfig = service?.cake || {};
  const ingredients = petCakeBooking?.ingredients && typeof petCakeBooking.ingredients === 'object'
    ? petCakeBooking.ingredients
    : {};
  const customizationSelections = petCakeBooking?.customizationSelections && typeof petCakeBooking.customizationSelections === 'object'
    ? petCakeBooking.customizationSelections
    : {};

  let total = 0;

  const ingredientSections = Array.isArray(cakeConfig?.ingredientSections) ? cakeConfig.ingredientSections : [];
  for (let secIdx = 0; secIdx < ingredientSections.length; secIdx += 1) {
    const section = ingredientSections[secIdx] || {};
    const sectionId = toPetCakeId(section?.id, secIdx);
    const pickedIds = toSelectionIds(ingredients?.[sectionId]);
    if (!pickedIds.length) continue;

    const options = Array.isArray(section?.options) ? section.options : [];
    for (let optIdx = 0; optIdx < options.length; optIdx += 1) {
      const option = options[optIdx] || {};
      const optionId = toPetCakeId(option?.id, optIdx);
      if (pickedIds.includes(optionId)) total += Number(option?.additionalPrice || 0);
    }
  }

  const fields = Array.isArray(cakeConfig?.customizationFields) ? cakeConfig.customizationFields : [];
  for (let fieldIdx = 0; fieldIdx < fields.length; fieldIdx += 1) {
    const field = fields[fieldIdx] || {};
    const fieldId = toPetCakeId(field?.id, `field-${fieldIdx}`);
    const pickedIds = toSelectionIds(customizationSelections?.[fieldId]);
    if (!pickedIds.length) continue;

    const options = Array.isArray(field?.options) ? field.options : [];
    for (let optIdx = 0; optIdx < options.length; optIdx += 1) {
      const option = options[optIdx] || {};
      const optionId = toPetCakeId(option?.id ?? option?.value, `opt-${optIdx}`);
      if (pickedIds.includes(optionId)) total += Number(option?.additionalPrice || 0);
    }
  }

  return total;
}

/**
 * Build a synthetic "cart-item-shaped" object containing the booking
 * payloads from the request so the shared subscription helper can
 * persist the booking on the Subscription model.
 *
 * The cart item itself NEVER stores per-service-type booking blobs
 * going forward; only the resulting Subscription does.
 */
function buildBookingSnapshotForSubscription({
  cartItem,
  bookings,
  selectedExtras,
  selectedDate,
  notes,
  servicePackageCode,
  servicePackageName,
  service
}) {
  const snapshot = {
    service: service?._id,
    subscription: cartItem?.subscription,
    selectedExtras: Array.isArray(selectedExtras) ? selectedExtras : [],
    selectedDate: selectedDate || null,
    notes: notes || null,
    servicePackageCode: servicePackageCode || null,
    servicePackageName: servicePackageName || null
  };

  for (const [key, value] of Object.entries(bookings || {})) {
    if (value && typeof value === 'object') {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function computeCartItemAmountPaid(item) {
  const extrasTotal = Array.isArray(item?.selectedExtras)
    ? item.selectedExtras.reduce((sum, extra) => sum + Number(extra?.price || 0), 0)
    : 0;
  const unit = Number(item?.price || 0) + extrasTotal;
  return unit * Math.max(1, Number(item?.quantity || 1));
}

function validateRelocationBookingPayload(relocationBooking) {
  if (!relocationBooking || typeof relocationBooking !== 'object') {
    throw new ErrorResponse('relocationBooking is required for relocation services', StatusCodes.BAD_REQUEST);
  }

  const trip = relocationBooking.trip || {};
  const pickupLocation = String(trip.pickupLocation || '').trim();
  const dropLocation = String(trip.dropLocation || '').trim();
  const pickupPostalCode = String(trip.pickupPostalCode || '').trim();
  const dropPostalCode = String(trip.dropPostalCode || '').trim();
  const pickupDateRaw = trip.pickupDate;
  const travelMode = String(trip.travelMode || '').trim().toLowerCase();
  const allowedModes = new Set(['road', 'train', 'air', 'multimodal']);

  if (!pickupLocation) throw new ErrorResponse('relocationBooking.trip.pickupLocation is required', StatusCodes.BAD_REQUEST);
  if (!dropLocation) throw new ErrorResponse('relocationBooking.trip.dropLocation is required', StatusCodes.BAD_REQUEST);
  if (!/^\d{6}$/.test(pickupPostalCode)) throw new ErrorResponse('relocationBooking.trip.pickupPostalCode must be a valid 6-digit pincode', StatusCodes.BAD_REQUEST);
  if (!/^\d{6}$/.test(dropPostalCode)) throw new ErrorResponse('relocationBooking.trip.dropPostalCode must be a valid 6-digit pincode', StatusCodes.BAD_REQUEST);
  if (!pickupDateRaw) throw new ErrorResponse('relocationBooking.trip.pickupDate is required', StatusCodes.BAD_REQUEST);
  if (!allowedModes.has(travelMode)) throw new ErrorResponse('relocationBooking.trip.travelMode is invalid', StatusCodes.BAD_REQUEST);

  const pickupDate = new Date(pickupDateRaw);
  if (Number.isNaN(pickupDate.getTime())) {
    throw new ErrorResponse('relocationBooking.trip.pickupDate must be a valid date', StatusCodes.BAD_REQUEST);
  }
}

function validateInsuranceBookingPayload(insuranceBooking) {
  if (!insuranceBooking) return;
  if (typeof insuranceBooking !== 'object') {
    throw new ErrorResponse('insuranceBooking must be an object', StatusCodes.BAD_REQUEST);
  }
  const planCode = String(insuranceBooking.planCode || '').trim();
  const planName = String(insuranceBooking.planName || '').trim();
  if (!planCode && !planName) {
    throw new ErrorResponse('insuranceBooking.planCode or insuranceBooking.planName is required', StatusCodes.BAD_REQUEST);
  }
}

function populateCartQuery(base) {
  return base
    .populate({
      path: 'items.product',
      select: 'name sku description inventory status defaultMedia variants'
    })
    .populate({
      path: 'items.service',
      select: 'name slug shortDescription longDescription serviceType category pricing images isActive isVerified partner'
    })
    // Subscription holds the canonical booking payload for any service item.
    .populate({ path: 'items.subscription' })
    .populate('appliedCoupon.coupon', 'code name discountType discountValue');
}

class CartController {
  async getCart(req, res, next) {
    try {
      const userId = req.user.id;
      let cart = await getOrCreateCart(userId);

      cart.calculateTotals();
      await cart.save();

      cart = await populateCartQuery(Cart.findById(cart._id)).exec();

      return res.status(StatusCodes.OK).json({ success: true, data: cart });
    } catch (error) {
      next(error);
    }
  }

  async addToCart(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId, variantId, quantity } = req.body;

      if (!productId || !variantId || quantity === undefined || quantity === null) {
        throw new ErrorResponse('Product ID, variant ID, and quantity are required', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ErrorResponse('Invalid product ID', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(variantId) && !(typeof variantId === 'string' && /^[0-9a-fA-F]{24}$/.test(variantId))) {
        throw new ErrorResponse('Invalid variant ID', StatusCodes.BAD_REQUEST);
      }
      if (Number.isNaN(Number(quantity)) || Number(quantity) < 1) {
        throw new ErrorResponse('Quantity must be at least 1', StatusCodes.BAD_REQUEST);
      }

      // Normalize productId for database query
      const normalizedProductId = normalizeId(productId);
      const product = await Product.findById(normalizedProductId);
      if (!product) throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);

      const variant = pickVariant(product, variantId);
      if (!variant) throw new ErrorResponse('Variant ID is required for this product', StatusCodes.BAD_REQUEST);

      const { price, originalPrice, availableStock } = derivePricingAndStock(product, variant);
      if (availableStock < quantity) throw new ErrorResponse('Insufficient stock available', StatusCodes.BAD_REQUEST);

      let cart = await getOrCreateCart(userId);
      // Use the variant's _id for cart operations
      cart.addItem(normalizedProductId, variant._id, quantity, price, originalPrice);
      await cart.save();
      
      // Server-side CAPI AddToCart (best-effort, non-blocking)
      queueAddToCartCapiEvent({
        req,
        user: req.user,
        contentId: product?.sku || normalizedProductId,
        contentName: product?.name || 'Product',
        quantity,
        itemPrice: price,
        value: Number(price) * Number(quantity),
        currency: 'INR'
      });

      cart = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ success: true, message: 'Item added to cart successfully', data: cart });
    } catch (error) {
      next(error);
    }
  }

  async updateCartItem(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId, variantId, quantity } = req.body;

      if (!productId || !variantId || quantity === undefined || quantity === null) {
        throw new ErrorResponse('Product ID, variant ID, and quantity are required', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ErrorResponse('Invalid product ID', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(variantId) && !(typeof variantId === 'string' && /^[0-9a-fA-F]{24}$/.test(variantId))) {
        throw new ErrorResponse('Invalid variant ID', StatusCodes.BAD_REQUEST);
      }
      if (Number.isNaN(Number(quantity)) || Number(quantity) < 1) throw new ErrorResponse('Quantity must be at least 1', StatusCodes.BAD_REQUEST);

      // Normalize productId for database query
      const normalizedProductId = normalizeId(productId);
      const product = await Product.findById(normalizedProductId);
      if (!product) throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);

      const variant = pickVariant(product, variantId);
      if (!variant) throw new ErrorResponse('Variant not found for this product', StatusCodes.NOT_FOUND);

      const { price, originalPrice, availableStock } = derivePricingAndStock(product, variant);
      if (availableStock < quantity) throw new ErrorResponse('Insufficient stock available', StatusCodes.BAD_REQUEST);

      const cart = await getOrCreateCart(userId);
      // Update snapshot price as well to reflect current pricing when user updates quantity
      const item = cart.items.find(i => {
        const productMatch = idToString(i.product) === idToString(normalizedProductId);
        const variantMatch = idToString(i.variant) === idToString(variant._id);
        return productMatch && variantMatch;
      });
      if (!item) throw new ErrorResponse('Item not found in cart', StatusCodes.NOT_FOUND);
      item.price = price;
      item.originalPrice = originalPrice;
      item.discount = Math.max(0, originalPrice - price);
      cart.updateQuantity(normalizedProductId, variant._id, quantity);
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ success: true, message: 'Cart item updated successfully', data: populated });
    } catch (error) {
      next(error);
    }
  }

  async removeFromCart(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId, variantId } = req.body;
      if (!productId || !variantId) throw new ErrorResponse('Product ID and variant ID are required', StatusCodes.BAD_REQUEST);
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new ErrorResponse('Invalid product ID', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(variantId) && !(typeof variantId === 'string' && /^[0-9a-fA-F]{24}$/.test(variantId))) {
        throw new ErrorResponse('Invalid variant ID', StatusCodes.BAD_REQUEST);
      }

      // Normalize productId for database query
      const normalizedProductId = normalizeId(productId);
      
      // Get the product to find the variant and get its _id
      const product = await Product.findById(normalizedProductId);
      if (!product) throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);

      const variant = pickVariant(product, variantId);
      if (!variant) throw new ErrorResponse('Variant not found for this product', StatusCodes.NOT_FOUND);

      const cart = await getOrCreateCart(userId);
      cart.removeItem(normalizedProductId, variant._id);
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ success: true, message: 'Item removed from cart successfully', data: populated });
    } catch (error) {
      next(error);
    }
  }

  async clearCart(req, res, next) {
    try {
      const userId = req.user.id;
      const cart = await getOrCreateCart(userId);

      // Capture service subscriptions before wiping items so we can
      // cancel any pending bookings the user just abandoned.
      const subscriptionIds = (cart.items || [])
        .filter((it) => it && it.itemType === 'service' && it.subscription)
        .map((it) => it.subscription);

      cart.clearCart();
      await cart.save();

      await Promise.all(
        subscriptionIds.map((subId) => cancelPendingSubscription(subId, userId).catch(() => null))
      );

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ success: true, message: 'Cart cleared successfully', data: populated });
    } catch (error) {
      next(error);
    }
  }

  async applyCoupon(req, res, next) {
    try {
      const userId = req.user.id;
      const { couponCode } = req.body;

      console.log('couponCode', couponCode);
      console.log('userId', userId);
      
      if (!couponCode) throw new ErrorResponse('Coupon code is required', StatusCodes.BAD_REQUEST);

      const cart = await getOrCreateCart(userId);
      if (cart.items.length === 0) throw new ErrorResponse('Cart is empty', StatusCodes.BAD_REQUEST);

      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (!coupon) throw new ErrorResponse('Invalid coupon code', StatusCodes.NOT_FOUND);
      if (!coupon.isValid) throw new ErrorResponse('Coupon is expired or inactive', StatusCodes.BAD_REQUEST);
      if (!coupon.canUserUse(userId, cart.totalAmount)) throw new ErrorResponse('Coupon cannot be applied to this order', StatusCodes.BAD_REQUEST);

      const discountAmount = coupon.calculateDiscount(cart.totalAmount);
      console.log('discountAmount', discountAmount);
      cart.appliedCoupon = { coupon: coupon._id, discountAmount, code: coupon.code };
      cart.calculateTotals();
      await cart.save();

      const payload = {
        coupon: { code: coupon.code, name: coupon.name, discountAmount },
        cart: await populateCartQuery(Cart.findById(cart._id)).exec()
      };
      return res.status(StatusCodes.OK).json({ success: true, message: 'Coupon applied successfully', data: payload });
    } catch (error) {
      next(error);
    }
  }

  async removeCoupon(req, res, next) {
    try {
      const userId = req.user.id;
      const cart = await getOrCreateCart(userId);
      cart.appliedCoupon = {};
      cart.calculateTotals();
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ success: true, message: 'Coupon removed successfully', data: populated });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Persist checkout-page draft: delivery instructions and/or payment method.
   * Copied onto the Order when the client creates an order (if not overridden in that request).
   */
  async saveCheckoutPreferences(req, res, next) {
    try {
      const userId = req.user.id;
      const { deliveryInstructions, paymentMethod } = req.body;
      const cart = await getOrCreateCart(userId);

      if (!cart.checkoutPreferences) {
        cart.checkoutPreferences = {};
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'deliveryInstructions')) {
        if (deliveryInstructions === null || deliveryInstructions === undefined) {
          cart.checkoutPreferences.deliveryInstructions = '';
        } else {
          cart.checkoutPreferences.deliveryInstructions = String(deliveryInstructions).trim().slice(0, 2000);
        }
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'paymentMethod')) {
        if (paymentMethod === null || paymentMethod === undefined || paymentMethod === '') {
          cart.checkoutPreferences.paymentMethod = undefined;
        } else {
          const allowed = ['cod', 'online', 'wallet', 'upi'];
          if (!allowed.includes(paymentMethod)) {
            throw new ErrorResponse('paymentMethod must be one of: cod, online, wallet, upi', StatusCodes.BAD_REQUEST);
          }
          cart.checkoutPreferences.paymentMethod = paymentMethod;
        }
      }

      cart.markModified('checkoutPreferences');
      cart.lastActivity = new Date();
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Checkout preferences saved',
        data: populated
      });
    } catch (error) {
      next(error);
    }
  }

  async addServiceToCart(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        serviceId,
        quantity = 1,
        selectedExtras = [],
        selectedDate = null,
        notes = null,
        servicePackageCode = null,
        insuranceBooking = null,
        relocationBooking = null,
        nutritionBooking = null,
        communicatorBooking = null,
        trainingBooking = null,
        boardingBooking = null,
        petCakeBooking = null,
        // Dynamic pricing overrides (used by relocation quote flow; validated below)
        quotedPrice = null,
        quotedOriginalPrice = null
      } = req.body;

      if (!serviceId) {
        throw new ErrorResponse('Service ID is required', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(serviceId)) {
        throw new ErrorResponse('Invalid service ID', StatusCodes.BAD_REQUEST);
      }
      const normalizedQuantity = Number(quantity);
      if (Number.isNaN(normalizedQuantity) || normalizedQuantity < 1) {
        throw new ErrorResponse('Quantity must be at least 1', StatusCodes.BAD_REQUEST);
      }

      const normalizedServiceId = normalizeId(serviceId);
      const service = await Service.findById(normalizedServiceId);
      if (!service) {
        throw new ErrorResponse('Service not found', StatusCodes.NOT_FOUND);
      }
      if (!service.isActive) {
        throw new ErrorResponse('Service is not active', StatusCodes.BAD_REQUEST);
      }

      if (service.serviceType === 'relocation') {
        validateRelocationBookingPayload(relocationBooking);
      }
      validateInsuranceBookingPayload(insuranceBooking);

      const {
        price,
        originalPrice,
        servicePackageCode: normalizedPackageCode,
        servicePackageName
      } = resolveServicePricingForCart(service, {
        servicePackageCode,
        quotedPrice,
        quotedOriginalPrice
      });
      const petCakeCustomizationPrice = service.serviceType === 'pet-cake'
        ? resolvePetCakeCustomizationPrice(service, petCakeBooking || {})
        : 0;
      const effectivePrice = Number(price) + petCakeCustomizationPrice;
      const effectiveOriginalPrice = Number(originalPrice) + petCakeCustomizationPrice;

      let extrasTotal = 0;
      const validExtras = [];
      if (Array.isArray(selectedExtras) && selectedExtras.length > 0) {
        for (const extra of selectedExtras) {
          if (extra.code && service.extras) {
            const serviceExtra = service.extras.find(e => e.code === extra.code);
            if (serviceExtra) {
              validExtras.push({
                code: serviceExtra.code,
                name: serviceExtra.name || serviceExtra.code,
                price: Number(serviceExtra.price || 0)
              });
              extrasTotal += Number(serviceExtra.price || 0);
            }
          }
        }
      }

      let cart = await getOrCreateCart(userId);

      // Step 1: add (or merge) the cart line first so we know which item
      // the booking belongs to, and can reuse any pre-existing subscription.
      const targetItem = cart.addService({
        serviceId: normalizedServiceId,
        quantity: normalizedQuantity,
        price: effectivePrice,
        originalPrice: effectiveOriginalPrice,
        selectedExtras: validExtras,
        selectedDate,
        notes,
        servicePackageCode: normalizedPackageCode,
        servicePackageName
      });

      // Step 2: persist the booking payload onto the Subscription (single
      // source of truth). The cart item only ever keeps a reference.
      const bookingSnapshot = buildBookingSnapshotForSubscription({
        cartItem: targetItem,
        bookings: {
          relocationBooking,
          insuranceBooking,
          nutritionBooking,
          communicatorBooking,
          trainingBooking,
          boardingBooking,
          petCakeBooking
        },
        selectedExtras: validExtras,
        selectedDate,
        notes,
        servicePackageCode: normalizedPackageCode,
        servicePackageName,
        service
      });

      const subscriptionId = await upsertSubscriptionForServiceCartItem({
        userId,
        service,
        cartItem: bookingSnapshot,
        quantity: targetItem.quantity,
        amountPaid: computeCartItemAmountPaid(targetItem)
      });

      if (subscriptionId) {
        targetItem.subscription = subscriptionId;
      }

      // Strip any legacy inline booking fields that may still exist on
      // older cart items so they don't shadow the canonical Subscription.
      [
        'relocationBooking', 'insuranceBooking', 'nutritionBooking',
        'communicatorBooking', 'trainingBooking', 'boardingBooking', 'petCakeBooking'
      ].forEach((key) => {
        if (targetItem[key] !== undefined) targetItem[key] = undefined;
      });

      await cart.save();

      queueAddToCartCapiEvent({
        req,
        user: req.user,
        contentId: service?.slug || normalizedServiceId,
        contentName: service?.name || 'Service',
        quantity: normalizedQuantity,
        itemPrice: Number(effectivePrice) + Number(extrasTotal),
        value: (Number(effectivePrice) + Number(extrasTotal)) * normalizedQuantity,
        currency: 'INR'
      });

      cart = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Service added to cart successfully',
        data: cart
      });
    } catch (error) {
      next(error);
    }
  }

  async updateServiceInCart(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        cartItemId = null,
        serviceId,
        quantity,
        selectedExtras = [],
        selectedDate = null,
        notes = null,
        servicePackageCode = null,
        insuranceBooking = undefined,
        relocationBooking = undefined,
        nutritionBooking = undefined,
        communicatorBooking = undefined,
        trainingBooking = undefined,
        boardingBooking = undefined,
        petCakeBooking = undefined,
        quotedPrice = null,
        quotedOriginalPrice = null
      } = req.body;

      if (!serviceId) {
        throw new ErrorResponse('Service ID is required', StatusCodes.BAD_REQUEST);
      }
      if (!mongoose.Types.ObjectId.isValid(serviceId)) {
        throw new ErrorResponse('Invalid service ID', StatusCodes.BAD_REQUEST);
      }
      if (quantity !== undefined && (Number.isNaN(Number(quantity)) || Number(quantity) < 1)) {
        throw new ErrorResponse('Quantity must be at least 1', StatusCodes.BAD_REQUEST);
      }

      const normalizedServiceId = normalizeId(serviceId);
      const service = await Service.findById(normalizedServiceId);
      if (!service) {
        throw new ErrorResponse('Service not found', StatusCodes.NOT_FOUND);
      }

      if (service.serviceType === 'relocation' && relocationBooking !== undefined) {
        validateRelocationBookingPayload(relocationBooking);
      }
      if (insuranceBooking !== undefined) {
        validateInsuranceBookingPayload(insuranceBooking);
      }

      const {
        price,
        originalPrice,
        servicePackageCode: normalizedPackageCode,
        servicePackageName
      } = resolveServicePricingForCart(service, {
        servicePackageCode,
        quotedPrice,
        quotedOriginalPrice
      });

      const cart = await getOrCreateCart(userId);
      const item = cart.items.find(i => {
        if (cartItemId && String(i._id) !== String(cartItemId)) {
          return false;
        }
        if (!(i.itemType === 'service' && i.service && i.service.toString() === normalizedServiceId.toString())) {
          return false;
        }
        return normalizePackageCode(i.servicePackageCode) === normalizedPackageCode;
      });

      if (!item) {
        throw new ErrorResponse('Service not found in cart', StatusCodes.NOT_FOUND);
      }

      // Update quantity if provided
      if (quantity !== undefined) {
        if (cartItemId) {
          item.quantity = Number(quantity);
        } else {
          cart.updateServiceQuantity(normalizedServiceId, quantity, normalizedPackageCode);
        }
      }

      // For pet-cake, the price changes based on the chosen ingredients /
      // customizations, which now live on the Subscription. If a new
      // petCakeBooking is provided, use it; otherwise pull the existing one
      // from the subscription so re-quantity updates don't lose the surcharge.
      let resolvedPetCakeBooking = petCakeBooking;
      if (service.serviceType === 'pet-cake' && resolvedPetCakeBooking === undefined && item.subscription) {
        const linkedSub = await Subscription.findById(item.subscription).select('petCakeBooking').lean();
        if (linkedSub?.petCakeBooking) resolvedPetCakeBooking = linkedSub.petCakeBooking;
      }
      const petCakeCustomizationPrice = service.serviceType === 'pet-cake'
        ? resolvePetCakeCustomizationPrice(service, resolvedPetCakeBooking || {})
        : 0;
      const effectivePrice = Number(price) + petCakeCustomizationPrice;
      const effectiveOriginalPrice = Number(originalPrice) + petCakeCustomizationPrice;

      item.price = effectivePrice;
      item.originalPrice = effectiveOriginalPrice;
      item.discount = Math.max(0, effectiveOriginalPrice - effectivePrice);
      item.servicePackageCode = normalizedPackageCode;
      item.servicePackageName = servicePackageName;

      // Update extras if provided
      if (Array.isArray(selectedExtras) && selectedExtras.length >= 0) {
        let validExtras = [];
        if (selectedExtras.length > 0) {
          for (const extra of selectedExtras) {
            if (extra.code && service.extras) {
              const serviceExtra = service.extras.find(e => e.code === extra.code);
              if (serviceExtra) {
                validExtras.push({
                  code: serviceExtra.code,
                  name: serviceExtra.name || serviceExtra.code,
                  price: Number(serviceExtra.price || 0)
                });
              }
            }
          }
        }
        item.selectedExtras = validExtras;
      }

      // Update selected date if provided
      if (selectedDate !== undefined) {
        item.selectedDate = selectedDate ? new Date(selectedDate) : null;
      }

      // Update notes if provided
      if (notes !== undefined) {
        item.notes = notes;
      }

      // Build the booking snapshot ONLY from fields explicitly provided in
      // this request — the helper merges these into the existing
      // Subscription, so omitted fields stay untouched.
      const providedBookings = {};
      if (insuranceBooking !== undefined) providedBookings.insuranceBooking = insuranceBooking;
      if (relocationBooking !== undefined) providedBookings.relocationBooking = relocationBooking;
      if (nutritionBooking !== undefined) providedBookings.nutritionBooking = nutritionBooking;
      if (communicatorBooking !== undefined) providedBookings.communicatorBooking = communicatorBooking;
      if (trainingBooking !== undefined) providedBookings.trainingBooking = trainingBooking;
      if (boardingBooking !== undefined) providedBookings.boardingBooking = boardingBooking;
      if (petCakeBooking !== undefined) providedBookings.petCakeBooking = petCakeBooking;

      const bookingSnapshot = buildBookingSnapshotForSubscription({
        cartItem: item,
        bookings: providedBookings,
        selectedExtras: item.selectedExtras,
        selectedDate: item.selectedDate,
        notes: item.notes,
        servicePackageCode: normalizedPackageCode,
        servicePackageName,
        service
      });

      const subscriptionId = await upsertSubscriptionForServiceCartItem({
        userId,
        service,
        cartItem: bookingSnapshot,
        quantity: item.quantity,
        amountPaid: computeCartItemAmountPaid(item)
      });
      if (subscriptionId) item.subscription = subscriptionId;

      // Strip any legacy inline booking fields from the cart item.
      [
        'relocationBooking', 'insuranceBooking', 'nutritionBooking',
        'communicatorBooking', 'trainingBooking', 'boardingBooking', 'petCakeBooking'
      ].forEach((key) => {
        if (item[key] !== undefined) item[key] = undefined;
      });

      cart.calculateTotals();
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({ 
        success: true, 
        message: 'Service updated in cart successfully', 
        data: populated 
      });
    } catch (error) {
      next(error);
    }
  }
  async removeServiceFromCart(req, res, next) {
    try {
      const userId = req.user.id;
      const { serviceId, servicePackageCode = null, cartItemId = null } = req.body;

      if (!serviceId && !cartItemId) {
        throw new ErrorResponse('Service ID is required', StatusCodes.BAD_REQUEST);
      }
      if (serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) {
        throw new ErrorResponse('Invalid service ID', StatusCodes.BAD_REQUEST);
      }

      const cart = await getOrCreateCart(userId);
      const removedSubscriptionIds = [];

      if (cartItemId) {
        cart.items = cart.items.filter(i => {
          if (String(i._id) === String(cartItemId)) {
            if (i.subscription) removedSubscriptionIds.push(i.subscription);
            return false;
          }
          return true;
        });
        cart.calculateTotals();
        cart.lastActivity = new Date();
      } else {
        const normalizedServiceId = normalizeId(serviceId);
        const normalizedPackageCode = normalizePackageCode(servicePackageCode);
        const service = await Service.findById(normalizedServiceId).select('serviceType');
        if (!service) {
          throw new ErrorResponse('Service not found', StatusCodes.NOT_FOUND);
        }
        if (service.serviceType === 'training' && !normalizedPackageCode) {
          throw new ErrorResponse('servicePackageCode is required for training services', StatusCodes.BAD_REQUEST);
        }
        const removedItems = cart.removeService(normalizedServiceId, normalizedPackageCode) || [];
        for (const removed of removedItems) {
          if (removed?.subscription) removedSubscriptionIds.push(removed.subscription);
        }
      }
      await cart.save();

      // Best-effort: cancel pending subscriptions linked to removed cart
      // items so we don't leak draft bookings. We never touch paid or
      // already-cancelled subscriptions.
      await Promise.all(
        removedSubscriptionIds.map((subId) => cancelPendingSubscription(subId, userId).catch(() => null))
      );

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Service removed from cart successfully',
        data: populated
      });
    } catch (error) {
      next(error);
    }
  }
  async mergeCart(req, res, next) {
    try {
      const userId = req.user.id;
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        const cart = await getOrCreateCart(userId);
        const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
        return res.status(StatusCodes.OK).json({ success: true, data: populated, merged: 0 });
      }

      // Validate input — collect only well-formed items; skip the rest silently
      const validItems = [];
      for (const item of items) {
        const { productId, variantId, quantity } = item || {};
        if (!productId || !variantId || !quantity) continue;
        if (!mongoose.Types.ObjectId.isValid(productId)) continue;
        if (!mongoose.Types.ObjectId.isValid(variantId)) continue;
        const qty = Number(quantity);
        if (Number.isNaN(qty) || qty < 1) continue;
        validItems.push({ productId: String(productId), variantId: String(variantId), quantity: qty });
      }

      if (validItems.length === 0) {
        const cart = await getOrCreateCart(userId);
        const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
        return res.status(StatusCodes.OK).json({ success: true, data: populated, merged: 0 });
      }

      // Single DB read for all products — no N+1
      const uniqueProductIds = [...new Set(validItems.map(i => i.productId))];
      const products = await Product.find(
        { _id: { $in: uniqueProductIds }, 'status.isActive': true },
        { variants: 1 }
      ).lean();
      const productMap = new Map(products.map(p => [p._id.toString(), p]));

      let cart = await getOrCreateCart(userId);
      let mergedCount = 0;

      for (const { productId, variantId, quantity } of validItems) {
        const product = productMap.get(productId);
        if (!product) continue;

        const variant = product.variants?.find(v =>
          v._id?.toString() === variantId || v.variantId?.toString() === variantId
        );
        if (!variant) continue;

        const stock = Number(variant?.stock?.quantity ?? 0);
        if (stock < 1) continue;

        const price = Number(variant?.price?.listPrice) || 0;
        const originalPrice = Number(variant?.price?.mrp) || price;
        const mergeQty = Math.min(quantity, stock);

        cart.addItem(
          new mongoose.Types.ObjectId(productId),
          new mongoose.Types.ObjectId(variantId),
          mergeQty,
          price,
          originalPrice
        );
        mergedCount++;
      }

      // Single DB write
      await cart.save();

      const populated = await populateCartQuery(Cart.findById(cart._id)).exec();
      return res.status(StatusCodes.OK).json({
        success: true,
        message: `${mergedCount} item(s) merged into cart`,
        data: populated,
        merged: mergedCount
      });
    } catch (error) {
      next(error);
    }
  }

  async getDashboardCarts(req, res, next) {
    try {
      const {
        status,
        page = 1,
        limit = 20,
        q
      } = req.query;
  
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;
  
      const query = {};
      const allowedStatuses = ['active', 'abandoned', 'converted'];
  
      if (status && allowedStatuses.includes(status)) {
        query.status = status;
      }
  
      if (q && String(q).trim()) {
        const regex = new RegExp(String(q).trim(), 'i');
        const users = await User.find(
          { $or: [{ name: regex }, { email: regex }, { phoneNumber: regex }] },
          { _id: 1 }
        ).lean();
  
        const userIds = users.map(u => u._id);
        query.user = { $in: userIds.length ? userIds : [null] };
      }
  
      // Get carts with minimal population first
      let cartsQuery = Cart.find(query)
      .sort({ lastActivity: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('user', 'name email phoneNumber role')
      .populate('appliedCoupon', 'code discountType discountValue discountAmount')
      .populate({
        path: 'items.product',
        select: 'name sku description status defaultMedia variants',
        match: { 'status.isActive': true }
      })
      .populate({
        path: 'items.service',
        select: 'name slug shortDescription longDescription serviceType category pricing images isActive isVerified partner',
        match: { isActive: true }
      });
  
      const [total, carts] = await Promise.all([
        Cart.countDocuments(query),
        cartsQuery.lean()
      ]);
  
      // Process each cart to optimize product/variant data
      const optimizedCarts = await Promise.all(
        carts.map(async (cart) => {
          // Process each item to get only selected variant
          const optimizedItems = await Promise.all(
            cart.items.map(async (item) => {
              if (item.itemType !== 'product') {
                return item; // Keep non-product items as-is
              }
  
              // Get only the selected variant from the product
              const selectedVariant = item.product.variants?.find(
                variant => variant._id.toString() === item.variant?.toString()
              );
  
              // Create optimized product object WITHOUT all variants
              const optimizedProduct = {
                _id: item.product._id,
                sku: item.product.sku,
                name: item.product.name,
                description: {
                  short: item.product.description?.short
                },
                status: {
                  isActive: item.product.status?.isActive,
                  inventory: item.product.status?.inventory
                }
              };
  
              // Create optimized variant object with ONLY the selected variant data
              const optimizedVariant = selectedVariant ? {
                _id: selectedVariant._id,
                variantId: selectedVariant.variantId,
                sku: selectedVariant.sku,
                name: selectedVariant.name,
                attributes: selectedVariant.attributes,
                price: {
                  listPrice: selectedVariant.price?.listPrice,
                  mrp: selectedVariant.price?.mrp,
                  discounted: selectedVariant.price?.discounted
                },
                media: {
                  images: selectedVariant.media?.images?.slice(0, 2) // Limit to 2 images
                },
                stock: {
                  quantity: selectedVariant.stock?.quantity,
                  lowStockThreshold: selectedVariant.stock?.lowStockThreshold
                }
              } : null;
  
              return {
                ...item,
                product: optimizedProduct,
                variant: optimizedVariant,
                // Remove the original populated product object to avoid confusion
                __v: undefined
              };
            })
          );
  
          // Remove the old items array and replace with optimized version
          return {
            ...cart,
            items: optimizedItems,
            // Remove unnecessary fields
            __v: undefined
          };
        })
      );
  
      return res.status(200).json({
        success: true,
        data: optimizedCarts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CartController();