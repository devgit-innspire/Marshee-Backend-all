const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  addressType: {
    type: String,
    enum: ['home', 'office', 'other'],
    default: 'home',
    required: true
  },
  billingAddress: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
    location: {
      lat: Number,
      lng: Number
    }
  },
  shippingAddress: {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
    location: {
      lat: Number,
      lng: Number
    }
  },
    isDefaultShipping: {
    type: Boolean,
    default: false
  },
  isDefaultBilling: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: { type: Date }
}, {
  timestamps: true
});

// Indexes for common queries and uniqueness of defaults per user
addressSchema.index({ user: 1, createdAt: -1 });
addressSchema.index({ user: 1, isDefaultShipping: 1 }, { partialFilterExpression: { isDefaultShipping: true, isDeleted: false } });
addressSchema.index({ user: 1, isDefaultBilling: 1 }, { partialFilterExpression: { isDefaultBilling: true, isDeleted: false } });

module.exports = mongoose.model('Address', addressSchema);
