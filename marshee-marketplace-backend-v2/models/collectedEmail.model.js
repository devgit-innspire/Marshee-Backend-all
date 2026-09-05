const mongoose = require('mongoose');

const collectedEmailSchema = new mongoose.Schema({
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
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  source: {
    type: String,
    enum: ['email-verification', 'registration', 'checkout', 'newsletter', 'manual'],
    default: 'email-verification'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  subscribedToMarketing: {
    type: Boolean,
    default: true
  },
  unsubscribedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

collectedEmailSchema.index(
  { email: 1 },
  { name: 'collected_email_unique', unique: true }
);

collectedEmailSchema.index({ subscribedToMarketing: 1 });
collectedEmailSchema.index({ user: 1 }, { sparse: true });

module.exports = mongoose.models.CollectedEmail || mongoose.model('CollectedEmail', collectedEmailSchema);
