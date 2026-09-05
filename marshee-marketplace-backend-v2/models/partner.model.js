const mongoose = require('mongoose');

const partnerSchema = new mongoose.Schema({
  /** Link to User (partner login account). Set when admin approves; one-to-one. */
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },

  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },

  contact: {
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pinCode: { type: String, required: true },
      country: { type: String, required: true }
    }
  },

  legal: {
    gstin: { type: String, required: true, unique: true },
    panNumber: { type: String, required: true },
    cinNumber: { type: String, unique: true, sparse: true }, // Corporate Identification Number (optional, unique if provided)
    businessType: { type: String}, // Manufacturer/Distributor/Retailer
    registrationNumber: { type: String }
  },

  banking: {
    accountHolder: { type: String, required: true },
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true },
    bankName: { type: String, required: true },
    branch: { type: String, required: true }
  },

  commission: {
    defaultPercentage: { type: Number, required: true },
    categorySpecific: [{
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      percentage: { type: Number }
    }]
  },

  status: {
    isActive: { type: Boolean, default: true },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verificationNotes: { type: String },
    rejectionReason: { type: String },
    verifiedAt: { type: Date },
    rejectedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    documents: [{
      type: { type: String },
      url: { type: String },
      verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'] }
    }]
  },

  // Shiprocket settings per partner (stored in our DB)
  shiprocket: {
    pickupLocations: [{
      pickup_location: { type: String, required: true },
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      address: { type: String, required: true },
      address_2: { type: String, default: '' },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
      pin_code: { type: String, required: true },
      shiprocketResponse: { type: mongoose.Schema.Types.Mixed },
      createdAt: { type: Date, default: Date.now }
    }]
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
partnerSchema.index({ 'legal.cinNumber': 1 }, { unique: true, sparse: true });
partnerSchema.index({ user: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Partner', partnerSchema);
