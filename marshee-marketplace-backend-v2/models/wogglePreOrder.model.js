const mongoose = require('mongoose');

// Woggle Cat Collar Pre-Order Schema with embedded payment details
const wogglePreOrderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email address'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Remove non-digits and check if it's 10 digits
        const digitsOnly = v.replace(/\D/g, '');
        return /^\d{10}$/.test(digitsOnly);
      },
      message: 'Phone number must be exactly 10 digits'
    }
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    default: 1,
    min: [0, 'Amount cannot be negative']
  },
  status: {
    type: String,
    enum: ['new', 'payment_pending', 'payment_completed', 'cancelled', 'fulfilled'],
    default: 'new'
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  // Payment details embedded in the pre-order
  payment: {
    merchantOrderId: {
      type: String,
      unique: true,
      sparse: true
    },
    gateway: {
      type: String,
      default: 'razorpay'
    },
    transactionId: String, // Razorpay order_id
    paymentLinkId: String, // Payment Link ID (plink_xxx) for Razorpay
    keyId: String, // Razorpay Key ID
    currency: { 
      type: String, 
      default: 'INR' 
    },
    amount: Number, // Payment amount
    gatewayTransactionId: String, // Final payment transaction ID from gateway
    checkoutUrl: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,
    completedAt: Date,
    failedAt: Date,
    // Callback verification tracking (for Razorpay callback endpoint)
    callbackVerification: {
      verified: { type: Boolean, default: false },
      status: { 
        type: String, 
        enum: ['pending', 'success', 'failed', 'invalid_signature', 'order_not_found'],
        default: 'pending'
      },
      verifiedAt: Date,
      razorpayPaymentId: String,
      razorpayOrderId: String,
      signatureValid: Boolean,
      paymentStatus: String,
      error: String,
      responseType: { 
        type: String, 
        enum: ['json', 'redirect'],
        default: 'redirect'
      }
    }
  },
  // Payment status
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
wogglePreOrderSchema.index({ email: 1, createdAt: -1 });
wogglePreOrderSchema.index({ phone: 1, createdAt: -1 });
wogglePreOrderSchema.index({ status: 1, createdAt: -1 });
wogglePreOrderSchema.index({ paymentStatus: 1, createdAt: -1 });
wogglePreOrderSchema.index({ 'payment.merchantOrderId': 1 }, { unique: true, sparse: true });
wogglePreOrderSchema.index({ 'payment.transactionId': 1 }, { sparse: true });
wogglePreOrderSchema.index({ createdAt: -1 });

// Model for Woggle pre-orders
const WogglePreOrder = mongoose.models.WogglePreOrder || mongoose.model('WogglePreOrder', wogglePreOrderSchema);

module.exports = WogglePreOrder;
