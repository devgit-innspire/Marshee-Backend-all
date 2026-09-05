const mongoose = require('mongoose');
const admin = require('../config/firebaseAdmin');
const Product = require('../models/product.model');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'petphoneapp-8e663.firebasestorage.app';

const CORRECTIONS = [
  {
    sku: 'B0DPWY528M',
    proposedPath: 'products/basil-royal-yet-novble.jpg'
  },
  {
    sku: 'ULTIMATE-DIET-MEDIUM-MAXI-ADULT',
    proposedPath: 'products/ultimate-diet-var2-1.webp'
  },
  {
    sku: 'ULTIMATE-DIET-MEDIUM-MAXI-PUPPY',
    proposedPath: 'products/Ultimate-diet-var3-1.webp'
  },
  {
    sku: 'PROD109',
    proposedPath: 'products/variants/Oatmeal_Shampoo_Carousel-03_1783930630403_bc9e9c466c7a.webp'
  }
];

async function buildPublicUrl(bucket, filePath) {
  try {
    const file = bucket.file(filePath);
    const [metadata] = await file.getMetadata();
    const token = metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
    const encoded = encodeURIComponent(filePath);
    const baseUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encoded}?alt=media`;
    return token ? `${baseUrl}&token=${token}` : baseUrl;
  } catch (err) {
    console.error(`Failed to get metadata for ${filePath}:`, err.message);
    throw err;
  }
}

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    console.log('Initializing Firebase Admin...');
    const bucket = admin.storage().bucket(BUCKET_NAME);

    console.log('\nApplying corrections:');
    console.log('----------------------------------------------------');

    for (const correction of CORRECTIONS) {
      const { sku, proposedPath } = correction;
      
      console.log(`Processing SKU: ${sku}`);
      
      // 1. Fetch product
      const product = await Product.findOne({ sku });
      if (!product) {
        console.warn(`  ⚠️ Product with SKU ${sku} not found in DB. Skipping.`);
        continue;
      }

      // 2. Generate public URL
      const publicUrl = await buildPublicUrl(bucket, proposedPath);
      console.log(`  Proposed Image Path: ${proposedPath}`);
      console.log(`  Proposed Image URL: ${publicUrl}`);

      // 3. Prepare updates
      const updates = {};
      
      // Update variants
      for (let i = 0; i < product.variants.length; i++) {
        updates[`variants.${i}.media.images`] = [publicUrl];
      }

      // Update defaultMedia thumbnail
      updates['defaultMedia.thumbnail.url'] = publicUrl;
      updates['defaultMedia.thumbnail.path'] = proposedPath;

      // 4. Save to DB
      await Product.updateOne({ _id: product._id }, { $set: updates });
      console.log(`  ✅ Successfully updated product: ${product.name}`);
      console.log('----------------------------------------------------');
    }

    console.log('\nAll corrections applied successfully.');

  } catch (err) {
    console.error('Fatal error applying corrections:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
    process.exit(0);
  }
}

run();
