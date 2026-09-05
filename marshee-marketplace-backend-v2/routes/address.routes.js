const express = require('express');
const router = express.Router();
const addressController = require('../controllers/address.controller');
const { protect } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/addresses:
 *   post:
 *     summary: Create address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type: { type: string, enum: [shipping, billing] }
 *               fullName: { type: string }
 *               phone: { type: string }
 *               addressLine1: { type: string }
 *               addressLine2: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201: { description: Address created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', protect, addressController.createAddress);

/**
 * @swagger
 * /api/v1/addresses:
 *   get:
 *     summary: Get all addresses for current user
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [shipping, billing] }
 *     responses:
 *       200: { description: List of addresses }
 *       401: { description: Unauthorized }
 */
router.get('/', protect, addressController.getAllAddresses);

/**
 * @swagger
 * /api/v1/addresses/billing:
 *   get:
 *     summary: Get user's default billing address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Billing address }
 *       401: { description: Unauthorized }
 *       404: { description: No billing address }
 */
router.get('/billing', protect, addressController.getBillingAddress);

/**
 * @swagger
 * /api/v1/addresses/shipping:
 *   get:
 *     summary: Get user's shipping addresses
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of shipping addresses }
 *       401: { description: Unauthorized }
 */
router.get('/shipping', protect, addressController.getShippingAddresses);

/**
 * @swagger
 * /api/v1/addresses/me:
 *   get:
 *     summary: Get current user's addresses (all saved rows, excluding soft-deleted)
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: addressType
 *         schema: { type: string, enum: [home, office, other] }
 *     responses:
 *       200: { description: User addresses }
 *       401: { description: Unauthorized }
 */
router.get('/me', protect, addressController.getMyAddresses);

/**
 * @swagger
 * /api/v1/addresses/{id}:
 *   get:
 *     summary: Get address by ID
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address details }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.get('/:id', protect, addressController.getAddressById);

/**
 * @swagger
 * /api/v1/addresses/{id}:
 *   put:
 *     summary: Update address
 *     tags: [Addresses]
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
 *               fullName: { type: string }
 *               phone: { type: string }
 *               addressLine1: { type: string }
 *               addressLine2: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       200: { description: Address updated }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.put('/:id', protect, addressController.updateAddress);

/**
 * @swagger
 * /api/v1/addresses/{id}/default-shipping:
 *   patch:
 *     summary: Set as default shipping address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Default shipping set }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.patch('/:id/default-shipping', protect, addressController.setDefaultShippingAddress);

/**
 * @swagger
 * /api/v1/addresses/{id}/default-billing:
 *   patch:
 *     summary: Set as default billing address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Default billing set }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.patch('/:id/default-billing', protect, addressController.setDefaultBillingAddress);

/**
 * @swagger
 * /api/v1/addresses/{id}/soft-delete:
 *   patch:
 *     summary: Soft delete address (preferred)
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address soft deleted }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.patch('/:id/soft-delete', protect, addressController.softDeleteAddress);

/**
 * @swagger
 * /api/v1/addresses/{id}:
 *   delete:
 *     summary: Permanently delete address
 *     tags: [Addresses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address deleted }
 *       401: { description: Unauthorized }
 *       404: { description: Address not found }
 */
router.delete('/:id', protect, addressController.deleteAddress);

module.exports = router;
