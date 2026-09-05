const mongoose = require('mongoose');

// Base schema for common category fields
const categoryBase = {
  name: { type: String, required: true },
  slug: { type: String },
  displayOrder: { type: Number, default: 0 },
  status: {
    isActive: { type: Boolean, default: true }
  }
};

// Super Category (e.g., Dogs, Cats)
const superCategorySchema = new mongoose.Schema({
  ...categoryBase,
  description: { type: String }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Service Category (e.g., Dog Food, Cat Food)
const serviceCategorySchema = new mongoose.Schema({
  ...categoryBase,
  description: { type: String },
  superCategory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SuperCategory',
    required: true
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Sub Category (e.g., Dry Dog Food, Wet Cat Food)
const subCategorySchema = new mongoose.Schema({
  ...categoryBase,
  description: { type: String },
  icon: { type: String }, // Icon only on subcategories
  serviceCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceCategory',
    required: true
  },
  commission: {
    percentage: { type: Number, default: 0 }  // Category-specific commission
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
superCategorySchema.index({ slug: 1 });
serviceCategorySchema.index({ slug: 1 });
serviceCategorySchema.index({ superCategory: 1 });
subCategorySchema.index({ slug: 1 });
subCategorySchema.index({ serviceCategory: 1 });

// Virtual for full category path
subCategorySchema.virtual('fullPath').get(async function() {
  const serviceCategory = await mongoose.model('ServiceCategory').findById(this.serviceCategory);
  const superCategory = await mongoose.model('SuperCategory').findById(serviceCategory.superCategory[0]);
  return `${superCategory.name} > ${serviceCategory.name} > ${this.name}`;
});

const SuperCategory = require('./superCategory.model');
const ServiceCategory = require('./serviceCategory.model');
const SubCategory = require('./subCategory.model');

module.exports = {
  SuperCategory,
  ServiceCategory,
  SubCategory
};