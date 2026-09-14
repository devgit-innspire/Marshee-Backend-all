const mongoose = require('mongoose');
const Product = require('../models/product.model');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function listAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const products = await Product.find({}).select('sku name defaultMedia.thumbnail.url');
    console.log(`Total products in DB: ${products.length}`);
    
    // Write all to a json file to inspect easily
    const fs = require('fs');
    fs.writeFileSync('all_db_products.json', JSON.stringify(products, null, 2));
    console.log('Written to all_db_products.json');

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

listAll();
