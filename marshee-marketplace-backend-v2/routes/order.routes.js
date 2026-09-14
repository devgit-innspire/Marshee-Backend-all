const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { protect, authorize, requirePermission } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/orders:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items: { type: array, items: { type: object } }
 *               shippingAddress: { type: object }
 *               paymentMethod: { type: string }
 *               couponCode: { type: string }
 *     responses:
 *       201: { description: Order created }
 *       400: { description: Validation or cart error }
 *       401: { description: Unauthorized }
 */
router.post('/', protect, orderController.createOrder);

/**
 * @swagger
 * /api/v1/orders:
 *   get:
 *     summary: Get current user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of user orders }
 *       401: { description: Unauthorized }
 */
router.get('/', protect, orderController.getOrders);

/**
 * @swagger
 * /api/v1/orders/admin/all:
 *   get:
 *     summary: Get all orders (Admin or Partner)
 *     tags: [Orders, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of all orders }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/admin/all', protect, requirePermission('orders.view', 'orders.manage', { allowPartner: true }), orderController.getAllOrders);

/**
 * @swagger
 * /api/v1/orders/my:
 *   get:
 *     summary: Get authenticated user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of authenticated user's orders }
 *       401: { description: Unauthorized }
 */
router.get('/my', protect, orderController.getMyOrders);

/**
 * @swagger
 * /api/v1/orders/{id}:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order details }
 *       401: { description: Unauthorized }
 *       404: { description: Order not found }
 */
router.get('/:id', protect, orderController.getOrderById);

/**
 * @swagger
 * /api/v1/orders/{id}/tracking:
 *   get:
 *     summary: Get order tracking info
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tracking details }
 *       401: { description: Unauthorized }
 *       404: { description: Order not found }
 */
router.get('/:id/tracking', protect, orderController.getOrderTracking);

/**
 * @swagger
 * /api/v1/orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order cancelled }
 *       400: { description: Order cannot be cancelled }
 *       401: { description: Unauthorized }
 *       404: { description: Order not found }
 */
router.post('/:id/cancel', protect, orderController.cancelOrder);

/**
 * @swagger
 * /api/v1/orders/{id}/status:
 *   put:
 *     summary: Update order status (Admin only)
 *     tags: [Orders, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string }
 *     responses:
 *       200: { description: Status updated }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Order not found }
 */
router.put('/:id/status', protect, requirePermission('orders.manage'), orderController.updateOrderStatus);

/**
 * @swagger
 * /api/v1/orders/{id}/payment:
 *   put:
 *     summary: Update payment status (Admin only)
 *     tags: [Orders, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentStatus: { type: string }
 *     responses:
 *       200: { description: Payment status updated }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Order not found }
 */
router.put('/:id/payment', protect, authorize('admin'), orderController.updatePaymentStatus);

/**
 * @swagger
 * /api/v1/shiprocket/webhook:
 *   post:
 *     summary: Shiprocket webhook to update order status by AWB
 *     tags: [Shiprocket]
 *     responses:
 *       200: { description: Webhook processed }
 *       401: { description: Unauthorized (x-api-key mismatch) }
 *       404: { description: Order not found for this AWB }
 */
router.post('/webhook', orderController.shiprocketWebhook);

module.exports = router;