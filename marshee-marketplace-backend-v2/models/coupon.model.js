const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true 
  },
  name: { type: String, required: true },
  description: { type: String },
  
  // Discount Types
  discountType: { 
    type: String, 
    enum: ['percentage', 'fixed', 'free_shipping'],
    required: true 
  },
  discountValue: { 
    type: Number, 
    required: true 
  },
  
  // Usage Limits
  maxUsage: { type: Number, default: null }, // null = unlimited
  usedCount: { type: Number, default: 0 },
  maxUsagePerUser: { type: Number, default: 1 },
  
  // Validity
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  
  // Minimum Requirements
  minimumOrderAmount: { type: Number, default: 0 },
  maximumDiscountAmount: { type: Number, default: null },
  
  // Applicability
  applicableCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubCategory'
  }],
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  applicableBrands: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand'
  }],
  
  // User Restrictions
  userRestrictions: {
    newUsersOnly: { type: Boolean, default: false },
    existingUsersOnly: { type: Boolean, default: false },
    specificUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Status
  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true }, // Show on website
  
  // Tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Analytics
  totalDiscountGiven: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },

  // Auto-delete flag for short-lived coupons (landing page etc.)
  autoExpire: { type: Boolean, default: false },

  // Set by pre-save hook when autoExpire=true; drives the TTL index
  expireAt: { type: Date, default: undefined }
}, {
  timestamps: true
});

// Indexes
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ isActive: 1, isPublic: 1 });

// TTL index: auto-delete coupons where autoExpire=true, 2 months after validUntil.
// Coupon becomes unusable immediately after validUntil (isValid check),
// but the record is kept for 2 months for analytics/history before cleanup.
couponSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0, sparse: true });

couponSchema.pre('save', function(next) {
  if (this.autoExpire && this.validUntil) {
    const twoMonthsMs = 60 * 24 * 60 * 60 * 1000;
    this.expireAt = new Date(this.validUntil.getTime() + twoMonthsMs);
  } else {
    this.expireAt = undefined;
  }
  next();
});

// Virtual for checking if coupon is valid
couponSchema.virtual('isValid').get(function() {
  const now = new Date();
  return this.isActive && 
         now >= this.validFrom && 
         now <= this.validUntil && 
         (this.maxUsage === null || this.usedCount < this.maxUsage);
});

// Method to check if user can use coupon
couponSchema.methods.canUserUse = function(userId, orderAmount) {
  if (!this.isValid) return false;
  if (orderAmount < this.minimumOrderAmount) return false;
  return true;
};

// Method to calculate discount
couponSchema.methods.calculateDiscount = function(orderAmount) {
  let discount = 0;
  
  switch (this.discountType) {
    case 'percentage':
      discount = (orderAmount * this.discountValue) / 100;
      if (this.maximumDiscountAmount) {
        discount = Math.min(discount, this.maximumDiscountAmount);
      }
      break;
    case 'fixed':
      discount = this.discountValue;
      break;
    case 'free_shipping':
      discount = 0; // Will be handled separately
      break;
  }
  
  return Math.min(discount, orderAmount);
};

// Method to increment usage count and analytics
couponSchema.methods.recordUsage = async function(discountAmount) {
  this.usedCount = (this.usedCount || 0) + 1;
  this.totalOrders = (this.totalOrders || 0) + 1;
  this.totalDiscountGiven = (this.totalDiscountGiven || 0) + (discountAmount || 0);
  await this.save();
  return this;
};

// Static method to increment usage (for atomic updates)
couponSchema.statics.incrementUsage = async function(couponId, discountAmount) {
  return await this.findByIdAndUpdate(
    couponId,
    {
      $inc: {
        usedCount: 1,
        totalOrders: 1,
        totalDiscountGiven: discountAmount || 0
      }
    },
    { new: true }
  );
};

module.exports = mongoose.model('Coupon', couponSchema);
