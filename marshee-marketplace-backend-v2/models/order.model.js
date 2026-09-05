const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
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
  // Product snapshot fields to ensure immutability after purchase
  sku: { type: String },
  name: { type: String },
  image: { type: String },
  attributes: { type: Object },
  hsn: { type: String },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant'
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  },
  // Service-specific fields
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
  serviceNotes: String,
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
  },
  originalPrice: {
    type: Number
  },
  discount: {
    type: Number,
    default: 0
  },
  totalPrice: {
    type: Number,
  },
  // Item-level tax & weight for shipping calculations
  taxRate: { type: Number }, // e.g., GST rate in percentage
  taxAmount: { type: Number },
  weightGrams: { type: Number },
  dimensions: {
    lengthCm: { type: Number },
    widthCm: { type: Number },
    heightCm: { type: Number }
  },
  commission: {
    percentage: { type: Number },
    amount: { type: Number }
  },
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    // Partner may be optional for products not tied to a partner
    required: false
  },
  // Per-item fulfillment and post-purchase lifecycle
  fulfillment: {
    status: { type: String, enum: ['pending', 'allocated', 'packed', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'], default: 'pending' },
    warehouse: { type: String },
    shippedQuantity: { type: Number, default: 0 },
    deliveredQuantity: { type: Number, default: 0 },
    trackingNumber: { type: String },
    carrier: { type: String },
    shippedAt: { type: Date },
    deliveredAt: { type: Date }
  },
  cancellation: {
    isCancelled: { type: Boolean, default: false },
    reason: { type: String },
    cancelledAt: { type: Date }
  },
  returnInfo: {
    isReturnRequested: { type: Boolean, default: false },
    reason: { type: String },
    requestedAt: { type: Date },
    approvedAt: { type: Date },
    receivedAt: { type: Date },
    restockFee: { type: Number, default: 0 }
  },
  refund: {
    amount: { type: Number, default: 0 },
    reason: { type: String },
    refundedAt: { type: Date },
    transactionId: { type: String }
  }
}, {
  timestamps: true
});

// Set itemType before validation (for backward compatibility)
orderItemSchema.pre('validate', function(next) {
  if (!this.itemType) {
    this.itemType = this.service ? 'service' : 'product';
  }
  next();
});

// Calculate total price for order item
orderItemSchema.pre('save', function(next) {
  // Ensure itemType is set
  if (!this.itemType) {
    this.itemType = this.service ? 'service' : 'product';
  }
  
  // Calculate extras total for services
  const extrasTotal = this.selectedExtras ? this.selectedExtras.reduce((sum, extra) => sum + (extra.price || 0), 0) : 0;
  
  // For products: totalPrice = (price - discount) * quantity
  // For services: totalPrice = (price - discount + extrasTotal) * quantity
  // price is originalPrice (MRP), discount is the discount amount
  if (this.itemType === 'service') {
    this.totalPrice = ((this.price - this.discount) + extrasTotal) * this.quantity;
  } else {
    this.totalPrice = (this.price - this.discount) * this.quantity;
  }
  next();
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  
  // Order Summary
  currency: { type: String, default: 'INR' },
  exchangeRateToBase: { type: Number, default: 1 },
  pricePrecision: { type: Number, default: 2 },
  subtotal: {
    type: Number,
    required: true
  },
  totalDiscount: {
    type: Number,
    default: 0
  },
  fees: {
    handlingFee: { type: Number, default: 0 },
    packagingFee: { type: Number, default: 0 },
    giftWrapFee: { type: Number, default: 0 },
    codFee: { type: Number, default: 0 }
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  taxAmount: {
    type: Number,
    default: 0
  },
  taxBreakdown: {
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 }
  },
  totalAmount: {
    type: Number,
    required: true
  },
  grandTotal: { type: Number }, // alias for totalAmount + any rounding
  roundingAdjustment: { type: Number, default: 0 },
  
  // Applied Coupon
  appliedCoupon: {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon'
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    code: String
  },
  
  // Address References
  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  
  billingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  // Address snapshots to preserve exact details at purchase time
  shippingAddressSnapshot: {
    fullName: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'IN' },
    landmark: String,
    geo: { lat: Number, lng: Number }
  },
  billingAddressSnapshot: {
    fullName: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'IN' },
    gstNumber: String
  },
  contact: {
    email: String,
    phone: String
  },
  deliveryPreferences: {
    timeSlot: String,
    instructions: String,
    contactless: { type: Boolean, default: false }
  },
  
  // Payment Information
  payment: {
    method: {
      type: String,
      enum: ['cod', 'online', 'wallet', 'upi'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: String,
    merchantOrderId: String, // Internal merchant order ID
    gateway: String,
    paidAt: Date,
    failedAt: Date, // Set when a gateway reports a terminal failure (e.g. payment.failed webhook)
    failureReason: String, // Gateway-supplied reason for the failure
    // Recorded when a gateway reports an amount that does not match the order total.
    // The order is NOT confirmed in that case - it is held here for manual review.
    amountMismatch: {
      expectedPaise: Number,
      receivedPaise: Number,
      detectedAt: Date,
      event: String
    },
    // Razorpay Payment Link specific fields
    paymentLinkId: String, // Payment Link ID (plink_xxx)
    checkoutPageUrl: String, // Direct payment URL
    callbackUrl: String, // Callback URL after payment
    successUrl: String, // Success redirect URL
    failureUrl: String, // Failure redirect URL
    keyId: String, // Razorpay Key ID
    currency: { type: String, default: 'INR' },
    amount: Number, // Payment amount
    gatewayTransactionId: String, // Final payment transaction ID from gateway
    // Callback verification tracking (for Razorpay callback endpoint)
    callbackVerification: {
      verified: { type: Boolean, default: false }, // Whether callback verification was attempted
      status: { 
        type: String, 
        enum: ['pending', 'success', 'failed', 'invalid_signature', 'order_not_found'],
        default: 'pending'
      },
      verifiedAt: Date, // Timestamp when callback verification was completed
      razorpayPaymentId: String, // Payment ID from callback
      razorpayOrderId: String, // Order ID from callback
      signatureValid: Boolean, // Whether signature verification passed
      paymentStatus: String, // Payment status from Razorpay API ('captured', 'authorized', 'failed', etc.)
      error: String, // Error message if verification failed
    }
  },
  paymentAttempts: [{
    method: { type: String, enum: ['cod', 'online', 'wallet', 'upi'] },
    gateway: String,
    transactionId: String,
    status: { type: String, enum: ['pending', 'completed', 'failed'] },
    errorCode: String,
    errorMessage: String,
    attemptedAt: { type: Date, default: Date.now }
  }],
  
  // Order Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'rto', 'returned'],
    default: 'pending'
  },
  statusHistory: [{
    status: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'rto', 'returned'] },
    note: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now }
  }],
  
  // Shipping Information
  shipping: {
    method: { type: String, required: true },
    trackingNumber: String,
    carrier: String,
    estimatedDelivery: Date,
    shippedAt: Date,
    deliveredAt: Date,
    // Shiprocket integration fields
    shiprocket: {
      shipmentId: { type: Number }, // Shiprocket shipment ID (first/primary, backward compat)
      orderId: { type: Number }, // Shiprocket order ID (first/primary, backward compat)
      awbCode: { type: String }, // Airway Bill Number (first/primary)
      channelId: { type: String }, // Shiprocket channel ID
      status: { type: String }, // Shiprocket shipment status
      statusCode: { type: Number }, // Shiprocket status code
      courierName: { type: String }, // Courier company name
      courierId: { type: Number }, // Courier ID
      labelUrl: { type: String }, // Shipping label URL
      manifestUrl: { type: String }, // Manifest URL
      invoiceUrl: { type: String }, // Invoice URL
      rtoAwb: { type: String }, // RTO AWB if returned
      createdAt: { type: Date }, // When shipment was created in Shiprocket
      updatedAt: { type: Date }, // Last update from Shiprocket
      totalShippingCharge: { type: Number }, // Sum of all fulfillment shippingCharge (for partner billing)
      // One fulfillment per partner; each partner's shipping cost is stored in shippingCharge
      fulfillments: [{
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
        partnerGstin: { type: String },
        orderId: { type: Number },
        shipmentId: { type: Number },
        pickup_location: { type: String },
        awbCode: { type: String },
        courierId: { type: Number },
        courierName: { type: String },
        shippingCharge: { type: Number, default: 0 }, // Per-partner courier cost for this shipment (saved when AWB assigned; for partner billing)
        labelUrl: { type: String },
        status: { type: String },
        statusCode: { type: Number },
        manifestUrl: { type: String },
        invoiceUrl: { type: String },
        trackingUrl: { type: String },
        updatedAt: { type: Date }
      }],
      creationErrors: [{
        type: { type: String }, // e.g. 'no_partner', 'no_pickup_location', 'api_error'
        message: { type: String },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
        itemCount: { type: Number },
        at: { type: Date, default: Date.now }
      }]
    }
  },
  shipments: [{
    items: [{
      orderItemId: { type: mongoose.Schema.Types.ObjectId },
      quantity: { type: Number }
    }],
    trackingNumber: String,
    carrier: String,
    method: String,
    shippedAt: Date,
    deliveredAt: Date,
    notes: String,
    // Shiprocket integration fields
    shiprocket: {
      shipmentId: { type: Number },
      orderId: { type: Number },
      awbCode: { type: String },
      status: { type: String },
      courierName: { type: String },
      labelUrl: { type: String },
      trackingUrl: { type: String }
    }
  }],
  
  // Commission & Partner Payments
  partnerPayments: [{
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true
    },
    amount: { type: Number, required: true },
    commission: { type: Number },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending'
    },
    paidAt: Date
  }],
  
  // Order Notes
  notes: {
    customer: String,
    internal: String
  },
  gift: {
    isGift: { type: Boolean, default: false },
    message: String,
    from: String,
    to: String
  },
  loyalty: {
    pointsUsed: { type: Number, default: 0 },
    pointsEarned: { type: Number, default: 0 }
  },
  invoice: {
    number: String,
    url: String,
    issuedAt: Date,
    gstNumber: String
  },
  attribution: {
    channel: { type: String }, // e.g., web, android, ios
    source: { type: String },
    campaign: { type: String },
    affiliateId: { type: String }
  },
  clientInfo: {
    ip: String,
    userAgent: String,
    deviceId: String
  },
  risk: {
    score: { type: Number, default: 0 },
    flags: [{ type: String }],
    reviewRequired: { type: Boolean, default: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date }
  },
  metadata: { type: Object },

  // Inventory / fulfillment bookkeeping
  inventory: {
    stockDeducted: { type: Boolean, default: false },
    stockDeductedAt: { type: Date }
  },
  
  // Timestamps
  confirmedAt: Date,
  processedAt: Date,
  cancelledAt: Date,
  refundedAt: Date
}, {
  timestamps: true
});

// Indexes
orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'payment.transactionId': 1 }); // For Razorpay payment link/order lookup
orderSchema.index({ 'payment.merchantOrderId': 1 }); // For merchant order ID lookup
orderSchema.index({ createdAt: -1 });
// Note: orderNumber index is automatically created by unique: true in schema definition
orderSchema.index({ 'items.product': 1 });
orderSchema.index({ 'shipping.trackingNumber': 1 }, { sparse: true });
orderSchema.index({ 'partnerPayments.partner': 1 });
orderSchema.index({ user: 1, createdAt: -1 });

// Generate order number before validation so required check passes
orderSchema.pre('validate', function(next) {
  if (!this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.orderNumber = `ORD${year}${month}${day}${random}`;
  }
  next();
});

// Method to calculate order totals
orderSchema.methods.calculateTotals = function() {
  let subtotal = 0;
  let totalDiscount = 0;
  
  this.items.forEach(item => {
    subtotal += item.originalPrice * item.quantity;
    totalDiscount += item.discount * item.quantity;
  });
  
  this.subtotal = subtotal;
  this.totalDiscount = totalDiscount;
  
  // Apply coupon discount
  if (this.appliedCoupon.coupon) {
    this.totalDiscount += this.appliedCoupon.discountAmount;
  }
  
  // Calculate tax (fallback to 18% GST if no item-level tax present)
  // const taxableBase = subtotal - this.totalDiscount;
  // const itemTaxTotal = this.items.reduce((acc, item) => acc + (item.taxAmount || 0), 0);
  // this.taxAmount = itemTaxTotal || (taxableBase * 0.18);
  
  // Derive basic total before fees
  const baseTotal = taxableBase + this.shippingCost;
  const feesTotal = (this.fees?.handlingFee || 0) + (this.fees?.packagingFee || 0) + (this.fees?.giftWrapFee || 0) + (this.fees?.codFee || 0);
  this.totalAmount = baseTotal + feesTotal + (this.roundingAdjustment || 0);
  this.grandTotal = this.totalAmount;
  
  return {
    subtotal: this.subtotal,
    totalDiscount: this.totalDiscount,
    shippingCost: this.shippingCost,
    taxAmount: this.taxAmount,
    totalAmount: this.totalAmount,
    fees: this.fees,
    grandTotal: this.grandTotal
  };
};

// Method to update order status
orderSchema.methods.updateStatus = function(newStatus, { note, by } = {}) {
  // Status updates can come from multiple sources (user actions, payment webhooks, Shiprocket tracking webhooks).
  // Keep `statusHistory` as the source of truth for timeline/audit.
  this.status = newStatus;
  this.shipping = this.shipping || {};
  
  switch (newStatus) {
    case 'confirmed':
      this.confirmedAt = new Date();
      break;
    case 'processing':
      this.processedAt = new Date();
      break;
    case 'shipped':
      this.shipping.shippedAt = new Date();
      break;
    case 'out_for_delivery':
      // Ensure shipment timestamp exists even if Shiprocket webhook order differs from our expected sequence.
      if (!this.shipping.shippedAt) this.shipping.shippedAt = new Date();
      break;
    case 'delivered':
      this.shipping.deliveredAt = new Date();
      break;
    case 'rto':
      // RTO starts after shipment; keep shippedAt if not already set.
      if (!this.shipping.shippedAt) this.shipping.shippedAt = new Date();
      break;
    case 'returned':
      // Treat RTO delivered as "delivered" for shipping timeline.
      if (!this.shipping.deliveredAt) this.shipping.deliveredAt = new Date();
      break;
    case 'cancelled':
      this.cancelledAt = new Date();
      break;
    case 'refunded':
      this.refundedAt = new Date();
      break;
  }
  this.statusHistory.push({ status: newStatus, note, by, at: new Date() });
};

// Method to calculate partner payments
orderSchema.methods.calculatePartnerPayments = function() {
  const partnerMap = new Map();
  
  this.items.forEach(item => {
    // Skip items that don't have a partner assigned
    if (!item.partner) {
      return;
    }
    const partnerId = item.partner.toString();
    
    if (!partnerMap.has(partnerId)) {
      partnerMap.set(partnerId, {
        partner: item.partner,
        amount: 0,
        commission: 0
      });
    }
    
    const partnerData = partnerMap.get(partnerId);
    partnerData.amount += item.totalPrice;
    partnerData.commission += item.commission.amount;
  });
  
  this.partnerPayments = Array.from(partnerMap.values()).map(data => ({
    partner: data.partner,
    amount: data.amount,
    commission: data.commission,
    status: 'pending'
  }));
};

// Ensure address snapshots are present before save, if references populated
orderSchema.pre('save', function(next) {
  // Initialize shipping.shiprocket if it doesn't exist
  if (!this.shipping) {
    this.shipping = {};
  }
  if (!this.shipping.shiprocket) {
    this.shipping.shiprocket = {};
  }

  if (!this.shippingAddressSnapshot && this.populated && this.populated('shippingAddress')) {
    const addr = this.shippingAddress;
    this.shippingAddressSnapshot = {
      fullName: addr?.fullName,
      phone: addr?.phone,
      line1: addr?.line1,
      line2: addr?.line2,
      city: addr?.city,
      state: addr?.state,
      postalCode: addr?.postalCode,
      country: addr?.country,
      landmark: addr?.landmark,
      geo: addr?.geo
    };
  }
  if (!this.billingAddressSnapshot && this.populated && this.populated('billingAddress')) {
    const addr = this.billingAddress;
    this.billingAddressSnapshot = {
      fullName: addr?.fullName,
      phone: addr?.phone,
      line1: addr?.line1,
      line2: addr?.line2,
      city: addr?.city,
      state: addr?.state,
      postalCode: addr?.postalCode,
      country: addr?.country,
      gstNumber: addr?.gstNumber
    };
  }
  next();
});

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);