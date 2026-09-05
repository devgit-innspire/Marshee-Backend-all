const express = require('express');
const router = express.Router();
const partnerController = require('../controllers/partner.controller');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/v1/partners:
 *   post:
 *     summary: Create a new partner
 *     tags: [Partners]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *               - contact
 *               - legal
 *               - banking
 *               - commission
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               contact:
 *                 type: object
 *               legal:
 *                 type: object
 *               banking:
 *                 type: object
 *               commission:
 *                 type: object
 *     responses:
 *       201:
 *         description: Partner created successfully
 */
router.post('/', partnerController.createPartner);

/**
 * @swagger
 * /api/v1/partners:
 *   get:
 *     summary: Get all partners
 *     tags: [Partners]
 *     responses:
 *       200:
 *         description: List of partners
 */
router.get('/', partnerController.getPartners);

// ========== PARTNER APPLICATION ROUTES ==========
// IMPORTANT: Specific routes must come BEFORE parameterized routes (/:id)

/**
 * @swagger
 * /api/v1/partners/apply:
 *   post:
 *     summary: Submit partner application (Seller applies)
 *     tags: [Partners]
 *     responses:
 *       201:
 *         description: Application submitted successfully
 */
router.post('/apply', partnerController.submitApplication);

// ========== ADMIN ROUTES ==========
// These specific routes must be defined BEFORE /:id route

/**
 * @swagger
 * /api/v1/partners/pending:
 *   get:
 *     summary: Get pending partners (Admin only)
 *     tags: [Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending partners
 */
router.get('/pending', protect, authorize('admin'), partnerController.getPendingPartners);

/**
 * @swagger
 * /api/v1/partners/status/{status}:
 *   get:
 *     summary: Get partners by verification status (Admin only)
 *     tags: [Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of partners by status
 */
router.get('/status/:status', protect, authorize('admin'), partnerController.getPartnersByStatus);

/**
 * @swagger
 * /api/v1/partners/stats:
 *   get:
 *     summary: Get partner statistics (Admin only)
 *     tags: [Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner statistics
 */
router.get('/stats', protect, authorize('admin'), partnerController.getPartnerStats);

// ========== PARTNER SELF-SERVICE ROUTES ==========
// Must be before /:id

/**
 * @route   POST /api/v1/partners/me/pickup-locations
 * @desc    Partner adds pickup location (saves in DB + creates on Shiprocket)
 * @access  Private (Partner)
 */
router.post('/me/pickup-locations', protect, authorize('partner'), partnerController.addMyPickupLocation.bind(partnerController));

/**
 * @route   GET /api/v1/partners/me/pickup-locations
 * @desc    Partner gets saved pickup locations from DB
 * @access  Private (Partner)
 */
router.get('/me/pickup-locations', protect, authorize('partner'), partnerController.getMyPickupLocations.bind(partnerController));

/**
 * @swagger
 * /api/v1/partners/{id}:
 *   get:
 *     summary: Get partner by ID
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Partner details
 */
router.get('/:id', partnerController.getPartner);

/**
 * @swagger
 * /api/v1/partners/{id}/approve:
 *   patch:
 *     summary: Approve partner application (Admin only)
 *     tags: [Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner approved, user created, email sent
 */
router.patch('/:id/approve', protect, authorize('admin'), partnerController.approvePartner);

/**
 * @swagger
 * /api/v1/partners/{id}/reject:
 *   patch:
 *     summary: Reject partner application (Admin only)
 *     tags: [Partners, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Partner rejected
 */
router.patch('/:id/reject', protect, authorize('admin'), partnerController.rejectPartner);

module.exports = router;
