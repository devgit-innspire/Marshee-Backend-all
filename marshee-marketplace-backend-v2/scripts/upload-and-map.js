const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('../models/product.model');
const { uploadBufferToStorage } = require('../utils/imageUpload');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PENDING_IMAGES_DIR = path.join(__dirname, '../../pending_images');

const MAPPINGS = [
  {
    folder: 'Purrfect Chicken Delight ',
    sku: 'CK85'
  },
  {
    folder: 'Fin-tastic Fish Feast ',
    sku: 'FF85'
  },
  {
    folder: 'Lamb Medley ',
    sku: 'LM85'
  },
  {
    folder: 'Goat Goodness ',
    sku: 'GG85'
  },
  {
    folder: 'Liverlicious ( Carrot ) ',
    sku: 'LCC80'
  },
  {
    folder: 'Liverlicious ( Pumpkin ) ',
    sku: 'LPC80'
  }
];

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set in .env");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.\n');

    for (const mapping of MAPPINGS) {
      const folderPath = path.join(PENDING_IMAGES_DIR, mapping.folder);
      if (!fs.existsSync(folderPath)) {
        console.warn(`⚠️ Folder does not exist: "${folderPath}". Skipping SKU: ${mapping.sku}`);
        continue;
      }

      const files = fs.readdirSync(folderPath).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      }).sort(); // Sort alphabetically to be consistent

      if (files.length === 0) {
        console.warn(`⚠️ No images found in folder: "${mapping.folder}". Skipping SKU: ${mapping.sku}`);
        continue;
      }

      console.log(`Processing SKU: "${mapping.sku}" (Folder: "${mapping.folder}")`);
      console.log(`  └─ Found local files: ${files.join(', ')}`);

      // Find the product in the DB
      const product = await Product.findOne({ sku: mapping.sku });
      if (!product) {
        console.error(`  ❌ Product not found in DB with SKU: ${mapping.sku}`);
        continue;
      }

      console.log(`  └─ Found product in DB: "${product.name}"`);

      const uploadedUrls = [];
      for (const filename of files) {
        const filePath = path.join(folderPath, filename);
        console.log(`  └─ Uploading: ${filename}...`);
        const buffer = fs.readFileSync(filePath);
        
        try {
          const uploadResult = await uploadBufferToStorage(buffer, 'products', filename);
          console.log(`     ✔ Uploaded successfully. URL: ${uploadResult.secure_url}`);
          uploadedUrls.push(uploadResult.secure_url);
        } catch (uploadErr) {
          console.error(`     ❌ Failed to upload ${filename}:`, uploadErr.message);
        }
      }

      if (uploadedUrls.length === 0) {
        console.error(`  ❌ Failed to upload any images for SKU: ${mapping.sku}`);
        continue;
      }

      // Update the DB record
      const primaryUrl = uploadedUrls[0];
      
      const updates = {};
      
      // Update defaultMedia thumbnail
      updates['defaultMedia.thumbnail.url'] = primaryUrl;
      updates['defaultMedia.featuredImage.url'] = primaryUrl; // Update featured image as well
      
      // Update all variants' media images
      if (product.variants && product.variants.length > 0) {
        for (let i = 0; i < product.variants.length; i++) {
          updates[`variants.${i}.media.images`] = uploadedUrls;
        }
      }

      await Product.updateOne({ _id: product._id }, { $set: updates });
      console.log(`  ✅ Successfully updated product mappings in DB.`);
      console.log('----------------------------------------------------');
    }

  } catch (err) {
    console.error('Fatal error running upload-and-map:', err);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  }
}

run();
