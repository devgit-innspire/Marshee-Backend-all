const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const admin = require('../config/firebaseAdmin');

// Memory storage so we can stream buffers directly to Firebase Storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file (matches Firebase rules)
  },
});

// Review media (videos can be larger than product images)
const uploadReview = multer({
  storage,
  limits: {
    fileSize: Number(process.env.REVIEW_UPLOAD_MAX_BYTES || 100 * 1024 * 1024),
  },
});

let resolvedBucketName = null;

const getBucketCandidates = () => {
  const configured = admin.app()?.options?.storageBucket;
  const projectId = process.env.FIREBASE_PROJECT_ID || admin.app()?.options?.projectId;

  const candidates = [
    configured,
    process.env.FIREBASE_STORAGE_BUCKET,
    process.env.GCS_BUCKET,
    projectId ? `${projectId}.firebasestorage.app` : null,
    projectId ? `${projectId}.appspot.com` : null,
  ].filter(Boolean);

  return [...new Set(candidates)];
};

const isBucketNotFoundError = (err) => {
  if (!err) return false;
  if (err.code === 404) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('bucket does not exist') || msg.includes('notfound');
};

const resolveStorageBucket = async () => {
  if (resolvedBucketName) {
    return admin.storage().bucket(resolvedBucketName);
  }

  const candidates = getBucketCandidates();
  if (candidates.length === 0) {
    throw new Error('No Firebase Storage bucket candidates configured');
  }

  for (const name of candidates) {
    const bucket = admin.storage().bucket(name);
    try {
      const [exists] = await bucket.exists();
      if (exists) {
        resolvedBucketName = name;
        console.log(`[firebase-storage] using bucket: ${name}`);
        return bucket;
      }
      console.warn(`[firebase-storage] bucket does not exist: ${name}`);
    } catch (err) {
      console.warn(`[firebase-storage] failed bucket check (${name}): ${err.message}`);
    }
  }

  throw new Error(
    `No accessible Firebase Storage bucket found. Checked: ${candidates.join(', ')}`
  );
};

const uploadBufferWithBucket = (bucket, buffer, folder, filename, resourceType = 'image') =>
  new Promise((resolve, reject) => {
    const parsed = path.parse(filename || 'file');
    const base = parsed.name
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 80) || 'file';
    const ext = parsed.ext || '';
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const objectName = `${folder}/${base}_${unique}${ext}`;

    // Token required to build the public tokenized download URL
    const downloadToken = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

    const file = bucket.file(objectName);
    const contentType = guessContentType(filename, resourceType);

    const stream = file.createWriteStream({
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
      resumable: false,
      validation: false,
    });

    stream.on('error', (err) => reject(err));
    stream.on('finish', () => {
      const encodedPath = encodeURIComponent(objectName);
      const secureUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
      resolve({
        secure_url: secureUrl,
        public_id: objectName,
        bucket: bucket.name,
      });
    });

    stream.end(buffer);
  });

/**
 * Upload a single buffer to Firebase Cloud Storage and return a public URL.
 *
 * Mirrors the previous Cloudinary helper signature so the rest of this file
 * (and its callers) stay unchanged.
 *
 * @param {Buffer} buffer - File buffer
 * @param {string} folder - Destination folder in the bucket (e.g. 'products')
 * @param {string} filename - Original filename (used in the object name)
 * @param {'image'|'video'} [resourceType='image'] - Kept for parity; currently unused
 * @returns {Promise<{secure_url: string, public_id: string, bucket: string}>}
 */
const uploadBufferToStorage = async (buffer, folder, filename, resourceType = 'image') => {
  if (!admin.apps || admin.apps.length === 0) {
    throw new Error('Firebase Admin not initialized');
  }

  let bucket = await resolveStorageBucket();
  try {
    return await uploadBufferWithBucket(bucket, buffer, folder, filename, resourceType);
  } catch (err) {
    if (isBucketNotFoundError(err)) {
      // Bucket may have changed; clear cache and retry once with fresh resolution.
      resolvedBucketName = null;
      bucket = await resolveStorageBucket();
      return await uploadBufferWithBucket(bucket, buffer, folder, filename, resourceType);
    }
    throw err;
  }
};

function guessContentType(filename, resourceType) {
  const ext = (path.extname(filename || '') || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
  };
  if (map[ext]) return map[ext];
  return resourceType === 'video' ? 'video/mp4' : 'image/jpeg';
}

/**
 * Middleware factory: handles product image uploads.
 * Same behavior as before — just targets Firebase Storage instead of Cloudinary.
 */
const uploadProductImages = (fieldName = 'images') => [
  upload.any(),
  async (req, res, next) => {
    try {
      console.log('[uploadProductImages] incoming files:', (req.files || []).map(f => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        size: f.size,
      })));

      if (!req.files || req.files.length === 0) {
        return next();
      }

      // 1) PRODUCT-LEVEL IMAGES
      const productFiles =
        fieldName === '*'
          ? req.files
          : req.files.filter(file => file.fieldname === fieldName);

      if (productFiles.length > 0) {
        console.log('[uploadProductImages] processing product field:', fieldName, 'files:', productFiles.length);

        const uploads = await Promise.all(
          productFiles.map(file =>
            uploadBufferToStorage(file.buffer, 'products', file.originalname)
          )
        );

        const urls = uploads.map(u => u.secure_url);
        console.log('[uploadProductImages] product-level uploaded URLs:', urls);

        if (req.body.images) {
          const existing = Array.isArray(req.body.images)
            ? req.body.images
            : String(req.body.images)
                .split(/[|,]/)
                .map(s => s.trim())
                .filter(Boolean);

          req.body.images = [...existing, ...urls].join('|');
        } else {
          req.body.images = urls.join('|');
        }
      }

      // 2) VARIANT-LEVEL IMAGES (fields like variantImages[0][], variantImages[1][], ...)
      const variantFileMap = {};
      const variantFieldRegex = /^variantImages\[(\d+)\]\[\]$/;

      for (const file of req.files) {
        const match = file.fieldname.match(variantFieldRegex);
        if (match) {
          const idx = parseInt(match[1], 10);
          if (!Number.isNaN(idx)) {
            if (!variantFileMap[idx]) {
              variantFileMap[idx] = [];
            }
            variantFileMap[idx].push(file);
          }
        }
      }

      const variantIndexes = Object.keys(variantFileMap);
      if (variantIndexes.length > 0) {
        console.log('[uploadProductImages] found variant image groups for indexes:', variantIndexes);

        let variants = [];
        if (typeof req.body.variants === 'string') {
          try {
            const parsed = JSON.parse(req.body.variants);
            if (Array.isArray(parsed)) {
              variants = parsed;
            }
          } catch (err) {
            console.warn('[uploadProductImages] failed to parse req.body.variants JSON:', err.message);
          }
        } else if (Array.isArray(req.body.variants)) {
          variants = req.body.variants;
        } else if (req.body.variants && typeof req.body.variants === 'object') {
          variants = Array.isArray(req.body.variants) ? req.body.variants : [req.body.variants];
        }

        if (!Array.isArray(variants)) {
          variants = [];
        }

        for (const idxStr of variantIndexes) {
          const idx = parseInt(idxStr, 10);
          const files = variantFileMap[idx] || [];
          console.log(`[uploadProductImages] uploading ${files.length} files for variant index ${idx}`);

          const uploads = await Promise.all(
            files.map(file =>
              uploadBufferToStorage(file.buffer, 'products/variants', file.originalname)
            )
          );

          const urls = uploads.map(u => u.secure_url);
          console.log(`[uploadProductImages] variant ${idx} uploaded URLs:`, urls);

          if (!variants[idx]) {
            variants[idx] = {};
          }
          if (!variants[idx].media || typeof variants[idx].media !== 'object') {
            variants[idx].media = {};
          }
          if (!Array.isArray(variants[idx].media.images)) {
            variants[idx].media.images = [];
          }

          variants[idx].media.images.push(...urls);
        }

        req.body.variants = JSON.stringify(variants);
        console.log('[uploadProductImages] updated req.body.variants with Firebase Storage URLs');
      }

      return next();
    } catch (error) {
      console.error('Firebase Storage upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error uploading images',
        error: error.message,
      });
    }
  },
];

/**
 * Review attachments: multipart file fields `images` and `videos`.
 * Uploads to Firebase Storage and merges public URLs into req.body.images / req.body.videos
 * (pipe-separated), same shape as before so controllers and parseImages keep working.
 */
const uploadReviewMedia = [
  uploadReview.any(),
  async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return next();
      }

      const imageFiles = req.files.filter((f) => f.fieldname === 'images');
      const videoFiles = req.files.filter((f) => f.fieldname === 'videos');

      if (imageFiles.length > 0) {
        const uploads = await Promise.all(
          imageFiles.map((file) =>
            uploadBufferToStorage(file.buffer, 'reviews/images', file.originalname, 'image')
          )
        );
        const urls = uploads.map((u) => u.secure_url);
        if (req.body.images) {
          const existing = Array.isArray(req.body.images)
            ? req.body.images
            : String(req.body.images)
                .split(/[|,]/)
                .map((s) => s.trim())
                .filter(Boolean);
          req.body.images = [...existing, ...urls].join('|');
        } else {
          req.body.images = urls.join('|');
        }
      }

      if (videoFiles.length > 0) {
        const uploads = await Promise.all(
          videoFiles.map((file) =>
            uploadBufferToStorage(file.buffer, 'reviews/videos', file.originalname, 'video')
          )
        );
        const urls = uploads.map((u) => u.secure_url);
        if (req.body.videos) {
          const existing = Array.isArray(req.body.videos)
            ? req.body.videos
            : String(req.body.videos)
                .split(/[|,]/)
                .map((s) => s.trim())
                .filter(Boolean);
          req.body.videos = [...existing, ...urls].join('|');
        } else {
          req.body.videos = urls.join('|');
        }
      }

      return next();
    } catch (error) {
      console.error('Firebase Storage review media upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error uploading review media',
        error: error.message,
      });
    }
  },
];

module.exports = {
  uploadProductImages,
  uploadReviewMedia,
  // Exported for any future direct use
  uploadBufferToStorage,
};
