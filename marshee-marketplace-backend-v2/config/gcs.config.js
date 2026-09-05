require('dotenv').config();
const path = require('path');

const keyFilePath =
  process.env.GCS_KEY_FILE ||
  path.join(__dirname, 'gcs-storage-access.json');

const bucketName = process.env.GCS_BUCKET || 'marshee_images';

module.exports = {
  keyFilePath,
  bucketName
};
