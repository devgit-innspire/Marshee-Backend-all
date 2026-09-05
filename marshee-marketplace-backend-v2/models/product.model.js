const mongoose = require('mongoose');
const { variantSchema } = require('./variant.model');

const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  sku: { type: String, unique: true }, // SKU Code
  gtin: { type: String },
  hsnCode: { type: String}, // HSN Code

  name: { type: String }, // Product Name
  slug: { type: String },
  description: { 
    full: { type: String },
    short: { type: String }
  },

  ingredients: { type: String }, // Ingredients list

  manufacturingDetails: {
    manufacturer: { type: String }, // Manufacturer / Packer / Importer
    countryOfOrigin: { type: String },
    gstin: { type: String }, // GSTIN of manufacturer
    dispatch: {
      city: { type: String }, // City of Dispatch
      state: { type: String }, // Statea
      pinCode: { type: String }, // Pin Code of Dispatch
    },
    license_numbers: {
    fssai: { type: String } // from CSV
  },
  },

  category: {
    superCategory: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'SuperCategory',
      required: true
    }],
    serviceCategory: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'ServiceCategory',
      required: true 
    },
    subCategory: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'SubCategory',
      required: true 
    }
  },

  brand: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Brand',
    required: true 
  },

  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
  },

  // pricing: {
  //   basePrice: { type: Number },
  //   currency: { type: String, default: 'INR' },
  //   tax: {
  //     rate: { type: Number },
  //     inclusive: { type: Boolean, default: true }
  //   },
  //   discount: {
  //     type: { type: String, enum: ['percentage', 'fixed'] },
  //     value: { type: Number },
  //     startDate: { type: Date },
  //     endDate: { type: Date }
  //   }
  // },

  inventory: {
    sku: { type: String },
    gtin: { type: String },
    managementType: { type: String, enum: ['variant', 'product'], default: 'variant' },
    aggregatedStock: {
      total: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 }
    }
  },

  petDetails: {
    targetPet: { type: String }, // e.g., "Dog", "Cat"

    productType: { 
    type: String, 
    enum: ['Regular', 'Vegan', 'Vegetarian', 'Prescription', 'Veterinary', 'Organic', "Supplement"],
    default: 'Regular'
  },
    
    // Age Range Suitability
    ageSuitability: {
      min: { type: Number }, // Minimum age in months
      max: { type: Number }, // Maximum age in months
      lifeStages: [{ 
        type: String, 
        enum: ['Puppy', 'Junior', 'Adult', 'Mature', 'Senior', 'Geriatric', 'All Ages'] 
      }]
    },
    
    // Weight Range Suitability
    weightSuitability: {
      min: { type: Number }, // Minimum weight in kg
      max: { type: Number }, // Maximum weight in kg
      breedSizes: [{ 
        type: String, 
        enum: ['Mini', 'Small', 'Medium', 'Large', 'Giant', 'All Sizes'] 
      }]
    },

    // Breed Specific
    breeds: [{
      name: { type: String },
      isSpeciallyFormulated: { type: Boolean, default: false }
    }],
    
    // Health Conditions & Special Needs
    healthConditions: [{
      condition: { type: String },
      severity: { 
        type: String, 
        enum: ['Mild', 'Moderate', 'Severe', 'All'] 
      },
      isSpeciallyFormulated: { type: Boolean, default: false },
      veterinaryApproved: { type: Boolean, default: false }
    }],

    // Diet Specifications
    dietaryInfo: {
      type: { 
        type: String, 
        enum: ['Regular', 'Prescription', 'Veterinary'] 
      },
      features: [{
        type: String,
        enum: [
          'Grain Free',
          'Gluten Free',
          'Limited Ingredient',
          'Natural',
          'Organic',
          'Raw',
          'Human Grade'
        ]
      }],
      preferences: [{
        type: String,
        enum: [
          'High Protein',
          'Low Fat',
          'Low Calorie',
          'High Fiber',
          'Limited Ingredient'
        ]
      }]
    },

    // Health Benefits & Nutritional Focus
    healthBenefits: [{
      benefit: { type: String },
      primaryIngredients: [{ type: String }],
      effectiveness: { 
        type: String, 
        enum: ['Supportive', 'Targeted', 'Therapeutic'] 
      }
    }]
  },

  defaultMedia: {
    thumbnail: { 
      url: { type: String },
      alt: { type: String }
    },
    featuredImage: { 
      url: { type: String },
      alt: { type: String }
    }
  },

  variants: [variantSchema],

  attributes: {
    type: Map,
    of: [{
      name: { type: String },
      values: [{ type: String }]
    }]
  }, // e.g., { "size": ["small", "medium", "large"], "flavor": ["chicken", "beef"] }

  status: {
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    approval: {
      status: { type: String, enum: ['draft', 'pending', 'approved', 'rejected'], default: 'draft' },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: { type: String }
    },
    inventory: { type: String, enum: ['in_stock', 'low_stock', 'out_of_stock'], default: 'out_of_stock' }
  },

  seo: {
    title: { type: String },
    metaDescription: { type: String },
    keywords: [{ type: String }],
    canonical: { type: String },
    robots: { type: String, default: 'index,follow' }
  },
    dimensions: {
    weight_g: { type: Number }, 
    length_cm: { type: Number }, 
    width_cm: { type: Number },
    height_cm: { type: Number }, 
  },

    // Enhanced safety information
// In product.model.js

safety: {
  allergens: { type: String },
  age_restrictions: { type: String },
  weight_restrictions: { type: String },
  health_warnings: { type: String }
},

nutrition: {
  protein_percent: { type: Number },
  fat_percent: { type: Number },
  fiber_percent: { type: Number },
  moisture_percent: { type: Number },
  calories_per_100g: { type: Number }
},

business_data: {
  popularity_score: { type: Number },
  avg_rating: { type: Number },
  total_reviews: { type: Number },
  margin_percent: { type: Number },
  is_premium: { type: Boolean, default: false }
},

  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    }
  },

  tags: [{ type: String }],

  ai: {
    embedding: {
      type: [Number],
      default: undefined,
      select: false,
    },
    embeddingModel: { type: String, default: null },
    embeddingUpdatedAt: { type: Date, default: null },
    embeddingSourceHash: { type: String, default: null },
  },

  metadata: {
    type: String // Additional metadata
  },

  recommendations: {
    related: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    crossSell: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    upSell: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Persist aggregatedStock as a cached sum of variant stocks.
// NOTE: authoritative stock is still per-variant; this is only for quick filtering/search/analytics.
productSchema.pre('save', function(next) {
  try {
    const variants = Array.isArray(this.variants) ? this.variants : [];

    const total = variants.reduce((sum, v) => sum + (Number(v?.stock?.quantity) || 0), 0);
    const reserved = variants.reduce((sum, v) => sum + (Number(v?.stock?.reserved) || 0), 0);

    this.inventory = this.inventory || {};
    this.inventory.aggregatedStock = this.inventory.aggregatedStock || {};
    this.inventory.aggregatedStock.total = total;
    this.inventory.aggregatedStock.reserved = reserved;

    next();
  } catch (e) {
    next(e);
  }
});

// Plugins removed (no pagination)

// Indexes for better query performance
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ 'inventory.sku': 1 }, { unique: true });
productSchema.index({ 'category.superCategory': 1 });
productSchema.index({ 'category.serviceCategory': 1 });
productSchema.index({ 'category.subCategory': 1 });
productSchema.index({ brand: 1 });
productSchema.index({ 'status.isActive': 1 });
productSchema.index({ 'status.isFeatured': 1 });
productSchema.index({ createdAt: -1 });

// Compound indexes for common query patterns
productSchema.index({ 'status.isActive': 1, 'status.approval.status': 1 });
productSchema.index({ 'petDetails.targetPet': 1, 'status.isActive': 1 });
productSchema.index({ brand: 1, 'status.isActive': 1 });
productSchema.index({ 'category.subCategory': 1, 'status.isActive': 1, 'business_data.popularity_score': -1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ 'status.inventory': 1, 'status.isActive': 1 });

// Text search index for name, description, and tags
productSchema.index({ name: 'text', 'description.full': 'text', tags: 'text' });

// Virtual for calculating the current stock status
productSchema.virtual('currentStockStatus').get(function() {
  // Stock is tracked per-variant. This virtual is a summary signal, not a sum.
  const variants = Array.isArray(this.variants) ? this.variants : [];
  if (variants.length === 0) return 'out_of_stock';

  const maxQty = variants.reduce((m, v) => {
    const qty = Number(v?.stock?.quantity ?? 0);
    return qty > m ? qty : m;
  }, 0);

  if (maxQty <= 0) return 'out_of_stock';

  const anyAboveThreshold = variants.some(v => {
    const qty = Number(v?.stock?.quantity ?? 0);
    const th = Number(v?.stock?.lowStockThreshold ?? 5);
    return qty > th;
  });

  return anyAboveThreshold ? 'in_stock' : 'low_stock';
});

module.exports = mongoose.model('Product', productSchema);
