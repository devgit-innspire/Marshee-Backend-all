const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getCurrentUser,
    getUserPets,
    getUserDevices
} = require('../controllers/user.controller');

// All routes require authentication
router.use(auth);

// GET /api/v1/users/me - Get current user information
router.get('/me', getCurrentUser);

// GET /api/v1/users/pets - Get all pets for the current user
router.get('/pets', getUserPets);

// GET /api/v1/users/devices - Get all devices for all user's pets
router.get('/devices', getUserDevices);

module.exports = router;

