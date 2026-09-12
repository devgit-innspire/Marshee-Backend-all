const express = require('express');
const router = express.Router();
const { 
    createFitnessSession,
    createFitnessSessionFromJson,
    getPetFitnessSessions,
    getFitnessSessionData,
    getPetFitnessSessionStats,
    getLatestFitnessSession,
    deleteFitnessSession,
    getAllFitnessSessionsCSV,
    getFitnessSessionsByPetFilters,
    getCalorieBurnFromSession,
    calculateCalorieBurn,
    getRERInfo
} = require('../controllers/petFitnessSession.controller');
const auth = require('../middleware/auth');
const { body, query, validationResult } = require('express-validator');
const { validateDeviceId } = require('../utils/deviceId');

// Validation middleware
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

// Fitness Session validation rules
const validateFitnessSession = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('activityCsv').notEmpty().withMessage('Activity CSV data is required'),
    body('deviceId').custom((value, { req }) => {
        if (req.method === 'POST' && !value) {
            throw new Error('Device ID is required');
        }
        if (value === undefined || value === null || value === '') {
            return true;
        }
        const validation = validateDeviceId(value);
        if (!validation.isValid) {
            throw new Error('Device ID must be a valid BLE/MAC address (XX:XX:XX:XX:XX:XX)');
        }
        req.body.deviceId = validation.normalized;
        return true;
    }),
    body('sampleRateHz').optional().isInt({ min: 1, max: 1000 }).withMessage('Sample rate must be between 1 and 1000 Hz'),
    body('startTsMs').optional().isNumeric().withMessage('Start timestamp must be a number'),
    body('endTsMs').optional().isNumeric().withMessage('End timestamp must be a number'),
    body('firmwareVersion').optional().isString().withMessage('Firmware version must be a string'),
    body('receivedAt').optional().isISO8601().withMessage('Received date must be a valid ISO 8601 date'),
    validate
];

// JSON Activity Data validation rules (for mobile app)
const validateJsonActivityData = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('deviceId').notEmpty().withMessage('Device ID is required'),
    body('activityData').isArray().withMessage('Activity data must be an array'),
    body('activityData.*').isString().withMessage('Each activity data row must be a string'),
    body('sampleRateHz').optional().isInt({ min: 1, max: 1000 }).withMessage('Sample rate must be between 1 and 1000 Hz'),
    body('timestamp').optional().isISO8601().withMessage('Timestamp must be a valid ISO 8601 date'),
    body('windowStart').optional().isNumeric().withMessage('Window start must be a number'),
    body('windowEnd').optional().isNumeric().withMessage('Window end must be a number'),
    validate
];

// Calorie burn validation rules
const validateWeightQuery = [
    query('weightKg').isFloat({ min: 0.1, max: 200 }).withMessage('weightKg must be a positive number between 0.1 and 200 kg'),
    query('useMultiplier').optional().isIn(['min', 'max', 'default']).withMessage('useMultiplier must be min, max, or default'),
    validate
];

const validateCalculateCalorieBurn = [
    body('petId').notEmpty().withMessage('petId is required'),
    body('weightKg').isFloat({ min: 0.1, max: 200 }).withMessage('weightKg must be a positive number between 0.1 and 200 kg'),
    body('metrics').isObject().withMessage('metrics must be an object'),
    body('sampleRateHz').optional().isInt({ min: 1, max: 1000 }).withMessage('Sample rate must be between 1 and 1000 Hz'),
    body('useMultiplier').optional().isIn(['min', 'max', 'default']).withMessage('useMultiplier must be min, max, or default'),
    validate
];

// All routes require authentication
router.use(auth);

// GET /api/v1/pet-fitness-sessions/export/csv - Get all fitness sessions data in CSV format (own sessions only; admins can opt into all via includeAllUsers=true)
router.get('/export/csv', getAllFitnessSessionsCSV);

// GET /api/v1/pet-fitness-sessions/filter/pet - Get fitness sessions filtered by pet attributes (own sessions only; admins can opt into all via includeAllUsers=true)
router.get('/filter/pet', getFitnessSessionsByPetFilters);

// POST /api/v1/pet-fitness-sessions - Create new fitness session with CSV data
router.post('/', validateFitnessSession, createFitnessSession);

// POST /api/v1/pet-fitness-sessions/json - Create fitness session from JSON activity data (mobile app)
router.post('/json', validateJsonActivityData, createFitnessSessionFromJson);

// GET /api/v1/pet-fitness-sessions/pet/:petId - Get fitness sessions for specific pet
router.get('/pet/:petId', getPetFitnessSessions);

// GET /api/v1/pet-fitness-sessions/pet/:petId/latest - Get latest fitness session for pet
router.get('/pet/:petId/latest', getLatestFitnessSession);

// GET /api/v1/pet-fitness-sessions/pet/:petId/stats - Get fitness session statistics for pet
router.get('/pet/:petId/stats', getPetFitnessSessionStats);

// GET /api/v1/pet-fitness-sessions/calories/rer - Get RER information for a given weight
router.get('/calories/rer', validateWeightQuery, getRERInfo);

// POST /api/v1/pet-fitness-sessions/calories/calculate - Calculate calorie burn from provided metrics
router.post('/calories/calculate', validateCalculateCalorieBurn, calculateCalorieBurn);

// GET /api/v1/pet-fitness-sessions/:sessionId/calories - Calculate calorie burn from a fitness session
router.get('/:sessionId/calories', validateWeightQuery, getCalorieBurnFromSession);

// GET /api/v1/pet-fitness-sessions/:sessionId - Get specific fitness session with CSV data
router.get('/:sessionId', getFitnessSessionData);

// DELETE /api/v1/pet-fitness-sessions/:sessionId - Delete fitness session
router.delete('/:sessionId', deleteFitnessSession);

module.exports = router;
