const multer = require('multer');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { keyFilePath, bucketName } = require('../config/gcs.config');

let storageClient = null;

function getStorage() {
  if (!storageClient) {
    storageClient = new Storage({ keyFilename: keyFilePath });
  }
  return storageClient;
}

const uploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Upload a buffer to Google Cloud Storage and return the public URL.
 * @param {Buffer} buffer - File buffer
 * @param {string} folder - Folder path in bucket (e.g. 'products', 'products/variants')
 * @param {string} filename - Original filename
 * @param {string} [mimetype] - MIME type (default: image/jpeg)
 * @returns {Promise<{ url: string, path: string }>}
 */
async function uploadBufferToGCS(buffer, folder, filename, mimetype = 'image/jpeg') {
  const storage = getStorage();
  const bucket = storage.bucket(bucketName);
  const ext = path.extname(filename) || '.jpg';
  const baseName = path.basename(filename, ext).replace(/\s+/g, '-');
  const safeName = `${baseName}-${Date.now()}${ext}`;
  const filePath = folder ? `${folder.replace(/\/$/, '')}/${safeName}` : safeName;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: { contentType: mimetype },
    resumable: false
  });

  // Make object publicly readable (if bucket allows). Skip if bucket has uniform public access.
  try {
    await file.makePublic();
  } catch (e) {
    // Ignore if bucket policy doesn't allow makePublic; caller can use signed URLs later
  }

  const url = `https://storage.googleapis.com/${bucketName}/${filePath}`;
  return { url, path: filePath };
}

/**
 * Middleware: parse multipart into req.files, then upload to GCS.
 * Expects field name 'images' or 'file' (or use uploadGcsImages('fieldName')).
 * Query: folder (optional), e.g. ?folder=products
 * Response: { success: true, urls: string[] }
 */
function uploadGcsImages(fieldName = 'images') {
  return [
    uploadMulter.any(),
    async (req, res) => {
      try {
        const folder = (req.query.folder || 'uploads').replace(/^\/|\/$/g, '');
        const files = (req.files || []).filter(
          f => fieldName === '*' || f.fieldname === fieldName
        );

        if (!files.length) {
          return res.status(400).json({
            success: false,
            message: 'No files to upload',
            field: fieldName
          });
        }

        const results = await Promise.all(
          files.map(f =>
            uploadBufferToGCS(f.buffer, folder, f.originalname, f.mimetype || 'image/jpeg')
          )
        );

        const urls = results.map(r => r.url);
        return res.status(200).json({
          success: true,
          urls,
          count: urls.length
        });
      } catch (error) {
        console.error('GCS upload error:', error);
        return res.status(500).json({
          success: false,
          message: 'Error uploading images to Google Cloud Storage',
          error: error.message
        });
      }
    }
  ];
}

module.exports = {
  getStorage,
  uploadBufferToGCS,
  uploadGcsImages,
  uploadMulter
};
