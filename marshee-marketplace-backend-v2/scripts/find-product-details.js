const mongoose = require('mongoose');
const Product = require('../models/product.model');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function findProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // 1. Search for FF85
    console.log('\n--- Searching for SKU "FF85" ---');
    const ff85 = await Product.findOne({ sku: /FF85/i });
    if (ff85) {
      console.log(`Found product with SKU "${ff85.sku}": name="${ff85.name}"`);
    } else {
      console.log('SKU "FF85" not found.');
      // Find similar SKUs or names containing Fish
      const fishProducts = await Product.find({ name: /fish/i }).select('name sku');
      console.log('Fish products in DB:', fishProducts);
    }

    // 2. Search for Liverlicious
    console.log('\n--- Searching for Liverlicious ---');
    const liverliciousProducts = await Product.find({
      $or: [
        { name: /Liverlicious/i },
        { sku: /Liverlicious/i }
      ]
    }).select('name sku');
    console.log('Liverlicious products found:', liverliciousProducts);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

findProducts();
