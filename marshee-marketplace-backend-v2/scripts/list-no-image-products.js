const mongoose = require('mongoose');
const Product = require('../models/product.model');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function listNoImages() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Find products where thumbnail url is missing, empty, or includes "kibble.jpg"
    const products = await Product.find({
      $or: [
        { 'defaultMedia.thumbnail.url': { $exists: false } },
        { 'defaultMedia.thumbnail.url': null },
        { 'defaultMedia.thumbnail.url': '' },
        { 'defaultMedia.thumbnail.url': { $regex: 'kibble.jpg', $options: 'i' } }
      ]
    }).select('sku name');

    console.log(`\nFound ${products.length} products with no images (or using default kibble placeholder):\n`);
    
    products.forEach((p, idx) => {
      console.log(`${idx + 1}. ${p.name.trim()} (SKU: ${p.sku})`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

listNoImages();
