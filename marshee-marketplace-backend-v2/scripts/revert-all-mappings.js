/**
 * revert-all-mappings.js
 *
 * Restores original image mappings (with duplicates/fallbacks) in MongoDB.
 *
 * Usage:
 *   node scripts/revert-all-mappings.js
 */

const mongoose = require('mongoose');
const Product = require('../models/product.model');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const KIBBLE_URL = 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fkibble.jpg?alt=media&token=1a804ca2-c14a-4928-a042-b13f05a867ff';

const REVERTS = [
  // ── Paws For Greens Wet Foods ──────────────────────────────────────────────
  { sku: 'CK85', url: KIBBLE_URL },
  { sku: 'FF85', url: KIBBLE_URL },
  { sku: 'LM85', url: KIBBLE_URL },
  { sku: 'GG85', url: KIBBLE_URL },

  // ── Basil Shampoos ─────────────────────────────────────────────────────────
  {
    sku: 'B0DPX7C1N1',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fbasil-shampoo01.webp?alt=media&token=18a05860-6239-46d2-81aa-f7205848aaa4'
  },
  {
    sku: 'B07TSWZK7X',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fbasil-shampoo01.webp?alt=media&token=18a05860-6239-46d2-81aa-f7205848aaa4'
  },
  {
    sku: 'B07TP9MC56',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fbasil-royal-yet-novble.jpg?alt=media&token=4298404e-12f6-414d-a4f1-1a17fdc1ae6d'
  },
  {
    sku: 'B0B1WQ2RLX',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fbasil-shampoo01.webp?alt=media&token=18a05860-6239-46d2-81aa-f7205848aaa4'
  },

  // ── Basil Perfumes ─────────────────────────────────────────────────────────
  {
    sku: 'B09SYX36LM',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fbasil-woody.jpg?alt=media&token=7e5d1411-02f3-4911-83da-ea457d881482'
  },

  // ── Basil Treats ───────────────────────────────────────────────────────────
  {
    sku: 'B0DPWY528M',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Flollipop-2.jpg?alt=media&token=f5ea84cc-9a72-4e3d-b019-528ab67b66bb'
  },

  // ── Basil Mouth Sprays ─────────────────────────────────────────────────────
  {
    sku: 'B09RZV5SJP',
    url: 'https://firebasestorage.googleapis.com/v0/b/petphoneapp-8e663.firebasestorage.app/o/products%2Fmouth-spray.webp?alt=media&token=383d7902-18b8-45fb-b0dc-84a116a66656'
  }
];

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  for (const revert of REVERTS) {
    console.log(`Reverting ${revert.sku}...`);
    const product = await Product.findOne({ sku: revert.sku });
    
    if (!product) {
      console.log(`  ❌ Product not found!`);
      continue;
    }

    product.defaultMedia = product.defaultMedia || {};
    product.defaultMedia.thumbnail = product.defaultMedia.thumbnail || {};
    product.defaultMedia.thumbnail.url = revert.url;
    product.defaultMedia.thumbnail.alt = `${product.name} thumbnail`;

    if (product.variants && product.variants.length > 0) {
      product.variants[0].media = product.variants[0].media || {};
      product.variants[0].media.images = [revert.url];
    }

    await product.save();
    console.log(`  ✅ Restored!`);
  }

  await mongoose.disconnect();
  console.log('\nDisconnected. Successfully reverted all database mappings.');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
