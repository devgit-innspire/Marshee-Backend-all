const mongoose = require('mongoose');

const collectedContactSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    default: null
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  source: {
    type: String,
    enum: ['airtag-landing-page', 'email-verification', 'registration', 'checkout', 'newsletter', 'manual'],
    default: 'airtag-landing-page'
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

collectedContactSchema.index(
  { phoneNumber: 1 },
  { name: 'collected_contact_phone_unique', unique: true }
);

collectedContactSchema.index({ email: 1 }, { sparse: true });
collectedContactSchema.index({ subscribedToMarketing: 1 });
collectedContactSchema.index({ user: 1 }, { sparse: true });

module.exports = mongoose.models.CollectedContact || mongoose.model('CollectedContact', collectedContactSchema);
