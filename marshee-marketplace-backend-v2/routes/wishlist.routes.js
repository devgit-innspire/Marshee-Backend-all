const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlist.controller');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/wishlist:
 *   get:
 *     summary: Get user's wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's wishlist details
 */
router.get('/', protect, wishlistController.getWishlist);

/**
 * @swagger
 * /api/v1/wishlist/add:
 *   post:
 *     summary: Add item to wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *               notes:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *     responses:
 *       200:
 *         description: Item added to wishlist successfully
 */
router.post('/add', protect, wishlistController.addToWishlist);

/**
 * @swagger
 * /api/v1/wishlist/remove:
 *   delete:
 *     summary: Remove item from wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item removed from wishlist successfully
 */
router.delete('/remove', protect, wishlistController.removeFromWishlist);

/**
 * @swagger
 * /api/v1/wishlist/move-to-cart:
 *   post:
 *     summary: Move item from wishlist to cart
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item moved to cart successfully
 */
router.post('/move-to-cart', protect, wishlistController.moveToCart);

/**
 * @swagger
 * /api/v1/wishlist/update-item:
 *   put:
 *     summary: Update wishlist item
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *               notes:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *     responses:
 *       200:
 *         description: Wishlist item updated successfully
 */
router.put('/update-item', protect, wishlistController.updateWishlistItem);

/**
 * @swagger
 * /api/v1/wishlist/share:
 *   post:
 *     summary: Share wishlist with someone
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *               accessLevel:
 *                 type: string
 *                 enum: [view, edit]
 *     responses:
 *       200:
 *         description: Wishlist shared successfully
 */
router.post('/share', protect, wishlistController.shareWishlist);

/**
 * @swagger
 * /api/v1/wishlist/remove-share:
 *   delete:
 *     summary: Remove share access
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Share access removed successfully
 */
router.delete('/remove-share', protect, wishlistController.removeShare);

/**
 * @swagger
 * /api/v1/wishlist/settings:
 *   put:
 *     summary: Update wishlist settings
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isPublic:
 *                 type: boolean
 *               allowGifts:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Wishlist settings updated successfully
 */
router.put('/settings', protect, wishlistController.updateWishlistSettings);

/**
 * @swagger
 * /api/v1/wishlist/shared/{token}:
 *   get:
 *     summary: Get shared wishlist by token (No auth required)
 *     tags: [Wishlist]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shared wishlist details
 */
router.get('/shared/:token', wishlistController.getSharedWishlist);

module.exports = router;
