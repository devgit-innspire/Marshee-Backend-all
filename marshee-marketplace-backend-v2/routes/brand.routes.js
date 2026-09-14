const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brand.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/brands:
 *   post:
 *     summary: Create a new brand (Partner/Admin)
 *     tags: [Brands]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *               logo:
 *                 type: string
 *               bannerImage:
 *                 type: string
 *               socialMedia:
 *                 type: object
 *               seo:
 *                 type: object
 *     responses:
 *       201:
 *         description: Brand created successfully
 */
router.post('/', protect, authorize('partner', 'admin', 'subadmin'), brandController.createBrand);

/**
 * @swagger
 * /api/v1/brands:
 *   get:
 *     summary: Get all active brands (Public)
 *     tags: [Brands]
 *     responses:
 *       200:
 *         description: List of brands
 */
router.get('/', brandController.getBrands);

// IMPORTANT: Specific routes must come BEFORE parameterized routes (/:id)
/**
 * @swagger
 * /api/v1/brands/dashboard:
 *   get:
 *     summary: Get brands for dashboard (Partner sees own brands, Admin sees all)
 *     tags: [Brands, Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of brands
 */
router.get('/myBrands', protect, authorize('partner', 'admin', 'subadmin'), brandController.getMyBrands);

/**
 * @swagger
 * /api/v1/brands/{id}:
 *   get:
 *     summary: Get brand by ID
 *     tags: [Brands]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Brand details
 */
router.get('/:id', protect, brandController.getBrand);

/**
 * @swagger
 * /api/v1/brands/{id}:
 *   put:
 *     summary: Update brand (Partner can update their own, Admin can update any)
 *     tags: [Brands]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Brand updated successfully
 */
router.put('/:id', protect, brandController.updateBrand);

/**
 * @swagger
 * /api/v1/brands/{id}:
 *   delete:
 *     summary: Delete brand (Partner can delete their own, Admin can delete any)
 *     tags: [Brands]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Brand deleted successfully
 */
router.delete('/:id', protect, brandController.deleteBrand);

module.exports = router;
