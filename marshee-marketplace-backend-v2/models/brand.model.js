const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String },
  description: { type: String },
  logo: { type: String }, // URL to brand logo
  bannerImage: { type: String }, // URL to brand banner image
  partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null }, // Partner who owns/manages this brand

  socialMedia: {
    facebook: { type: String },
    instagram: { type: String },
    twitter: { type: String }
  },

  status: {
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false }
  },

  seo: {
    title: { type: String },
    metaDescription: { type: String },
    keywords: [{ type: String }]
  },
  description: {
  type: String
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create indexes
brandSchema.index({ slug: 1 }, { unique: true });
brandSchema.index({ partner: 1 }); // Index for partner queries

module.exports = mongoose.model('Brand', brandSchema);
