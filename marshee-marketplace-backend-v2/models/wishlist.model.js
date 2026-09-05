const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant'
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: 500
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  }
}, {
  timestamps: true
});

const wishlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    default: 'My Wishlist'
  },
  description: {
    type: String,
    maxlength: 1000
  },
  items: [wishlistItemSchema],
  
  // Wishlist Settings
  isPublic: {
    type: Boolean,
    default: false
  },
  allowGifts: {
    type: Boolean,
    default: true
  },
  
  // Sharing
  shareToken: {
    type: String,
    unique: true,
    sparse: true
  },
  sharedWith: [{
    email: String,
    accessLevel: {
      type: String,
      enum: ['view', 'edit'],
      default: 'view'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Analytics
  totalItems: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
wishlistSchema.index({ user: 1 });
wishlistSchema.index({ isPublic: 1 });

// Virtual for total items count
wishlistSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

// Method to add item to wishlist
wishlistSchema.methods.addItem = function(productId, variantId, notes, priority) {
  // Check if item already exists
  const existingItem = this.items.find(item => 
    item.product.toString() === productId.toString() && 
    item.variant?.toString() === variantId?.toString()
  );
  
  if (existingItem) {
    // Update existing item
    existingItem.notes = notes || existingItem.notes;
    existingItem.priority = priority || existingItem.priority;
    existingItem.addedAt = new Date();
  } else {
    // Add new item
    this.items.push({
      product: productId,
      variant: variantId,
      notes,
      priority: priority || 'medium'
    });
  }
  
  this.totalItems = this.items.length;
  this.lastUpdated = new Date();
};

// Method to remove item from wishlist
wishlistSchema.methods.removeItem = function(productId, variantId) {
  this.items = this.items.filter(item => 
    !(item.product.toString() === productId.toString() && 
      item.variant?.toString() === variantId?.toString())
  );
  
  this.totalItems = this.items.length;
  this.lastUpdated = new Date();
};

// Method to move item to cart (remove from wishlist)
wishlistSchema.methods.moveToCart = function(productId, variantId) {
  const item = this.items.find(item => 
    item.product.toString() === productId.toString() && 
    item.variant?.toString() === variantId?.toString()
  );
  
  if (item) {
    this.removeItem(productId, variantId);
    return item;
  }
  
  return null;
};

// Method to generate share token
wishlistSchema.methods.generateShareToken = function() {
  this.shareToken = Math.random().toString(36).substring(2, 15) + 
                    Math.random().toString(36).substring(2, 15);
  return this.shareToken;
};

// Method to share wishlist
wishlistSchema.methods.shareWith = function(email, accessLevel = 'view') {
  const existingShare = this.sharedWith.find(share => share.email === email);
  
  if (existingShare) {
    existingShare.accessLevel = accessLevel;
    existingShare.sharedAt = new Date();
  } else {
    this.sharedWith.push({
      email,
      accessLevel,
      sharedAt: new Date()
    });
  }
  
  // Generate share token if not exists
  if (!this.shareToken) {
    this.generateShareToken();
  }
};

// Method to remove share access
wishlistSchema.methods.removeShare = function(email) {
  this.sharedWith = this.sharedWith.filter(share => share.email !== email);
};

// Pre-save middleware to update totalItems
wishlistSchema.pre('save', function(next) {
  this.totalItems = this.items.length;
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('Wishlist', wishlistSchema);
