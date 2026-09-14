const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');
const { validateCartAdd, validateCartUpdate, validateCartRemove, validateCartApplyCoupon, validateCartCheckoutPreferences } = require('../middleware/validation');
const { protect, authorize, requirePermission } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/cart:
 *   get:
 *     summary: Get user's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's cart details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 */
router.get('/', protect, cartController.getCart);

/**
 * @swagger
 * /api/v1/cart/merge:
 *   post:
 *     summary: Merge guest cart into user cart on login
 *     description: Batch-adds guest cart product items into the authenticated user's cart. Items with invalid IDs, missing products, or zero stock are silently skipped. Quantity is capped at available stock.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [productId, variantId, quantity]
 *                   properties:
 *                     productId: { type: string }
 *                     variantId: { type: string }
 *                     quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Merge complete; returns updated cart and count of items merged
 */
router.post('/merge', protect, cartController.mergeCart);

/**
 * @swagger
 * /api/v1/cart/add:
 *   post:
 *     summary: Add item to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartAddRequest'
 *     responses:
 *       200:
 *         description: Item added to cart successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 */
router.post('/add', protect, validateCartAdd, cartController.addToCart);

/**
 * @swagger
 * /api/v1/cart/update:
 *   put:
 *     summary: Update cart item quantity
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartUpdateRequest'
 *     responses:
 *       200:
 *         description: Cart item updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 */
router.put('/update', protect, validateCartUpdate, cartController.updateCartItem);

/**
 * @swagger
 * /api/v1/cart/remove:
 *   delete:
 *     summary: Remove item from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartRemoveRequest'
 *     responses:
 *       200:
 *         description: Item removed from cart successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 */
router.delete('/remove', protect, validateCartRemove, cartController.removeFromCart);

/**
 * @swagger
 * /api/v1/cart/clear:
 *   delete:
 *     summary: Clear entire cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully
 */
router.delete('/clear', protect, cartController.clearCart);

/**
 * @swagger
 * /api/v1/cart/apply-coupon:
 *   post:
 *     summary: Apply coupon to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApplyCouponRequest'
 *     responses:
 *       200:
 *         description: Coupon applied successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 */
router.post('/apply-coupon', protect, validateCartApplyCoupon, cartController.applyCoupon);

/**
 * @swagger
 * /api/v1/cart/remove-coupon:
 *   delete:
 *     summary: Remove coupon from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Coupon removed successfully
 */
router.delete('/remove-coupon', protect, cartController.removeCoupon);

/**
 * @swagger
 * /api/v1/cart/checkout-preferences:
 *   put:
 *     summary: Save checkout draft (instructions, payment method)
 *     description: Stores delivery instructions and/or payment method on the cart for the checkout page. Values are applied to the order when placing an order if not sent again on create order.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveryInstructions:
 *                 type: string
 *                 maxLength: 2000
 *               paymentMethod:
 *                 type: string
 *                 enum: [cod, online, wallet, upi]
 *     responses:
 *       200:
 *         description: Preferences saved; returns full cart
 */
router.put('/checkout-preferences', protect, validateCartCheckoutPreferences, cartController.saveCheckoutPreferences);

/**
 * @swagger
 * /api/v1/cart/add-service:
 *   post:
 *     summary: Add service to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceId
 *             properties:
 *               serviceId:
 *                 type: string
 *               quantity:
 *                 type: number
 *                 default: 1
 *               selectedExtras:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *               selectedDate:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Service added to cart successfully
 */
router.post('/add-service', protect, cartController.addServiceToCart);

/**
 * @swagger
 * /api/v1/cart/update-service:
 *   put:
 *     summary: Update service in cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceId
 *             properties:
 *               serviceId:
 *                 type: string
 *               quantity:
 *                 type: number
 *               selectedExtras:
 *                 type: array
 *               selectedDate:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Service updated in cart successfully
 */
router.put('/update-service', protect, cartController.updateServiceInCart);

/**
 * @swagger
 * /api/v1/cart/remove-service:
 *   delete:
 *     summary: Remove service from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceId
 *             properties:
 *               serviceId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Service removed from cart successfully
 */
router.delete('/remove-service', protect, cartController.removeServiceFromCart);

/**
 * @swagger
 * /api/v1/cart/admin/carts:
 *   get:
 *     summary: Get all carts for dashboard (admin)
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, abandoned, converted] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: q
 *         schema: { type: string, description: Search by user name/email/phoneNumber' }
 *     responses:
 *       200:
 *         description: Dashboard carts list with user details
 */
router.get('/admin/carts', protect, requirePermission('cartleads.view'), cartController.getDashboardCarts);


module.exports = router;
