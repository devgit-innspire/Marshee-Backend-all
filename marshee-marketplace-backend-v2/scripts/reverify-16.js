const mongoose = require('mongoose');
const Product = require('../models/product.model');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const TARGET_SKUS = [
  'VEG-DOG-FOOD-3KG',
  'VEG-ADULT-DOG-1KG',
  'CK85',
  'FF85',
  'LM85',
  'GG85',
  'PROBIOTIC-SHAMPOO-LIQUID-LONG-HAIR',
  'DJ001',
  'PROD098',
  'PROD100',
  'PROD102',
  'PROD108',
  'PROD110',
  'PROD113',
  'PROD111',
  'PROD114'
];

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    console.log('\n--- Re-verifying the 16 Products Mappings ---');
    
    const results = [];
    for (const sku of TARGET_SKUS) {
      const product = await Product.findOne({ sku });
      if (!product) {
        results.push({ sku, status: 'NOT_FOUND_IN_DB', name: 'N/A', image: 'N/A' });
        continue;
      }
      
      const imageUrl = product.defaultMedia?.thumbnail?.url || '';
      
      let isMapped = false;
      if (imageUrl && !imageUrl.includes('kibble.jpg') && !imageUrl.includes('placeholder.png')) {
        isMapped = true;
      }
      
      results.push({
        sku,
        name: product.name.trim(),
        status: isMapped ? 'MAPPED' : 'PENDING',
        image: imageUrl || 'None'
      });
    }

    console.log('\nResults:');
    console.log(JSON.stringify(results, null, 2));

    const pending = results.filter(r => r.status === 'PENDING' || r.status === 'NOT_FOUND_IN_DB');
    const mapped = results.filter(r => r.status === 'MAPPED');

    console.log(`\nSummary:`);
    console.log(`- Mapped: ${mapped.length}`);
    console.log(`- Remaining/Pending: ${pending.length}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

check();
