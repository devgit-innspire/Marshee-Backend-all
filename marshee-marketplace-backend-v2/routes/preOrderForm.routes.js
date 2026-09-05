const express = require('express');
const router = express.Router();
const contactController = require('../controllers/preOrderForm.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/preOrder:
 *   post:
 *     summary: Create a new pre-order
 *     tags: [Pre-Order]
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
 *               notes: { type: string }
 *     responses:
 *       201: { description: Pre-order created }
 *       400: { description: Validation error }
 */
router.post('/', contactController.createPreOrder);

/**
 * @swagger
 * /api/v1/preOrder:
 *   get:
 *     summary: Get all pre-orders with pagination and filtering
 *     tags: [Pre-Order]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: email
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, contacted, resolved, archived] }
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
 *       200: { description: List of pre-orders }
 */
router.get('/', protect, authorize('admin'), contactController.getAllPreOrders);

/**
 * @swagger
 * /api/v1/preOrder/stats:
 *   get:
 *     summary: Get pre-order statistics
 *     tags: [Pre-Order]
 *     responses:
 *       200: { description: Pre-order stats }
 */
router.get('/stats', protect, authorize('admin'), contactController.getPreOrderStats);

/**
 * @swagger
 * /api/v1/preOrder/{id}:
 *   get:
 *     summary: Get pre-order by ID
 *     tags: [Pre-Order]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pre-order details }
 *       404: { description: Pre-order not found }
 */
router.get('/:id', protect, authorize('admin'), contactController.getPreOrderById);

/**
 * @swagger
 * /api/v1/preOrder/{id}:
 *   put:
 *     summary: Update pre-order by ID
 *     tags: [Pre-Order]
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
 *       200: { description: Pre-order updated }
 *       404: { description: Pre-order not found }
 */
router.put('/:id', protect, authorize('admin'), contactController.updatePreOrder);

/**
 * @swagger
 * /api/v1/preOrder/{id}:
 *   delete:
 *     summary: Delete pre-order by ID
 *     tags: [Pre-Order]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pre-order deleted }
 *       404: { description: Pre-order not found }
 */
router.delete('/:id', protect, authorize('admin'), contactController.deletePreOrder);

module.exports = router;

