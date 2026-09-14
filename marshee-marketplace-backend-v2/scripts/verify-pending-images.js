const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('../models/product.model');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PENDING_IMAGES_DIR = path.join(__dirname, '../../pending_images');

async function verify() {
  try {
    console.log('Connecting to MongoDB...');
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set in .env");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.\n');

    if (!fs.existsSync(PENDING_IMAGES_DIR)) {
      console.error(`Folder pending_images does not exist at: ${PENDING_IMAGES_DIR}`);
      process.exit(1);
    }

    const items = fs.readdirSync(PENDING_IMAGES_DIR);
    const subfolders = items.filter(item => {
      const itemPath = path.join(PENDING_IMAGES_DIR, item);
      return fs.statSync(itemPath).isDirectory();
    });

    console.log(`Found ${subfolders.length} subfolders under pending_images/`);
    console.log('========================================================================');

    for (const folder of subfolders) {
      const folderPath = path.join(PENDING_IMAGES_DIR, folder);
      const files = fs.readdirSync(folderPath).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
      });

      console.log(`\nSubfolder: "${folder}"`);
      console.log(`  └─ Found images locally: ${files.length > 0 ? files.join(', ') : 'None'}`);

      // Attempt matching in DB
      let searchStr = folder.trim();
      
      // Clean up search query for products (remove parentheses, combos etc)
      // e.g. "Liverlicious ( Carrot )" -> "Liverlicious" or match by Carrot
      let query = { $or: [] };

      if (searchStr.toLowerCase().includes('carrot')) {
        query.$or.push({ name: { $regex: 'Liverlicious', $options: 'i' }, sku: /LCC/i });
        query.$or.push({ name: { $regex: 'carrot', $options: 'i' } });
      } else if (searchStr.toLowerCase().includes('pumpkin')) {
        query.$or.push({ name: { $regex: 'Liverlicious', $options: 'i' }, sku: /LPC/i });
        query.$or.push({ name: { $regex: 'pumpkin', $options: 'i' } });
      } else if (searchStr.toLowerCase().includes('combo')) {
        query.$or.push({ name: { $regex: 'combo', $options: 'i' } });
        query.$or.push({ sku: { $regex: 'combo', $options: 'i' } });
      } else {
        query.$or.push({ name: { $regex: searchStr, $options: 'i' } });
        query.$or.push({ sku: { $regex: searchStr, $options: 'i' } });
      }

      const products = await Product.find(query).select('name sku defaultMedia variants');
      
      if (products.length === 0) {
        console.log(`  ⚠️  No matching products found in DB.`);
      } else {
        console.log(`  └─ Matching products in DB:`);
        products.forEach(p => {
          const currentUrl = p.defaultMedia?.thumbnail?.url || 'No URL';
          const hasVariantImages = p.variants?.some(v => v.media?.images?.length > 0);
          console.log(`     - [SKU: ${p.sku}] "${p.name}"`);
          console.log(`       Current DB Image: ${currentUrl}`);
          console.log(`       Has variant images: ${hasVariantImages ? 'Yes' : 'No'}`);
        });
      }
    }

  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed.');
    process.exit(0);
  }
}

verify();
