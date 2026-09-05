// Migration script to drop old unique index on reports collection
// Run this once: node drop-old-report-index.js

const mongoose = require('mongoose');
require('dotenv').config();

async function dropOldIndex() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('reports');
    
    // List all indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(idx => idx.name));
    
    // Try to drop the old unique index
    try {
      await collection.dropIndex('reporter_1_reportedUser_1');
      console.log('✅ Successfully dropped old unique index: reporter_1_reportedUser_1');
    } catch (err) {
      if (err.code === 27 || err.codeName === 'IndexNotFound' || err.message.includes('index not found')) {
        console.log('ℹ️  Old index does not exist (already dropped or never created)');
      } else {
        console.error('❌ Error dropping index:', err.message);
      }
    }
    
    // Recreate indexes using Mongoose model
    const Report = require('./models/Report').default;
    await Report.createIndexes();
    console.log('✅ Recreated indexes with new structure');
    
    await mongoose.disconnect();
    console.log('Migration completed');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

dropOldIndex();
