const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  otp: {
    type: String,
    required: [true, 'OTP is required'],
    length: [6, 'OTP must be 6 digits']
  },
  purpose: {
    type: String,
    enum: ['login', 'registration', 'password-reset', 'email-verification'],
    default: 'login'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // Auto-delete expired documents
  },
  attempts: {
    type: Number,
    default: 0,
    max: [5, 'Maximum OTP verification attempts exceeded']
  },
  // Store registration data temporarily (for registration OTP)
  registrationData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

// Index for faster lookups
otpSchema.index({ email: 1, purpose: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if OTP is valid
otpSchema.methods.isValid = function() {
  return !this.isVerified && this.expiresAt > new Date() && this.attempts < 5;
};

// Method to increment attempts
otpSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

// Method to mark as verified
otpSchema.methods.markAsVerified = function() {
  this.isVerified = true;
  return this.save();
};

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);

