const express = require('express');
const router = express.Router();
const wogglePreOrderController = require('../controllers/wogglePreOrder.controller');
const wogglePaymentController = require('../controllers/wogglePayment.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/woggle/pre-order:
 *   post:
 *     summary: Create a new Woggle pre-order
 *     tags: [Woggle Pre-Order]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, address]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               address: { type: string }
 *               amount: { type: number }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Woggle pre-order created }
 *       400: { description: Validation error }
 */
router.post('/pre-order', wogglePreOrderController.createWogglePreOrder);

/**
 * @swagger
 * /api/v1/woggle/pre-order:
 *   get:
 *     summary: Get all Woggle pre-orders with pagination and filtering
 *     tags: [Woggle Pre-Order]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: email
 *         schema: { type: string }
 *       - in: query
 *         name: phone
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, payment_pending, payment_completed, cancelled, fulfilled] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: List of Woggle pre-orders }
 */
router.get('/pre-order', protect, authorize('admin'), wogglePreOrderController.getAllWogglePreOrders);

/**
 * @swagger
 * /api/v1/woggle/pre-order/stats:
 *   get:
 *     summary: Get Woggle pre-order statistics
 *     tags: [Woggle Pre-Order]
 *     responses:
 *       200: { description: Woggle pre-order stats }
 */
router.get('/pre-order/stats', protect, authorize('admin'), wogglePreOrderController.getWogglePreOrderStats);

/**
 * @swagger
 * /api/v1/woggle/pre-order/{id}:
 *   get:
 *     summary: Get Woggle pre-order by ID
 *     tags: [Woggle Pre-Order]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Woggle pre-order details }
 *       404: { description: Pre-order not found }
 */
router.get('/pre-order/:id', protect, authorize('admin'), wogglePreOrderController.getWogglePreOrderById);

/**
 * @swagger
 * /api/v1/woggle/pre-order/{id}:
 *   put:
 *     summary: Update Woggle pre-order by ID
 *     tags: [Woggle Pre-Order]
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
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               status: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Woggle pre-order updated }
 *       404: { description: Pre-order not found }
 */
router.put('/pre-order/:id', protect, authorize('admin'), wogglePreOrderController.updateWogglePreOrder);

/**
 * @swagger
 * /api/v1/woggle/pre-order/{id}:
 *   delete:
 *     summary: Delete Woggle pre-order by ID
 *     tags: [Woggle Pre-Order]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Woggle pre-order deleted }
 *       404: { description: Pre-order not found }
 */
router.delete('/pre-order/:id', protect, authorize('admin'), wogglePreOrderController.deleteWogglePreOrder);

/**
 * @swagger
 * /api/v1/woggle/payment/create:
 *   post:
 *     summary: Create Razorpay payment for Woggle pre-order
 *     tags: [Woggle Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [preOrderId, amount]
 *             properties:
 *               preOrderId: { type: string }
 *               amount: { type: number }
 *     responses:
 *       200: { description: Payment order created; returns Razorpay order id and key }
 *       400: { description: Validation error }
 *       404: { description: Pre-order not found }
 */
router.post('/payment/create', wogglePaymentController.createRazorpayPaymentForWogglePreOrder);

/**
 * @swagger
 * /api/v1/woggle/payment/verify:
 *   post:
 *     summary: Verify Razorpay payment for Woggle pre-order
 *     tags: [Woggle Payment]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               razorpay_order_id: { type: string }
 *               razorpay_payment_id: { type: string }
 *               razorpay_signature: { type: string }
 *     responses:
 *       200: { description: Payment verified }
 *       400: { description: Verification failed }
 */
router.post('/payment/verify', wogglePaymentController.verifyRazorpayPaymentForWoggle);

/**
 * @swagger
 * /api/v1/woggle/payment/verify:
 *   get:
 *     summary: Verify Razorpay payment (GET callback)
 *     tags: [Woggle Payment]
 *     parameters:
 *       - in: query
 *         name: razorpay_payment_id
 *         schema: { type: string }
 *       - in: query
 *         name: razorpay_order_id
 *         schema: { type: string }
 *     responses:
 *       200: { description: Payment verification result }
 */
router.get('/payment/verify', wogglePaymentController.verifyRazorpayPaymentForWoggle);

/**
 * @swagger
 * /api/v1/woggle/payment/webhook:
 *   post:
 *     summary: Razorpay webhook for Woggle pre-orders
 *     description: Called by Razorpay; do not use for client verification.
 *     tags: [Woggle Payment]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Webhook processed }
 */
router.post('/payment/webhook', wogglePaymentController.handleRazorpayWebhookForWoggle);

module.exports = router;
