const mongoose = require('mongoose');

/**
 * Cart item schema.
 *
 * Service items only carry NEUTRAL commerce snapshots (price, qty,
 * package code/name, extras, scheduled date, notes) and a reference to
 * a `Subscription` document. ALL service-type-specific booking payloads
 * (training, boarding, relocation, pet-cake, nutrition, communicator,
 * insurance, ...) live on the Subscription, never on the cart item.
 *
 * NOTE: The legacy `*Booking` Mixed fields below are intentionally kept
 * for backward compatibility with any in-flight cart documents written
 * by older code. New writes from the cart controller MUST go through
 * the Subscription instead. These fields will be removed once a data
 * migration backfills outstanding pending carts.
 */
const cartItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['product', 'service'],
    default: function() {
      return this.service ? 'service' : 'product';
    },
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant'
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  // Subscription is the source of truth for service booking details.
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  originalPrice: {
    type: Number
  },
  discount: {
    type: Number,
    default: 0
  },

  // Neutral service snapshots safe to keep on the cart item itself.
  selectedExtras: [{
    code: String,
    name: String,
    price: Number
  }],
  servicePackageCode: {
    type: String,
    trim: true,
    lowercase: true
  },
  servicePackageName: {
    type: String,
    trim: true
  },
  selectedDate: Date,
  notes: String,

  // ---------------------------------------------------------------
  // DEPRECATED: per-service-type booking payloads on cart items.
  // Kept as Mixed to avoid losing data on legacy cart documents.
  // New code persists these on the linked Subscription instead.
  // ---------------------------------------------------------------
  relocationBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  nutritionBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  communicatorBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  trainingBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  boardingBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  petCakeBooking: { type: mongoose.Schema.Types.Mixed, default: undefined },
  insuranceBooking: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, {
  timestamps: true
});

cartItemSchema.pre('validate', function(next) {
  if (!this.itemType) {
    this.itemType = this.service ? 'service' : 'product';
  }
  next();
});

cartItemSchema.pre('save', function(next) {
  if (!this.itemType) {
    this.itemType = this.service ? 'service' : 'product';
  }
  next();
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [cartItemSchema],

  // Cart Summary
  subtotal: { type: Number, default: 0 },
  totalDiscount: { type: Number, default: 0 },
  shippingCost: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },

  // Applied Coupon
  appliedCoupon: {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon'
    },
    discountAmount: { type: Number, default: 0 },
    code: String
  },

  // Cart Status
  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted'],
    default: 'active'
  },

  // Last Activity
  lastActivity: { type: Date, default: Date.now },

  /** Draft checkout fields from the checkout page (copied to Order on place order). */
  checkoutPreferences: {
    deliveryInstructions: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000
    },
    paymentMethod: {
      type: String,
      enum: ['cod', 'online', 'wallet', 'upi']
    }
  }
}, {
  timestamps: true
});

cartSchema.index({ user: 1 }, { unique: true });
cartSchema.index({ status: 1 });
cartSchema.index({ lastActivity: 1 });

cartSchema.methods.calculateTotals = function() {
  let subtotal = 0;
  let totalDiscount = 0;

  this.items.forEach(item => {
    const extrasTotal = item.selectedExtras
      ? item.selectedExtras.reduce((sum, extra) => sum + (extra.price || 0), 0)
      : 0;
    const itemSubtotal = (item.originalPrice + extrasTotal) * item.quantity;
    subtotal += itemSubtotal;
    totalDiscount += item.discount * item.quantity;
  });

  this.subtotal = subtotal;
  this.totalDiscount = totalDiscount;

  if (this.appliedCoupon.coupon) {
    this.totalDiscount += this.appliedCoupon.discountAmount;
  }

  this.totalAmount = subtotal - this.totalDiscount + this.shippingCost;

  return {
    subtotal: this.subtotal,
    totalDiscount: this.totalDiscount,
    shippingCost: this.shippingCost,
    totalAmount: this.totalAmount
  };
};

cartSchema.methods.addItem = function(productId, variantId, quantity, price, originalPrice) {
  const existingItem = this.items.find(item => {
    const productMatch = item.product && item.product.toString() === productId.toString();
    const variantMatch = item.variant && item.variant.toString() === variantId.toString();
    return productMatch && variantMatch;
  });

  const discount = Math.max(0, originalPrice - price);

  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.price = price;
    existingItem.originalPrice = originalPrice;
    existingItem.discount = discount;
  } else {
    this.items.push({
      itemType: 'product',
      product: productId,
      variant: variantId,
      quantity,
      price,
      originalPrice,
      discount
    });
  }

  this.calculateTotals();
  this.lastActivity = new Date();
};

/**
 * Add a service line to the cart. Caller is responsible for upserting the
 * Subscription (booking source of truth) BEFORE invoking this method, then
 * passing its id via `subscription`.
 *
 * @param {Object} args
 * @param {ObjectId} args.serviceId
 * @param {Number}   args.quantity
 * @param {Number}   args.price                effective per-unit price (incl. customizations)
 * @param {Number}   args.originalPrice        effective per-unit MRP
 * @param {Array}    [args.selectedExtras=[]]
 * @param {Date}     [args.selectedDate=null]
 * @param {String}   [args.notes=null]
 * @param {String}   [args.servicePackageCode=null]
 * @param {String}   [args.servicePackageName=null]
 * @param {ObjectId} [args.subscription=null]
 * @param {Boolean}  [args.allowMerge=true]    merge with existing item that matches service+package
 */
cartSchema.methods.addService = function({
  serviceId,
  quantity,
  price,
  originalPrice,
  selectedExtras = [],
  selectedDate = null,
  notes = null,
  servicePackageCode = null,
  servicePackageName = null,
  subscription = null,
  allowMerge = true
}) {
  const normalizedPackageCode = servicePackageCode
    ? String(servicePackageCode).trim().toLowerCase()
    : null;

  const existingItem = allowMerge
    ? this.items.find(item => {
        if (!(item.itemType === 'service' && item.service && item.service.toString() === serviceId.toString())) {
          return false;
        }
        const itemPackageCode = item.servicePackageCode
          ? String(item.servicePackageCode).trim().toLowerCase()
          : null;
        return itemPackageCode === normalizedPackageCode;
      })
    : null;

  const discount = Math.max(0, originalPrice - price);

  let target;
  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.price = price;
    existingItem.originalPrice = originalPrice;
    existingItem.discount = discount;
    existingItem.selectedExtras = selectedExtras;
    existingItem.servicePackageCode = normalizedPackageCode;
    existingItem.servicePackageName = servicePackageName || null;
    if (selectedDate) existingItem.selectedDate = selectedDate;
    if (notes) existingItem.notes = notes;
    if (subscription) existingItem.subscription = subscription;
    target = existingItem;
  } else {
    this.items.push({
      itemType: 'service',
      service: serviceId,
      quantity,
      price,
      originalPrice,
      discount,
      selectedExtras,
      servicePackageCode: normalizedPackageCode,
      servicePackageName: servicePackageName || null,
      selectedDate,
      notes,
      subscription: subscription || undefined
    });
    target = this.items[this.items.length - 1];
  }

  this.calculateTotals();
  this.lastActivity = new Date();

  return target;
};

cartSchema.methods.removeItem = function(productId, variantId) {
  this.items = this.items.filter(item => {
    if (item.itemType === 'product') {
      const productMatch = item.product && item.product.toString() === productId.toString();
      const variantMatch = item.variant && item.variant.toString() === variantId.toString();
      return !(productMatch && variantMatch);
    }
    return true;
  });

  this.calculateTotals();
  this.lastActivity = new Date();
};

/**
 * Remove all service items matching (serviceId, servicePackageCode).
 * Returns the removed items so the caller can clean up linked subscriptions.
 */
cartSchema.methods.removeService = function(serviceId, servicePackageCode = null) {
  const normalizedPackageCode = servicePackageCode
    ? String(servicePackageCode).trim().toLowerCase()
    : null;

  const removed = [];
  this.items = this.items.filter(item => {
    if (item.itemType !== 'service') return true;
    if (!(item.service && item.service.toString() === serviceId.toString())) return true;
    const itemPackageCode = item.servicePackageCode
      ? String(item.servicePackageCode).trim().toLowerCase()
      : null;
    if (itemPackageCode !== normalizedPackageCode) return true;

    removed.push(item);
    return false;
  });

  this.calculateTotals();
  this.lastActivity = new Date();

  return removed;
};

cartSchema.methods.updateQuantity = function(productId, variantId, quantity) {
  const item = this.items.find(item => {
    if (item.itemType === 'product') {
      const productMatch = item.product && item.product.toString() === productId.toString();
      const variantMatch = item.variant && item.variant.toString() === variantId.toString();
      return productMatch && variantMatch;
    }
    return false;
  });

  if (item) {
    item.quantity = quantity;
    this.calculateTotals();
    this.lastActivity = new Date();
  }
};

cartSchema.methods.updateServiceQuantity = function(serviceId, quantity, servicePackageCode = null) {
  const normalizedPackageCode = servicePackageCode
    ? String(servicePackageCode).trim().toLowerCase()
    : null;
  const item = this.items.find(item => {
    if (!(item.itemType === 'service' && item.service && item.service.toString() === serviceId.toString())) {
      return false;
    }
    const itemPackageCode = item.servicePackageCode
      ? String(item.servicePackageCode).trim().toLowerCase()
      : null;
    return itemPackageCode === normalizedPackageCode;
  });

  if (item) {
    item.quantity = quantity;
    this.calculateTotals();
    this.lastActivity = new Date();
  }
};

cartSchema.methods.clearCart = function() {
  this.items = [];
  this.appliedCoupon = {};
  this.checkoutPreferences = undefined;
  this.calculateTotals();
  this.lastActivity = new Date();
};

module.exports = mongoose.model('Cart', cartSchema);
