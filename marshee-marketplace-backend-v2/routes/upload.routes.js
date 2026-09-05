const express = require('express');
const router = express.Router();
const { uploadGcsImages } = require('../utils/gcsUpload');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/upload/gcs:
 *   post:
 *     summary: Upload images to Google Cloud Storage
 *     description: Upload one or more images to GCS. Optional query `folder` (e.g. products, avatars). Returns public URLs.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: folder
 *         schema: { type: string, default: uploads }
 *         description: GCS folder path (e.g. products, avatars)
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images: { type: array, items: { type: string, format: binary } }
 *     responses:
 *       200:
 *         description: Upload successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 urls: { type: array, items: { type: string } }
 *                 count: { type: number }
 *       400: { description: No files provided }
 *       401: { description: Unauthorized }
 *       500: { description: GCS upload error }
 */
router.post(
  '/gcs',
  protect,
  authorize('partner', 'admin', 'user'),
  ...uploadGcsImages('images')
);

module.exports = router;
