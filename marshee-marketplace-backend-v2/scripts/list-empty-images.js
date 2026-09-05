const mongoose = require('mongoose');
const Product = require('../models/product.model');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function listEmptyImages() {
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set in .env");
    
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    console.log('Fetching products with empty or missing images...');
    
    // Find products where defaultMedia.thumbnail.url is null, empty string, or doesn't exist
    // AND variants[0].media.images is null, empty, or doesn't exist
    const products = await Product.find({
      $and: [
        {
          $or: [
            { 'defaultMedia.thumbnail.url': { $exists: false } },
            { 'defaultMedia.thumbnail.url': null },
            { 'defaultMedia.thumbnail.url': '' }
          ]
        },
        {
          $or: [
            { 'variants.media.images': { $exists: false } },
            { 'variants.media.images': { $size: 0 } },
            { 'variants.0.media.images.0': { $exists: false } },
            { 'variants.0.media.images.0': null }
          ]
        }
      ]
    });

    console.log(`\nFound ${products.length} products with no images:`);
    console.log('----------------------------------------------------');
    
    const results = products.map(p => ({
      id: p._id,
      sku: p.sku || 'No SKU',
      name: p.name
    }));

    console.log(JSON.stringify(results, null, 2));
    console.log('----------------------------------------------------');
    console.log(`Total count: ${products.length}`);

  } catch (error) {
    console.error('Failed to query products:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  }
}

listEmptyImages();
