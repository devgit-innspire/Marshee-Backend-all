const express = require('express');
const router = express.Router();
const {
  addProduct,
  getAllProducts,
  getProductById,
  deleteProduct,
  getProductsByCategory,
  updateProduct,
  updateProductApproval,
  searchProducts,
  quickSearch,
  getPopularSearches,
  getDashboardProducts,
  getProductsForReview,
  addProductReview,
  getRecommendedProducts
} = require('../controllers/product.controller.js');
const { protect, authorize, requirePermission } = require('../middleware/auth');
const { uploadProductImages, uploadReviewMedia } = require('../utils/imageUpload');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');

const recommendationsLimiter = rateLimit({
  windowMs: Number(process.env.RECOMMENDATIONS_RATE_LIMIT_WINDOW_MS || 60_000),
  limit: Number(process.env.RECOMMENDATIONS_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user && (req.user.id || req.user._id);
    return userId ? String(userId) : ipKeyGenerator(req);
  },
});

/**
 * @swagger
 * /api/v1/products:
 *   post:
 *     summary: Create a new product
 *     description: Partner or admin creates a product (partner products start as draft). Supports multipart/form-data with image files in `images` field.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               category: { type: string }
 *               brand: { type: string }
 *               price: { type: number }
 *               images: { type: array, items: { type: string, format: binary } }
 *     responses:
 *       201: { description: Product created successfully }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', protect, requirePermission('products.edit', { allowPartner: true }), uploadProductImages('images'), addProduct);

/**
 * @swagger
 * /api/v1/products:
 *   get:
 *     summary: List all products
 *     description: Returns paginated products with optional filters (category, brand, page, limit).
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: brand
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of products }
 */
router.get('/', getAllProducts);

/**
 * @swagger
 * /api/v1/products/dashboard:
 *   get:
 *     summary: Get dashboard products
 *     description: Partner sees own products; Admin sees all. Requires partner or admin role.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Dashboard product list }
 *       401: { description: Unauthorized }
 */
router.get('/dashboard', protect, requirePermission('products.view', 'products.edit', { allowPartner: true }), getDashboardProducts);

/**
 * @swagger
 * /api/v1/products/for-review:
 *   get:
 *     summary: List products for review (Admin only)
 *     description: Returns draft/pending products for admin approval. Use PATCH /products/:id/approval to approve or reject.
 *     tags: [Products, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: List of products for review }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - Admin only }
 */
router.get('/for-review', protect, requirePermission('products.approve'), getProductsForReview);

/**
 * @swagger
 * /api/v1/products/search/advanced:
 *   get:
 *     summary: Advanced product search
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Search results }
 */
router.get('/search/advanced', searchProducts);

/**
 * @swagger
 * /api/v1/products/search/quick:
 *   get:
 *     summary: Quick product search
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Quick search results }
 */
router.get('/search/quick', quickSearch);

/**
 * @swagger
 * /api/v1/products/search/popular:
 *   get:
 *     summary: Popular product search terms
 *     description: Returns aggregated search strings ordered by frequency (from advanced and quick search usage).
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 50 }
 *         description: Max number of terms to return
 *     responses:
 *       200:
 *         description: Popular search terms
 */
router.get('/search/popular', getPopularSearches);

// AI recommendations (per pet)
router.get('/recommendations', protect, recommendationsLimiter, getRecommendedProducts);

/**
 * @swagger
 * /api/v1/products/service/{id}:
 *   get:
 *     summary: Get products by service category ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Products in service category }
 */
router.get('/service/:id', (req, res, next) => {
  req.params.categoryType = 'service';
  req.params.categoryId = req.params.id;
  getProductsByCategory(req, res, next);
});

/**
 * @swagger
 * /api/v1/products/category/{categoryType}/{categoryId}:
 *   get:
 *     summary: Get products by category type and ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: categoryType
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Products in category }
 */
router.get('/category/:categoryType/:categoryId', getProductsByCategory);

// Add a review: multipart `images` / `videos` files → Cloudinary; URLs merged into body (same idea as add product)
router.post('/:id/reviews', protect, ...uploadReviewMedia, addProductReview);

/**
 * @swagger
 * /api/v1/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Product details }
 *       404: { description: Product not found }
 */
router.get('/:id', getProductById);

/**
 * @swagger
 * /api/v1/products/{id}:
 *   put:
 *     summary: Update product
 *     description: Owner or admin. Supports multipart/form-data with `images` field.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               images: { type: array, items: { type: string, format: binary } }
 *     responses:
 *       200: { description: Product updated }
 *       401: { description: Unauthorized }
 *       404: { description: Product not found }
 */
router.put('/:id', protect, uploadProductImages('images'), updateProduct);

/**
 * @swagger
 * /api/v1/products/{id}/approval:
 *   patch:
 *     summary: Approve or reject product (Admin only)
 *     tags: [Products, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Approval updated }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Product not found }
 */
router.patch('/:id/approval', protect, requirePermission('products.approve'), updateProductApproval);

/**
 * @swagger
 * /api/v1/products/{id}:
 *   delete:
 *     summary: Delete product by ID
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Product deleted }
 *       401: { description: Unauthorized }
 *       404: { description: Product not found }
 */
router.delete('/:id', protect, deleteProduct);


module.exports = router;