const mongoose = require('mongoose');
const crypto = require('crypto');

const variantSchema = new mongoose.Schema({
  variantId: { type: String, required: true },
  sku: { type: String },
  name: { type: String, required: true },
  
  // Plain object in MongoDB (e.g. { size: "M", color: "Blue" }).
  // Map + embedded subdocs often serializes as {} in API JSON; Mixed preserves BSON as-is.
  attributes: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  
  price: {
    listPrice: { type: Number },
    mrp: { type: Number },
    discounted: { type: Number },
    costPrice: { type: Number }
  },
  
  commission: {
    percentage: { type: Number },
    value: { type: Number }
  },
  
  stock: {
    quantity: { type: Number, default: 0 },
    reserved: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 }
  },


  // media: {
  //   images: [{
  //     url: { type: String },
  //     alt: { type: String },
  //     isPrimary: { type: Boolean, default: false }
  //   }],
  //   video: { type: String }
  // },

  media: {
  images: [{ type: String }], 
  video: { type: String }
},
  
  dimensions: {
    weight: { type: Number }, // grams
    length: { type: Number }, // cm
    width: { type: Number },  // cm
    height: { type: Number }  // cm
  }
}, {
  timestamps: true
});

// Helper to generate a short random suffix
function genSuffix(bytes = 3) {
  return crypto.randomBytes(bytes).toString('hex').toUpperCase(); // 6 chars by default
}

// Ensure SKU is present; generate a unique SKU if missing
variantSchema.pre('save', async function(next) {
  try {
    if (!this.sku) {
      const base = (this.variantId || 'VAR')
        .toString()
        .replace(/\s+/g, '')
        .toUpperCase();

      let candidate;
      let exists = true;
      let attempts = 0;

      // Try a few times to avoid collision
      while (exists && attempts < 5) {
        candidate = `${base}-${genSuffix()}`;
        const conflict = await this.constructor.findOne({ sku: candidate });
        exists = !!conflict;
        attempts += 1;
      }

      // Fallback: timestamp-based if collisions persist
      if (exists) {
        candidate = `${base}-${Date.now().toString(36).toUpperCase()}`;
      }

      this.sku = candidate;
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Indexes
variantSchema.index({ variantId: 1 });


module.exports = {
  variantSchema,
  Variant: mongoose.model('Variant', variantSchema)
};
