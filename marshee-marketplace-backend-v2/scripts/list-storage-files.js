const admin = require('../config/firebaseAdmin');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function listStorageFiles() {
  try {
    if (!admin.apps.length) {
      throw new Error("Firebase Admin not initialized. Check your credentials.");
    }
    
    // Resolve bucket name
    const bucketCandidates = [
      admin.app().options.storageBucket,
      process.env.FIREBASE_STORAGE_BUCKET,
      process.env.GCS_BUCKET
    ].filter(Boolean);

    let bucket = null;
    for (const name of bucketCandidates) {
      const b = admin.storage().bucket(name);
      const [exists] = await b.exists();
      if (exists) {
        bucket = b;
        console.log(`Using bucket: ${name}`);
        break;
      }
    }

    if (!bucket) {
      throw new Error(`Could not find active bucket. Checked: ${bucketCandidates.join(', ')}`);
    }

    console.log('Listing files under "products/" in Firebase Storage...');
    const [files] = await bucket.getFiles({ prefix: 'products/' });
    console.log(`Found ${files.length} files in total under "products/".`);

    const fileList = files.map(file => ({
      name: file.name,
      updated: file.metadata.updated,
      size: file.metadata.size
    }));

    const outputPath = path.join(__dirname, '../scripts/storage_products_list.json');
    fs.writeFileSync(outputPath, JSON.stringify(fileList, null, 2));
    console.log(`Saved file list to ${outputPath}`);

  } catch (error) {
    console.error('Error listing storage files:', error);
  } finally {
    process.exit(0);
  }
}

listStorageFiles();
