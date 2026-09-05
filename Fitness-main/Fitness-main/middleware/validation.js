const { body, validationResult } = require('express-validator');

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

// Pet Profile validation rules
const validatePetProfile = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('personality').optional().isIn(['Calm', 'Energetic', 'Playful', 'Shy', 'Aggressive', 'Friendly']).withMessage('Invalid personality type'),
    body('size').isIn(['Small', 'Medium', 'Large', 'Extra Large']).withMessage('Valid size is required'),
    body('weight').isNumeric().isFloat({ min: 0 }).withMessage('Valid weight is required'),
    body('color').notEmpty().withMessage('Color is required'),
    body('microchipId').optional().isString().withMessage('Microchip ID must be a string'),
    body('specialNeeds').optional().isLength({ max: 500 }).withMessage('Special needs cannot exceed 500 characters'),
    body('diet').optional().isLength({ max: 300 }).withMessage('Diet cannot exceed 300 characters'),
    body('groomingNeeds').optional().isLength({ max: 200 }).withMessage('Grooming needs cannot exceed 200 characters'),
    validate
];

// Pet Health validation rules
const validatePetHealth = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('vetName').notEmpty().withMessage('Vet name is required'),
    body('vetContact').notEmpty().withMessage('Vet contact is required'),
    body('lastCheckup').isISO8601().withMessage('Valid last checkup date is required'),
    body('nextCheckup').optional().isISO8601().withMessage('Valid next checkup date is required'),
    body('emergencyContact.name').optional().isString().withMessage('Emergency contact name must be a string'),
    body('emergencyContact.phone').optional().isString().withMessage('Emergency contact phone must be a string'),
    validate
];

// Pet Activity validation rules
const validatePetActivity = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('activityType').isIn(['Walk', 'Play', 'Feeding', 'Grooming', 'Training', 'Vet Visit', 'Other']).withMessage('Valid activity type is required'),
    body('duration').isNumeric().isInt({ min: 1 }).withMessage('Valid duration in minutes is required'),
    body('date').optional().isISO8601().withMessage('Valid date is required'),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
    body('location').optional().isLength({ max: 200 }).withMessage('Location cannot exceed 200 characters'),
    body('mood').optional().isIn(['Happy', 'Tired', 'Energetic', 'Calm', 'Anxious', 'Playful']).withMessage('Invalid mood type'),
    body('weather').optional().isIn(['Sunny', 'Cloudy', 'Rainy', 'Snowy', 'Windy']).withMessage('Invalid weather type'),
    validate
];

// Pet Vaccination validation rules
const validatePetVaccination = [
    body('petId').isMongoId().withMessage('Valid pet ID is required'),
    body('vaccineName').notEmpty().withMessage('Vaccine name is required'),
    body('vaccineType').isIn(['Core', 'Non-Core', 'Bordetella', 'Rabies', 'DHPP', 'FVRCP']).withMessage('Valid vaccine type is required'),
    body('administeredDate').isISO8601().withMessage('Valid administered date is required'),
    body('nextDueDate').isISO8601().withMessage('Valid next due date is required'),
    body('vetName').notEmpty().withMessage('Vet name is required'),
    body('batchNumber').optional().isString().withMessage('Batch number must be a string'),
    body('sideEffects').optional().isLength({ max: 300 }).withMessage('Side effects cannot exceed 300 characters'),
    validate
];

module.exports = {
    validate,
    validatePetProfile,
    validatePetHealth,
    validatePetActivity,
    validatePetVaccination
};


