const mongoose = require('mongoose');

const popularSearchSchema = new mongoose.Schema(
  {
    /** Dedupe key: trimmed, lowercased, single spaces */
    normalizedQuery: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    /** Latest user-typed form for display */
    displayQuery: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    searchCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastSearchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

popularSearchSchema.index({ normalizedQuery: 1 }, { unique: true });
popularSearchSchema.index({ searchCount: -1, lastSearchedAt: -1 });

module.exports = mongoose.model('PopularSearch', popularSearchSchema);
