/**
 * unhide-moe-puppy.js
 *
 * Restores the visibility of 13 specific Moe Puppy products by setting
 * status.isActive to true in MongoDB.
 *
 * Usage:
 *   node scripts/unhide-moe-puppy.js
 */

const mongoose = require('mongoose');
const Product = require('../models/product.model');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SKUS = [
  'MOE-PUPPY-FOAM-WASH-CATS',
  'MOE-PUPPY-2IN1-SHAMPOO-CONDITIONER',
  'MOE-PUPPY-RINSE-FREE-DRY-SHAMPOO',
  'MOE-PUPPY-XTRA-NOURISH-SHAMPOO',
  'MOE-PUPPY-FOAM-SHAMPOO-150ML',
  'MOE-PUPPY-DENTAL-SPRAY',
  'MOE-PUPPY-TICK-DEFENSE-SHAMPOO',
  'MOE-PUPPY-MULTI-ACTION-DISINFECTANT',
  'MOE-PUPPY-ANTI-TICK-SPRAY',
  'MOE-PUPPY-DEODORIZER',
  'MOE-PUPPY-EAR-CARE',
  'MOE-PUPPY-XTRA-NOURISH-SHAMPOO-900ML',
  'MOE-PUPPY-2IN1-SHAMPOO-CONDITIONER-900ML'
];

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  console.log(`Restoring visibility for ${SKUS.length} products...`);
  const result = await Product.updateMany(
    { sku: { $in: SKUS } },
    { $set: { 'status.isActive': true } }
  );

  console.log(`Matched: ${result.matchedCount}`);
  console.log(`Modified: ${result.modifiedCount}`);

  await mongoose.disconnect();
  console.log('\nDisconnected. Successfully restored product visibility.');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
