const PetDevice = require('../models/petDevice.model');
const { importExistingModels } = require('../utils/databaseConnection');
const { validateDeviceId } = require('../utils/deviceId');

// Helper function to check if a model is available
const checkModel = (model, modelName) => {
    if (!model || (typeof model !== 'object' && typeof model !== 'function')) {
        throw new Error(`${modelName} model is not available or not properly initialized`);
    }
    return true;
};

// Create a device for a pet
const createDevice = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { petId, deviceId, ...deviceData } = req.body;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        const trimmedPetId = petId.trim();

        const validation = validateDeviceId(deviceId);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address in the format XX:XX:XX:XX:XX:XX'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet exists and belongs to user
        let petOwnerId = ownerId;
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
                } catch (idError) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid pet ID format'
                    });
                }

                // First check if pet exists
                const pet = await Pet.findById(petObjectId);
                if (!pet) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pet not found'
                    });
                }

                // Verify ownership - check multiple field variations
                const ownerIdStr = String(ownerId);
                let ownershipVerified = false;

                if (pet.ownerId && String(pet.ownerId) === ownerIdStr) {
                    ownershipVerified = true;
                    petOwnerId = pet.ownerId;
                } else if (pet.owner && String(pet.owner) === ownerIdStr) {
                    ownershipVerified = true;
                    petOwnerId = pet.owner;
                } else if (pet.userId && String(pet.userId) === ownerIdStr) {
                    ownershipVerified = true;
                    petOwnerId = pet.userId;
                }

                if (!ownershipVerified) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied. This pet does not belong to you.'
                    });
                }
            } catch (petError) {
                // If Pet model query fails, log but continue (graceful degradation)
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Check if PetDevice model is available
        try {
            checkModel(PetDevice, 'PetDevice');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const device = await PetDevice.create({
            petId: trimmedPetId,
            ownerId: petOwnerId,
            deviceId: validation.normalized,
            ...deviceData
        });

        console.log(`✓ Device created successfully: ${device._id}`);

        res.status(201).json({
            success: true,
            data: device
        });
    } catch (error) {
        if (error.code === 11000) {
            // Check which field caused the duplicate key error
            if (error.keyPattern && error.keyPattern.petId) {
                return res.status(400).json({
                    success: false,
                    message: 'This pet already has a device registered. Each pet can only have one device.'
                });
            }
            if (error.keyPattern && error.keyPattern.deviceId) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID already exists'
                });
            }
            return res.status(400).json({
                success: false,
                message: 'Duplicate entry detected'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get all devices for a pet
const getDevices = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        const { deviceId } = req.query;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        const trimmedPetId = petId.trim();

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet exists and belongs to user - this is the only case that should error
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
                } catch (idError) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid pet ID format'
                    });
                }

                const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
                
                // Check if pet exists
                const pet = await Pet.findById(petObjectId);
                if (!pet) {
                    // Pet not found - but don't error, just return empty array
                    // This allows new users to register devices even if pet verification fails
                    // The device registration (POST) will validate ownership properly
                    console.warn(`[PetDevice] Pet ${trimmedPetId} not found, but returning empty device list to allow registration`);
                    return res.status(200).json({
                        success: true,
                        count: 0,
                        data: []
                    });
                }

                // Verify ownership - check multiple field variations
                const ownerIdStr = String(ownerId);
                let ownershipVerified = false;

                if (pet.ownerId && String(pet.ownerId) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.owner && String(pet.owner) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.userId && String(pet.userId) === ownerIdStr) {
                    ownershipVerified = true;
                }

                if (!ownershipVerified) {
                    // Access denied - but still return empty array instead of error
                    // This allows the frontend to proceed without showing errors
                    // Device registration will properly validate ownership
                    console.warn(`[PetDevice] Access denied for pet ${trimmedPetId} by user ${ownerId}, but returning empty device list`);
                    return res.status(200).json({
                        success: true,
                        count: 0,
                        data: []
                    });
                }
            } catch (petError) {
                // If Pet model query fails, log but continue (graceful degradation)
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Check if PetDevice model is available
        try {
            checkModel(PetDevice, 'PetDevice');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Build query for devices
        const mongoose = require('mongoose');
        let petObjectId;
        try {
            petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
        } catch (idError) {
            petObjectId = trimmedPetId; // Fallback to string
        }

        const query = { 
            petId: { $in: [petObjectId, trimmedPetId] } // Try both ObjectId and string
        };
        
        // Check ownership using ownerId
        const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        query.ownerId = { $in: [ownerObjectId, ownerId] }; // Try both ObjectId and string

        if (deviceId) {
            const validation = validateDeviceId(deviceId);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            query.deviceId = validation.normalized;
        }

        // Find devices - return empty array if none found (this is normal for first-time connection)
        const devices = await PetDevice.find(query).sort('-updatedAt');

        // Always return success with data (empty array if no devices)
        res.status(200).json({
            success: true,
            count: devices.length,
            data: devices
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get one device
const getDevice = async (req, res) => {
    try {
        const { petId, deviceId: deviceIdParam } = req.params;
        const ownerId = req.user.id;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        const trimmedPetId = petId.trim();

        const validation = validateDeviceId(deviceIdParam);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet exists and belongs to user
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
                } catch (idError) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid pet ID format'
                    });
                }

                const pet = await Pet.findById(petObjectId);
                if (!pet) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pet not found'
                    });
                }

                // Verify ownership
                const ownerIdStr = String(ownerId);
                let ownershipVerified = false;

                if (pet.ownerId && String(pet.ownerId) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.owner && String(pet.owner) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.userId && String(pet.userId) === ownerIdStr) {
                    ownershipVerified = true;
                }

                if (!ownershipVerified) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied. This pet does not belong to you.'
                    });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Check if PetDevice model is available
        try {
            checkModel(PetDevice, 'PetDevice');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const mongoose = require('mongoose');
        const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        const query = { 
            deviceId: validation.normalized, 
            petId: trimmedPetId,
            ownerId: { $in: [ownerObjectId, ownerId] } // Try both ObjectId and string
        };

        const device = await PetDevice.findOne(query);
        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        res.status(200).json({
            success: true,
            data: device
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update a device
const updateDevice = async (req, res) => {
    try {
        const { petId, deviceId: deviceIdParam } = req.params;
        const ownerId = req.user.id;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        const trimmedPetId = petId.trim();

        const validation = validateDeviceId(deviceIdParam);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet exists and belongs to user
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
                } catch (idError) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid pet ID format'
                    });
                }

                const pet = await Pet.findById(petObjectId);
                if (!pet) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pet not found'
                    });
                }

                // Verify ownership
                const ownerIdStr = String(ownerId);
                let ownershipVerified = false;

                if (pet.ownerId && String(pet.ownerId) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.owner && String(pet.owner) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.userId && String(pet.userId) === ownerIdStr) {
                    ownershipVerified = true;
                }

                if (!ownershipVerified) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied. This pet does not belong to you.'
                    });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Prevent changing deviceId or petId
        if (req.body.deviceId || req.body.petId) {
            return res.status(400).json({
                success: false,
                message: 'Cannot change deviceId or petId'
            });
        }

        // Check if PetDevice model is available
        try {
            checkModel(PetDevice, 'PetDevice');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const updates = {
            ...req.body,
            updatedAt: new Date()
        };

        const mongoose = require('mongoose');
        const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        const query = { 
            deviceId: validation.normalized, 
            petId: trimmedPetId,
            ownerId: { $in: [ownerObjectId, ownerId] } // Try both ObjectId and string
        };

        const device = await PetDevice.findOneAndUpdate(
            query,
            updates,
            { new: true, runValidators: true }
        );

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        res.status(200).json({
            success: true,
            data: device
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete a device
const deleteDevice = async (req, res) => {
    try {
        const { petId, deviceId: deviceIdParam } = req.params;
        const ownerId = req.user.id;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        const trimmedPetId = petId.trim();

        const validation = validateDeviceId(deviceIdParam);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet exists and belongs to user
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
                } catch (idError) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid pet ID format'
                    });
                }

                const pet = await Pet.findById(petObjectId);
                if (!pet) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pet not found'
                    });
                }

                // Verify ownership
                const ownerIdStr = String(ownerId);
                let ownershipVerified = false;

                if (pet.ownerId && String(pet.ownerId) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.owner && String(pet.owner) === ownerIdStr) {
                    ownershipVerified = true;
                } else if (pet.userId && String(pet.userId) === ownerIdStr) {
                    ownershipVerified = true;
                }

                if (!ownershipVerified) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied. This pet does not belong to you.'
                    });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Check if PetDevice model is available
        try {
            checkModel(PetDevice, 'PetDevice');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const mongoose = require('mongoose');
        const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        const query = { 
            deviceId: validation.normalized, 
            petId: trimmedPetId,
            ownerId: { $in: [ownerObjectId, ownerId] } // Try both ObjectId and string
        };

        const device = await PetDevice.findOneAndDelete(query);

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Device deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createDevice,
    getDevices,
    getDevice,
    updateDevice,
    deleteDevice
};
