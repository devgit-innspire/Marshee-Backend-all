const express = require('express');
const router = express.Router();

const deviceController = require('../controllers/device.controller');
const { protect, authorize, requirePermission } = require('../middleware/auth');

/**
 * Device registry.
 *
 * The firmware team (sub-admins) registers every unit here before it ships.
 * All read/write routes are open to staff (admin + subadmin); only a full
 * admin can delete a record, since that discards the unit's audit trail.
 */

/**
 * @swagger
 * /api/v1/devices:
 *   post:
 *     summary: Register a device (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imei, model]
 *             properties:
 *               imei: { type: string, description: 15-digit IMEI }
 *               serialNumber: { type: string }
 *               iccid: { type: string }
 *               msisdn: { type: string }
 *               model: { type: string }
 *               hardwareRevision: { type: string }
 *               firmwareVersion: { type: string }
 *               batchNumber: { type: string }
 *               manufacturedAt: { type: string, format: date }
 *               status: { type: string, enum: [registered, in_stock, assigned, activated, faulty, returned, decommissioned] }
 *               notes: { type: string }
 *               allowChecksumFailure: { type: boolean, description: Accept a non-Luhn test IMEI }
 *     responses:
 *       201: { description: Device registered }
 *       400: { description: Validation error }
 *       409: { description: IMEI or serial already registered }
 */
router.post('/', protect, requirePermission('devices.manage'), deviceController.createDevice);

/**
 * @swagger
 * /api/v1/devices/bulk:
 *   post:
 *     summary: Register up to 500 devices in one request (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [devices]
 *             properties:
 *               devices:
 *                 type: array
 *                 items: { type: object }
 *               allowChecksumFailure: { type: boolean }
 *     responses:
 *       201: { description: Per-row registered/failed breakdown }
 *       400: { description: Nothing could be registered }
 */
router.post('/bulk', protect, requirePermission('devices.manage'), deviceController.bulkCreateDevices);

/**
 * @swagger
 * /api/v1/devices/stats:
 *   get:
 *     summary: Device counts by status (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Totals and per-status counts }
 */
router.get('/stats', protect, requirePermission('devices.view', 'devices.manage'), deviceController.getDeviceStats);

/**
 * @swagger
 * /api/v1/devices/lookup/{imei}:
 *   get:
 *     summary: Look up a device by IMEI (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: imei
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device record }
 *       404: { description: Not registered }
 */
router.get('/lookup/:imei', protect, requirePermission('devices.view', 'devices.manage'), deviceController.lookupDeviceByImei);

/**
 * @swagger
 * /api/v1/devices:
 *   get:
 *     summary: List devices with filters (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches IMEI, serial, ICCID, MSISDN or batch
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: model
 *         schema: { type: string }
 *       - in: query
 *         name: batchNumber
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *     responses:
 *       200: { description: Paginated device list }
 */
router.get('/', protect, requirePermission('devices.view', 'devices.manage'), deviceController.getDevices);

/**
 * @swagger
 * /api/v1/devices/activate/{token}:
 *   get:
 *     summary: Resolve a scanned QR label (Public)
 *     description: >
 *       Called the moment a customer scans the label on their collar, before
 *       they have logged in. Returns the three identifiers the app needs to
 *       connect — MAC (BLE), IMEI (LTE module) and ICCID (SIM) — plus whether
 *       the unit has already been claimed. No owner details are exposed.
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device connection payload }
 *       404: { description: QR not recognised }
 *       410: { description: Device decommissioned }
 */
router.get('/activate/:token', deviceController.getActivationPayload);

/**
 * @swagger
 * /api/v1/devices/activate/{token}/claim:
 *   post:
 *     summary: Bind a scanned device to the signed-in customer (Private)
 *     description: >
 *       Run after the customer completes the normal phone-OTP login. Re-scanning
 *       a device you already own succeeds; scanning someone else's returns 409.
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               petId: { type: string, description: Optional pet to pair the collar with }
 *     responses:
 *       200: { description: Device activated }
 *       409: { description: Already registered to another account }
 */
router.post('/activate/:token/claim', protect, deviceController.claimDevice);

/**
 * @swagger
 * /api/v1/devices/qr/bulk:
 *   post:
 *     summary: Generate QR labels for every device that lacks one (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *               batchNumber: { type: string, description: Generate for a whole production batch }
 *               limit: { type: integer, default: 200 }
 *     responses:
 *       200: { description: Generated and skipped breakdown }
 */
router.post('/qr/bulk', protect, requirePermission('devices.manage'), deviceController.bulkGenerateDeviceQr);

/**
 * @swagger
 * /api/v1/devices/qr/labels:
 *   post:
 *     summary: Fetch print-ready label data for a set of devices (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Label payloads ready to render }
 */
router.post('/qr/labels', protect, requirePermission('devices.view', 'devices.manage'), deviceController.getQrLabels);

/**
 * @swagger
 * /api/v1/devices/qr/printed:
 *   post:
 *     summary: Record that labels were sent to a printer (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Print count updated }
 */
router.post('/qr/printed', protect, requirePermission('devices.manage'), deviceController.markQrPrinted);

/**
 * @swagger
 * /api/v1/devices/{id}/qr:
 *   post:
 *     summary: Generate or regenerate one device's QR label (Staff only)
 *     description: >
 *       Regenerating invalidates every label already printed for the unit, so
 *       it must be requested explicitly with regenerate:true.
 *     tags: [Devices]
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
 *               regenerate: { type: boolean }
 *     responses:
 *       200: { description: Label payload }
 *       400: { description: Device missing MAC address or ICCID }
 *       409: { description: Already has a QR — pass regenerate:true }
 */
router.post('/:id/qr', protect, requirePermission('devices.manage'), deviceController.generateDeviceQr);

/**
 * @swagger
 * /api/v1/devices/{id}:
 *   get:
 *     summary: Get one device including its status history (Staff only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device record }
 *       404: { description: Device not found }
 */
router.get('/:id', protect, requirePermission('devices.view', 'devices.manage'), deviceController.getDeviceById);

/**
 * @swagger
 * /api/v1/devices/{id}:
 *   put:
 *     summary: Update a device (Staff only). IMEI is immutable.
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device updated }
 *       400: { description: Validation error }
 *       404: { description: Device not found }
 */
router.put('/:id', protect, requirePermission('devices.manage'), deviceController.updateDevice);

/**
 * @swagger
 * /api/v1/devices/{id}:
 *   delete:
 *     summary: Delete a device record (Admin only)
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device deleted }
 *       403: { description: Admin only }
 *       404: { description: Device not found }
 */
router.delete('/:id', protect, authorize('admin'), deviceController.deleteDevice);

module.exports = router;
