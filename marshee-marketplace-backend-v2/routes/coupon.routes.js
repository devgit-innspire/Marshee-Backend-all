const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');

// 10 validation attempts per 10 min per IP
const couponLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    message: { success: false, message: 'Too many coupon validation attempts. Please try again in 10 minutes.' },
});

/**
 * @swagger
 * /api/v1/coupons:
 *   post:
 *     summary: Create a new coupon (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - name
 *               - discountType
 *               - discountValue
 *               - validFrom
 *               - validUntil
 *             properties:
 *               code:
 *                 type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               discountType:
 *                 type: string
 *                 enum: [percentage, fixed, free_shipping]
 *               discountValue:
 *                 type: number
 *               maxUsage:
 *                 type: number
 *               minimumOrderAmount:
 *                 type: number
 *               maximumDiscountAmount:
 *                 type: number
 *               validFrom:
 *                 type: string
 *                 format: date
 *               validUntil:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Coupon created successfully
 */
router.post('/', protect, authorize('admin'), couponController.createCoupon);

/**
 * @swagger
 * /api/v1/coupons:
 *   get:
 *     summary: Get all coupons (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (active/inactive)
 *       - in: query
 *         name: discountType
 *         schema:
 *           type: string
 *         description: Filter by discount type
 *     responses:
 *       200:
 *         description: List of coupons
 */
router.get('/', protect, authorize('admin'), couponController.getAllCoupons);

/**
 * @swagger
 * /api/v1/coupons/landing-page-login:
 *   post:
 *     summary: Landing page phone login + generate 15-minute coupon
 *     description: Verifies Firebase phone OTP, logs in or registers the user, and generates a unique 15% discount coupon valid for 15 minutes.
 *     tags: [Coupons, Auth]
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *         description: "Bearer <Firebase ID Token>"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               avatar: { type: string }
 *     responses:
 *       200:
 *         description: User logged in and coupon generated
 *       401:
 *         description: Invalid or expired Firebase token
 */
router.post('/landing-page-login', couponController.landingPagePhoneLogin);

/**
 * @swagger
 * /api/v1/coupons/my-landing-coupon:
 *   get:
 *     summary: Get the logged-in user's active landing page coupon
 *     description: Returns the user's unique 15-minute coupon if still valid, along with remaining seconds.
 *     tags: [Coupons]
 *     responses:
 *       200:
 *         description: Active coupon found (or null data when no coupon is active)
 */
router.get('/my-landing-coupon', optionalProtect, couponController.getMyLandingPageCoupon);

/**
 * @swagger
 * /api/v1/coupons/public:
 *   get:
 *     summary: Get public coupons (No auth required)
 *     tags: [Coupons]
 *     responses:
 *       200:
 *         description: List of public coupons
 */
router.get('/public', couponController.getPublicCoupons);

/**
 * @swagger
 * /api/v1/coupons/validate:
 *   post:
 *     summary: Validate a coupon code
 *     tags: [Coupons]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - orderAmount
 *             properties:
 *               code:
 *                 type: string
 *               orderAmount:
 *                 type: number
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Coupon validation result
 */
router.post('/validate', optionalProtect, couponLimiter, couponController.validateCoupon);

/**
 * @swagger
 * /api/v1/coupons/{id}:
 *   get:
 *     summary: Get coupon by ID (Admin only)
 *     tags: [Coupons]
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
 *         description: Coupon details
 */
router.get('/:id', protect, authorize('admin'), couponController.getCouponById);

/**
 * @swagger
 * /api/v1/coupons/{id}:
 *   put:
 *     summary: Update coupon (Admin only)
 *     tags: [Coupons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Coupon updated successfully
 */
router.put('/:id', protect, authorize('admin'), couponController.updateCoupon);

/**
 * @swagger
 * /api/v1/coupons/{id}:
 *   delete:
 *     summary: Delete coupon (Admin only)
 *     tags: [Coupons]
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
 *         description: Coupon deleted successfully
 */
router.delete('/:id', protect, authorize('admin'), couponController.deleteCoupon);

module.exports = router;
