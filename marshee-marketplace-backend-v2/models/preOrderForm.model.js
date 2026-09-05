const mongoose = require('mongoose');

// Base pre-order contact form (landing page lead)
const contactSchema = new mongoose.Schema({
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
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'resolved', 'archived'],
    default: 'new'
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  addedBy: {
    type: String,
    trim: true
  },
  interestedInAlphaTesting: {
    type: Boolean,
    default: false
  },
  // Coupon information
  coupon: {
    code: {
      type: String,
      trim: true,
      uppercase: true
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon'
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    originalAmount: {
      type: Number,
      min: 0
    },
    finalAmount: {
      type: Number,
      min: 0
    }
  },
  // Email tracking
  emailSent: {
    confirmationSent: {
      type: Boolean,
      default: false
    },
    confirmationSentAt: {
      type: Date
    }
  },
  // Pet information (optional)
  pet: {
    photo: {
      type: String,
      trim: true
    },
    name: {
      type: String,
      trim: true
    },
    breed: {
      type: String,
      trim: true
    },
    birthdate: {
      type: Date
    },
    bloodGroup: {
      type: String,
      trim: true,
      uppercase: true
    },
    gender: {
      type: String,
      enum: ['Male', 'Female'],
      trim: true
    },
    weight: {
      type: Number,
      min: [0, 'Weight cannot be negative']
      // Weight in kg
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
contactSchema.index({ email: 1, createdAt: -1 });
contactSchema.index({ status: 1, createdAt: -1 });
contactSchema.index({ createdAt: -1 });

// Model for the landing-page pre-order form
const PreOrder = mongoose.models.PreOrder || mongoose.model('PreOrder', contactSchema);

// Lightweight payment order linked to a PreOrder (for landing page payments)
const preOrderPaymentSchema = new mongoose.Schema({
  preOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PreOrder',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'INR'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  payment: {
    merchantOrderId: {
      type: String,
      required: true
    },
    gateway: {
      type: String,
      default: 'phonepe'
    },
    transactionId: String, // Razorpay order_id or payment link ID
    paymentLinkId: String, // Payment Link ID (plink_xxx) for Razorpay
    keyId: String, // Razorpay Key ID
    currency: { type: String, default: 'INR' },
    amount: Number, // Payment amount
    gatewayTransactionId: String, // Final payment transaction ID from gateway
    checkoutUrl: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,
    completedAt: Date,
    failedAt: Date,
    failureReason: String, // Gateway-supplied reason for the failure
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
      responseType: { 
        type: String, 
        enum: ['json', 'redirect'],
        default: 'redirect'
      } // Whether callback returned JSON or redirect
    }
  },
  // Basic snapshot of lead details for convenience
  leadSnapshot: {
    name: String,
    email: String,
    phone: String
  }
}, {
  timestamps: true
});

preOrderPaymentSchema.index({ preOrder: 1, createdAt: -1 });
preOrderPaymentSchema.index({ 'payment.merchantOrderId': 1 }, { unique: true });

const PreOrderPayment = mongoose.models.PreOrderPayment || mongoose.model('PreOrderPayment', preOrderPaymentSchema);

module.exports = {
  PreOrder,
  PreOrderPayment
};
