const mongoose = require('mongoose');
const { uploadBufferToStorage } = require('../utils/imageUpload');
const Product = require('../models/product.model');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CLOUDINARY_DOMAIN = 'dqqljirqe';

async function migrate() {
  try {
    console.log('Connecting to MongoDB...');
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set in .env");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    console.log(`Searching for products with images hosted on ${CLOUDINARY_DOMAIN}...`);
    // Find products where defaultMedia.thumbnail.url or variants[].media.images contain the domain
    const products = await Product.find({
      $or: [
        { 'defaultMedia.thumbnail.url': { $regex: CLOUDINARY_DOMAIN, $options: 'i' } },
        { 'variants.media.images': { $regex: CLOUDINARY_DOMAIN, $options: 'i' } }
      ]
    });

    console.log(`Found ${products.length} products to migrate.`);
    let successCount = 0;
    let failCount = 0;

    for (let product of products) {
      console.log(`\nMigrating product: ${product.name} (ID: ${product._id})`);
      let isModified = false;

      // 1. Check default media
      if (product.defaultMedia?.thumbnail?.url?.includes(CLOUDINARY_DOMAIN)) {
        try {
          const oldUrl = product.defaultMedia.thumbnail.url;
          console.log(`  Downloading defaultMedia: ${oldUrl}`);
          
          const response = await fetch(oldUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          const fileName = oldUrl.split('/').pop().split('?')[0] || 'image.webp';
          console.log(`  Uploading to Firebase Storage as ${fileName}...`);
          
          const uploadResult = await uploadBufferToStorage(buffer, 'products', fileName);
          
          product.defaultMedia.thumbnail.url = uploadResult.secure_url;
          console.log(`  ✔ defaultMedia migrated successfully!`);
          isModified = true;
        } catch (error) {
          console.error(`  ❌ Failed to migrate defaultMedia for ${product._id}:`, error.message);
        }
      }

      // 2. Check variants
      if (product.variants && product.variants.length > 0) {
        for (let vIdx = 0; vIdx < product.variants.length; vIdx++) {
          const variant = product.variants[vIdx];
          if (variant.media && variant.media.images && variant.media.images.length > 0) {
            
            for (let iIdx = 0; iIdx < variant.media.images.length; iIdx++) {
              const oldUrl = variant.media.images[iIdx];
              if (oldUrl && oldUrl.includes(CLOUDINARY_DOMAIN)) {
                try {
                  console.log(`  Downloading variant [${vIdx}] image [${iIdx}]: ${oldUrl}`);
                  
                  const response = await fetch(oldUrl);
                  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                  const arrayBuffer = await response.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);

                  const fileName = oldUrl.split('/').pop().split('?')[0] || `variant_${vIdx}_${iIdx}.webp`;
                  console.log(`  Uploading to Firebase Storage as ${fileName}...`);
                  
                  const uploadResult = await uploadBufferToStorage(buffer, 'products/variants', fileName);
                  
                  product.variants[vIdx].media.images[iIdx] = uploadResult.secure_url;
                  console.log(`  ✔ Variant [${vIdx}] image [${iIdx}] migrated successfully!`);
                  isModified = true;
                } catch (error) {
                  console.error(`  ❌ Failed to migrate variant [${vIdx}] image [${iIdx}] for ${product._id}:`, error.message);
                }
              }
            }
          }
        }
      }

      if (isModified) {
        // Mark arrays/nested objects as modified for Mongoose just in case
        product.markModified('defaultMedia');
        product.markModified('variants');
        await product.save();
        console.log(`Saved product ${product._id} to DB.`);
        successCount++;
      } else {
        console.log(`No images migrated for product ${product._id}.`);
        failCount++;
      }
    }

    console.log(`\n============================`);
    console.log(`Migration Complete!`);
    console.log(`Successfully migrated: ${successCount} products.`);
    console.log(`Failed to migrate: ${failCount} products.`);
    console.log(`============================\n`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  }
}

migrate();
