const express = require('express');
const router = express.Router();
const { 
    createFitnessData,
    getPetFitnessData,
    getAllUserFitnessData,
    getPetFitnessStats,
    getLatestFitnessData,
    updateFitnessData,
    deleteFitnessData
} = require('../controllers/petFitness.controller');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
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

// Pet Fitness validation rules
const validatePetFitness = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
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
    body('roll').isNumeric().withMessage('Roll value must be a number'),
    body('pitch').isNumeric().withMessage('Pitch value must be a number'),
    body('temp').isNumeric().withMessage('Temperature value must be a number'),
    body('eefalls').optional().isInt({ min: 0 }).withMessage('Eefalls must be a non-negative integer'),
    body('rest').optional().isInt({ min: 0 }).withMessage('Rest must be a non-negative integer'),
    body('walk').optional().isInt({ min: 0 }).withMessage('Walk must be a non-negative integer'),
    body('trot').optional().isInt({ min: 0 }).withMessage('Trot must be a non-negative integer'),
    body('run').optional().isInt({ min: 0 }).withMessage('Run must be a non-negative integer'),
    body('sprint').optional().isInt({ min: 0 }).withMessage('Sprint must be a non-negative integer'),
    body('rollplay').optional().isInt({ min: 0 }).withMessage('Rollplay must be a non-negative integer'),
    body('dig').optional().isInt({ min: 0 }).withMessage('Dig must be a non-negative integer'),
    body('limp').optional().isInt({ min: 0 }).withMessage('Limp must be a non-negative integer'),
    body('tailwags').optional().isInt({ min: 0 }).withMessage('Tailwags must be a non-negative integer'),
    body('stairs_up').optional().isInt({ min: 0 }).withMessage('Stairs up must be a non-negative integer'),
    body('stairs_down').optional().isInt({ min: 0 }).withMessage('Stairs down must be a non-negative integer'),
    body('sniff').optional().isInt({ min: 0 }).withMessage('Sniff must be a non-negative integer'),
    body('heartRate').optional().isInt({ min: 0 }).withMessage('Heart rate must be a non-negative integer'),
    body('steps').optional().isInt({ min: 0 }).withMessage('Steps must be a non-negative integer'),
    body('calories').optional().isNumeric().withMessage('Calories must be a number'),
    body('distance').optional().isNumeric().withMessage('Distance must be a number'),
    body('batteryLevel').optional().isInt({ min: 0, max: 100 }).withMessage('Battery level must be between 0 and 100'),
    validate
];

// All routes require authentication
router.use(auth);

// GET /api/v1/pet-fitness - Get all fitness data for user (all pets)
router.get('/', getAllUserFitnessData);

// GET /api/v1/pet-fitness/pet/:petId - Get fitness data for specific pet
router.get('/pet/:petId', getPetFitnessData);

// GET /api/v1/pet-fitness/pet/:petId/latest - Get latest fitness data for pet
router.get('/pet/:petId/latest', getLatestFitnessData);

// GET /api/v1/pet-fitness/pet/:petId/stats - Get fitness statistics for pet
router.get('/pet/:petId/stats', getPetFitnessStats);

// POST /api/v1/pet-fitness - Create new fitness data entry
router.post('/', validatePetFitness, createFitnessData);

// PUT /api/v1/pet-fitness/:fitnessId - Update fitness data
router.put('/:fitnessId', validatePetFitness, updateFitnessData);

// DELETE /api/v1/pet-fitness/:fitnessId - Delete fitness data
router.delete('/:fitnessId', deleteFitnessData);

module.exports = router;


