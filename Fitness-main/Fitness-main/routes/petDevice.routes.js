const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
    createDevice,
    getDevices,
    getDevice,
    updateDevice,
    deleteDevice
} = require('../controllers/petDevice.controller');

// All routes require authentication
router.use(protect);

// Device routes
router.route('/:petId/devices')
    .post(createDevice)
    .get(getDevices);

router.route('/:petId/devices/:deviceId')
    .get(getDevice)
    .put(updateDevice)
    .delete(deleteDevice);

module.exports = router;
