const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: { type: String, trim: true },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    title: { type: String, trim: true, maxlength: 120 },
    text: { type: String, trim: true, maxlength: 2000 },

    media: {
      images: [{ type: String }],
      videos: [{ type: String }]
    }
  },
  { timestamps: true }
);

// Ensure one review per user per product
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);

