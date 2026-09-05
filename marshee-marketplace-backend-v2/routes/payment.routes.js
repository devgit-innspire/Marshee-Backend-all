const express = require('express');
const router = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');
const paymentController = require('../controllers/payment.controller');
const { initiatePhonePePayment, handlePhonePeCallback, createPaymentForOrder, createPaymentForPreOrder, checkStatus, razorpayPaymentTest, razorpayPaymentLinkVerifyTest} = require('../controllers/test.controller');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');

// 15 payment creation attempts per 15 min per IP
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    message: { success: false, message: 'Too many payment requests. Please try again in 15 minutes.' },
});

// 30 status checks per 15 min per IP
const paymentStatusLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    message: { success: false, message: 'Too many status check requests. Please try again in 15 minutes.' },
});

/**
 * @swagger
 * /api/v1/payments/create-from-cart:
 *   post:
 *     summary: Create payment from cart (uses saved shipping address)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No body required - uses user's saved shipping address
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *       400:
 *         description: Cart is empty or shipping address not found
 *       404:
 *         description: User must save shipping address first
 */
// Cart-based PhonePe SDK routes
router.post('/create-from-cart', protect, paymentLimiter, paymentController.createPaymentFromCart);
router.get('/check-status', protect, paymentStatusLimiter, paymentController.checkStatus);

if (process.env.NODE_ENV !== 'production') {
    router.get('/simulate', paymentController.simulatePayment);
}

// Existing PhonePe routes (for backward compatibility)
// router.post('/phonepe/initiate', protect, paymentController.initiatePhonePePayment);
// router.post('/phonepe/callback', paymentController.phonePeCallback);
router.get('/phonepe/status/:merchantTransactionId', protect, paymentStatusLimiter, paymentController.phonePeStatus);

// Webhook routes (NO AUTH - PhonePe calls these directly)
router.post('/phonepe/webhook', (req, res) => paymentController.phonePeWebhookHandler(req, res));
router.post('/phonepe/webhook-legacy', (req, res) => paymentController.phonePeWebhook(req, res)); // 410 Gone

// Test route for PhonePe payment initiation
router.post('/phonepe/initiate', protect, paymentLimiter, initiatePhonePePayment);
// Test route for creating payment for an order
router.post('/phonepe/create-payment-for-order', protect, paymentLimiter, createPaymentForOrder);

router.post('/phonepe/create-payment-for-pre-order', paymentLimiter, paymentController.createPaymentForPreOrder);
router.get('/phonepe/pre-order-status', paymentStatusLimiter, paymentController.checkPreOrderPaymentStatus);
router.get('/phonepe/status', protect, paymentStatusLimiter, paymentController.checkStatus);

// Callback routes
router.post('/phonepe/callback', protect, handlePhonePeCallback);

// ========== Razorpay Routes ==========
/**
 * @swagger
 * /api/v1/payments/razorpay/create-from-cart:
 *   post:
 *     summary: Create Razorpay payment from cart
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shippingAddressId:
 *                 type: string
 *               billingAddressId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Razorpay payment order created successfully
 *       400:
 *         description: Cart is empty or invalid address
 */
router.post('/razorpay/create-from-cart', protect, paymentLimiter, paymentController.createRazorpayPaymentFromCart);

/**
 * @swagger
 * /api/v1/payments/razorpay/verify:
 *   get:
 *     summary: Verify Razorpay payment (GET - for callback URLs with query params)
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: razorpay_payment_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: razorpay_payment_link_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: razorpay_order_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: razorpay_signature
 *         schema:
 *           type: string
 *       - in: query
 *         name: merchantOrderId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *       400:
 *         description: Invalid payment signature
 *   post:
 *     summary: Verify Razorpay payment (POST - for JSON body)
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - razorpay_order_id
 *               - razorpay_payment_id
 *               - razorpay_signature
 *             properties:
 *               razorpay_order_id:
 *                 type: string
 *               razorpay_payment_id:
 *                 type: string
 *               razorpay_signature:
 *                 type: string
 *               merchantOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *       400:
 *         description: Invalid payment signature
 */
// Support both GET (query params from callback) and POST (JSON body)
router.get('/razorpay/verify', optionalProtect, paymentStatusLimiter, paymentController.verifyRazorpayPayment);
router.post('/razorpay/verify', protect, paymentStatusLimiter, paymentController.verifyRazorpayPayment);

/**
 * @swagger
 * /api/v1/payments/razorpay/status:
 *   get:
 *     summary: Check Razorpay payment status
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *         description: Razorpay order ID
 *       - in: query
 *         name: merchantOrderId
 *         schema:
 *           type: string
 *         description: Merchant order ID
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 */
// router.get('/razorpay/status', protect, paymentController.checkRazorpayPaymentStatus);

/**
 * @swagger
 * /api/v1/payments/razorpay/webhook:
 *   post:
 *     summary: Razorpay webhook endpoint (NO AUTH - Razorpay calls directly)
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Webhook received successfully
 */
// Webhook routes (NO AUTH - Razorpay calls these directly)
// Note: express.raw() is applied in server.js for this route to preserve raw body buffer
router.post('/razorpay/webhook', paymentController.razorpayWebhook);

/**
 * @swagger
 * /api/v1/payments/razorpay/create-for-pre-order:
 *   post:
 *     summary: Create Razorpay payment for pre-order
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - preOrderId
 *             properties:
 *               amount:
 *                 type: number
 *               preOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Razorpay payment order created for pre-order
 */
router.post('/razorpay/create-for-pre-order', paymentLimiter, paymentController.createRazorpayPaymentForPreOrder);

// delete it after testing (guarded in non-production)
if (process.env.NODE_ENV !== 'production') {
    router.post('/razorpay/test', razorpayPaymentTest);
    router.get('/razorpay/verify-test', razorpayPaymentLinkVerifyTest);
}

// ========== Paytm Routes ==========
/**
 * @swagger
 * /api/v1/payments/paytm/create-from-cart:
 *   post:
 *     summary: Create Paytm payment from cart (initiates Paytm hosted checkout)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shippingAddressId:
 *                 type: string
 *               billingAddressId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Paytm transaction initiated, returns txnToken and checkoutUrl
 *       400:
 *         description: Cart empty or invalid address
 */
router.post('/paytm/create-from-cart', protect, paymentLimiter, paymentController.createPaytmPaymentFromCart);

/**
 * @swagger
 * /api/v1/payments/paytm/create-for-pre-order:
 *   post:
 *     summary: Create Paytm payment for pre-order
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - preOrderId
 *             properties:
 *               amount:
 *                 type: number
 *               preOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Paytm transaction initiated for pre-order
 */
router.post('/paytm/create-for-pre-order', paymentLimiter, paymentController.createPaytmPaymentForPreOrder);

/**
 * @swagger
 * /api/v1/payments/paytm/status:
 *   get:
 *     summary: Check Paytm payment / order status
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Merchant orderId used during payment initiation
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 */
router.get('/paytm/status', protect, paymentStatusLimiter, paymentController.checkPaytmPaymentStatus);

/**
 * @swagger
 * /api/v1/payments/paytm/callback:
 *   post:
 *     summary: Paytm payment callback / redirect handler (called by Paytm after payment)
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Callback processed
 */
// Paytm sends a POST with form-encoded body to the callbackUrl after payment.
// No auth middleware — Paytm calls this directly.
router.post('/paytm/callback', paymentController.paytmCallback);

/**
 * @swagger
 * /api/v1/payments/paytm/webhook:
 *   post:
 *     summary: Paytm server-to-server webhook (NO AUTH — Paytm calls directly)
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Webhook received
 */
// Raw body is preserved via preserveRawBody middleware (webhook.js)
router.post('/paytm/webhook', paymentController.paytmWebhook);

module.exports = router;

