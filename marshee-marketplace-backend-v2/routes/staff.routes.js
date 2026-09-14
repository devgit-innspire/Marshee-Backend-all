const express = require('express');
const router = express.Router();

const staffController = require('../controllers/staff.controller');
const { protect, authorize } = require('../middleware/auth');

// Staff management is full-admin-only: sub-admins can never create,
// deactivate or delete another staff account.
router.use(protect, authorize('admin'));

/**
 * @swagger
 * /api/v1/staff:
 *   get:
 *     summary: List all staff accounts (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Admins and sub-admins, with invite status }
 *       403: { description: Admin only }
 */
/**
 * @swagger
 * /api/v1/staff/permissions:
 *   get:
 *     summary: The permission catalogue used to build the grant UI (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Grouped permissions plus the default starter set }
 */
router.get('/permissions', staffController.getPermissionCatalogue);

router.get('/', staffController.getStaff);

/**
 * @swagger
 * /api/v1/staff:
 *   post:
 *     summary: Create a sub-admin and email a password-setup link (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       201: { description: Sub-admin created }
 *       400: { description: Validation error }
 *       409: { description: Email already registered }
 */
router.post('/', staffController.createSubadmin);

/**
 * @swagger
 * /api/v1/staff/{id}/resend-invite:
 *   post:
 *     summary: Resend the password-setup email to a sub-admin (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Setup email resent }
 *       400: { description: Password already set }
 *       404: { description: Staff account not found }
 */
router.post('/:id/resend-invite', staffController.resendInvite);

/**
 * @swagger
 * /api/v1/staff/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a staff account (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Status updated }
 *       400: { description: Invalid request (e.g. last active admin) }
 *       404: { description: Staff account not found }
 */
router.patch('/:id/status', staffController.setStaffStatus);

/**
 * @swagger
 * /api/v1/staff/{id}:
 *   delete:
 *     summary: Delete a sub-admin account (Admin only)
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sub-admin deleted }
 *       400: { description: Not a sub-admin account }
 *       404: { description: Staff account not found }
 */
/**
 * @swagger
 * /api/v1/staff/{id}/permissions:
 *   patch:
 *     summary: Replace a sub-admin's permission set (Admin only)
 *     description: >
 *       Sends the complete set, not a delta — anything omitted is revoked.
 *       Admins cannot be restricted this way; they hold everything implicitly.
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permissions]
 *             properties:
 *               permissions:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200: { description: Permissions updated }
 *       400: { description: Unknown permission key, or target is a full admin }
 *       404: { description: Staff account not found }
 */
router.patch('/:id/permissions', staffController.setStaffPermissions);

router.delete('/:id', staffController.deleteSubadmin);

module.exports = router;
