const mongoose = require('mongoose');

const subCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String },
  description: { type: String },
  serviceCategory: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ServiceCategory', 
    required: true 
  },
  icon: { type: String }, // For storing icon/image URL
  displayOrder: { type: Number, default: 0 }, // For custom ordering
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Example of sub categories:
// Under "Dog Food":
// - Dry Dog Food
// - Wet Dog Food
// - Dog Treats
// - Prescription Dog Food

// Under "Cat Food":
// - Dry Cat Food
// - Wet Cat Food
// - Cat Treats
// - Prescription Cat Food

module.exports = mongoose.model('SubCategory', subCategorySchema);
