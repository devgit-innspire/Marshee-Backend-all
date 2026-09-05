const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/analytics/dashboard:
 *   get:
 *     summary: Get complete dashboard analytics (Partner sees own data, Admin sees all)
 *     tags: [Analytics, Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering (ISO format)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering (ISO format)
 *     responses:
 *       200:
 *         description: Complete dashboard analytics
 */
router.get('/dashboard', protect, authorize('partner', 'admin'), analyticsController.getDashboardAnalytics);

/**
 * @swagger
 * /api/v1/analytics/products:
 *   get:
 *     summary: Get product analytics only
 *     tags: [Analytics, Products]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Product analytics
 */
router.get('/products', protect, authorize('partner', 'admin'), analyticsController.getProductAnalytics);

/**
 * @swagger
 * /api/v1/analytics/orders:
 *   get:
 *     summary: Get order analytics only
 *     tags: [Analytics, Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Order analytics
 */
router.get('/orders', protect, authorize('partner', 'admin'), analyticsController.getOrderAnalytics);

/**
 * @swagger
 * /api/v1/analytics/sales:
 *   get:
 *     summary: Get sales analytics only
 *     tags: [Analytics, Sales]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sales analytics
 */
router.get('/sales', protect, authorize('partner', 'admin'), analyticsController.getSalesAnalytics);

/**
 * @swagger
 * /api/v1/analytics/categories:
 *   get:
 *     summary: Get category analytics (Admin only)
 *     tags: [Analytics, Categories, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Category analytics
 */
router.get('/categories', protect, authorize('admin'), analyticsController.getCategoryAnalytics);

/**
 * @swagger
 * /api/v1/analytics/partners:
 *   get:
 *     summary: Get partner sales analytics (Admin only)
 *     tags: [Analytics, Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner sales analytics
 */
router.get('/partners', protect, authorize('admin'), analyticsController.getPartnerAnalytics);

module.exports = router;
