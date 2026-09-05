const mongoose = require('mongoose');

const superCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String },
  description: { type: String },
  displayOrder: { type: Number, default: 0 }, // For custom ordering
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Example of super categories would be:
// - Dogs
// - Cats
// - Birds
// - Fish

module.exports = mongoose.model('SuperCategory', superCategorySchema);
