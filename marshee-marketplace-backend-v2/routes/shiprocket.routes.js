const express = require('express');
const router = express.Router();
const shiprocketController = require('../controllers/shiprocket.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/shiprocket/login:
 *   post:
 *     summary: Login to Shiprocket and get access token
 *     tags: [Shiprocket]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Token returned (or uses env credentials) }
 *       401: { description: Login failed }
 */
router.post('/login', protect, shiprocketController.login);

/**
 * @swagger
 * /api/v1/shiprocket/serviceability:
 *   get:
 *     summary: Check serviceability – get available courier companies
 *     tags: [Shiprocket]
 *     parameters:
 *       - in: query
 *         name: order_id
 *         schema: { type: string }
 *         description: Shiprocket order ID (if provided, cod/weight not needed)
 *       - in: query
 *         name: pickup_postcode
 *         schema: { type: string }
 *         description: Pickup pincode (required if no order_id)
 *       - in: query
 *         name: delivery_postcode
 *         schema: { type: string }
 *         description: Delivery pincode (required if no order_id)
 *       - in: query
 *         name: weight
 *         schema: { type: number }
 *         description: Weight in kg (required if no order_id)
 *       - in: query
 *         name: cod
 *         schema: { type: boolean }
 *         description: Cash on delivery (required if no order_id)
 *     responses:
 *       200: { description: Available couriers }
 *       400: { description: Missing required params }
 */
router.get('/serviceability', protect, shiprocketController.checkServiceability);

/**
 * @swagger
 * /api/v1/shiprocket/check-delivery:
 *   get:
 *     summary: Predict delivery time for a product to a pincode
 *     tags: [Shiprocket]
 *     parameters:
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: delivery_postcode
 *         required: true
 *         schema: { type: string }
 *         description: 6-digit Indian pincode
 *       - in: query
 *         name: variantId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Delivery estimate }
 *       400: { description: Invalid product or pincode }
 */
router.get('/check-delivery', protect, shiprocketController.checkDelivery);

/**
 * @swagger
 * /api/v1/shiprocket/orders/create:
 *   post:
 *     summary: Create a custom (adhoc) order in Shiprocket
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               order_id: { type: string }
 *               channel_id: { type: string }
 *               billing_customer_name: { type: string }
 *               billing_address: { type: string }
 *               billing_city: { type: string }
 *               billing_state: { type: string }
 *               billing_pincode: { type: string }
 *               billing_phone: { type: string }
 *               order_date: { type: string }
 *               total: { type: number }
 *               payment_method: { type: string }
 *               items: { type: array }
 *     responses:
 *       200: { description: Order created in Shiprocket }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/orders/create', protect, authorize('admin'), shiprocketController.createOrder);

/**
 * @swagger
 * /api/v1/shiprocket/orders/cancel:
 *   post:
 *     summary: Cancel one or more orders in Shiprocket
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: integer } }
 *     responses:
 *       200: { description: Orders cancellation result }
 *       401: { description: Unauthorized }
 */
router.post('/orders/cancel', protect, authorize('admin'), shiprocketController.cancelOrder);

/**
 * @swagger
 * /api/v1/shiprocket/pickup-locations:
 *   get:
 *     summary: Get all pickup locations from Shiprocket account
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of pickup locations }
 *       401: { description: Unauthorized }
 */
router.get('/pickup-locations', protect, shiprocketController.getPickupLocations);

/**
 * @swagger
 * /api/v1/shiprocket/pickup-locations:
 *   post:
 *     summary: Add a pickup location in Shiprocket account
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pin: { type: string }
 *     responses:
 *       200: { description: Pickup location added }
 *       401: { description: Unauthorized }
 */
router.post('/pickup-locations', protect, authorize('admin'), shiprocketController.addPickupLocation);

/**
 * @swagger
 * /api/v1/shiprocket/orders/{order_id}:
 *   get:
 *     summary: Get order and shipment details by Shiprocket order ID
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order and shipment details }
 *       401: { description: Unauthorized }
 *       404: { description: Order not found }
 */
router.get('/orders/:order_id', protect, shiprocketController.getOrderById);

/**
 * @swagger
 * /api/v1/shiprocket/orders:
 *   get:
 *     summary: Get all Shiprocket orders with filters and pagination
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [ASC, DESC] }
 *       - in: query
 *         name: sort_by
 *         schema: { type: string, enum: [id, status] }
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *       - in: query
 *         name: filter_by
 *         schema: { type: string }
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: pickup_location
 *         schema: { type: string }
 *       - in: query
 *         name: channel_id
 *         schema: { type: string }
 *       - in: query
 *         name: updated_from
 *         schema: { type: string }
 *       - in: query
 *         name: updated_to
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of orders }
 *       401: { description: Unauthorized }
 */
router.get('/orders', protect, shiprocketController.getOrders);

/**
 * @swagger
 * /api/v1/shiprocket/courier/assign/awb:
 *   post:
 *     summary: Generate or assign AWB (Air Waybill) for a shipment
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shipment_id]
 *             properties:
 *               shipment_id: { type: integer }
 *               courier_id: { type: integer }
 *               status: { type: string }
 *     responses:
 *       200: { description: AWB assigned }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/courier/assign/awb', protect, authorize('admin'), shiprocketController.assignAWB);

/**
 * @swagger
 * /api/v1/shiprocket/courier/generate/pickup:
 *   post:
 *     summary: Request pickup for a shipment
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shipment_id]
 *             properties:
 *               shipment_id: { type: array, items: { type: integer } }
 *               status: { type: string }
 *               pickup_date: { type: array, items: { type: string, format: date } }
 *     responses:
 *       200: { description: Pickup requested }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/courier/generate/pickup', protect, authorize('admin'), shiprocketController.requestPickup);

/**
 * @swagger
 * /api/v1/shiprocket/courier/track/awb/{awb_code}:
 *   get:
 *     summary: Get tracking details by AWB code
 *     tags: [Shiprocket]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: awb_code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tracking details }
 *       401: { description: Unauthorized }
 *       404: { description: AWB not found }
 */
router.get('/courier/track/awb/:awb_code', protect, shiprocketController.trackByAWB);


module.exports = router;

