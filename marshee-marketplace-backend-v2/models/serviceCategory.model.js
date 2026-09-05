const mongoose = require('mongoose');

const serviceCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String },
  description: { type: String },
  superCategory: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'SuperCategory', 
    required: true 
  }],
  icon: { type: String },
  displayOrder: { type: Number, default: 0 }, // For custom ordering
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Example of service categories:
// Under "Dogs":
// - Dog Food
// - Dog Accessories
// - Dog Health & Wellness
// - Dog Grooming

// Under "Cats":
// - Cat Food
// - Cat Accessories
// - Cat Health & Wellness
// - Cat Grooming

module.exports = mongoose.model('ServiceCategory', serviceCategorySchema);
