const { importExistingModels } = require('../utils/databaseConnection');
const PetDevice = require('../models/petDevice.model');

// Get current user information
const getCurrentUser = async (req, res) => {
    try {
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        // Import existing models
        const { User } = importExistingModels();

        if (!User) {
            return res.status(500).json({
                success: false,
                message: 'User model not available'
            });
        }

        // Get user from database
        const user = await User.findById(ownerId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return user information (exclude sensitive data)
        const userObject = user.toObject ? user.toObject() : user;
        
        // Remove sensitive fields if needed
        delete userObject.password;
        delete userObject.__v;

        res.status(200).json({
            success: true,
            data: userObject
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user information',
            error: error.message
        });
    }
};

// Get all pets for the current user
const getUserPets = async (req, res) => {
    try {
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        if (!Pet) {
            return res.status(500).json({
                success: false,
                message: 'Pet model not available'
            });
        }

        const mongoose = require('mongoose');
        const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

        // Find all pets for this user - check multiple owner field variations
        const pets = await Pet.find({
            $or: [
                { ownerId: ownerObjectId },
                { owner: ownerObjectId },
                { userId: ownerObjectId }
            ]
        }).sort({ createdAt: -1 }); // Sort by newest first

        res.status(200).json({
            success: true,
            count: pets.length,
            data: pets
        });
    } catch (error) {
        console.error('Error fetching user pets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user pets',
            error: error.message
        });
    }
};

// Get all devices for all user's pets
const getUserDevices = async (req, res) => {
    try {
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        console.log(`=== GETTING DEVICES FOR USER ${ownerId} ===`);

        // Check if PetDevice model is available
        if (!PetDevice) {
            return res.status(500).json({
                success: false,
                message: 'PetDevice model not available'
            });
        }

        const mongoose = require('mongoose');
        let ownerObjectId;
        try {
            ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        } catch (e) {
            console.warn('Could not convert ownerId to ObjectId, using string:', ownerId);
        }

        // Try multiple query formats
        let devices = [];
        
        // First, try with ObjectId
        if (ownerObjectId) {
            devices = await PetDevice.find({ ownerId: ownerObjectId })
                .sort('-updatedAt')
                .populate('petId', 'name type');
            console.log(`Found ${devices.length} devices with ownerId as ObjectId`);
        }

        // If no devices found, try with string
        if (devices.length === 0) {
            devices = await PetDevice.find({ ownerId: ownerId })
                .sort('-updatedAt')
                .populate('petId', 'name type');
            console.log(`Found ${devices.length} devices with ownerId as string`);
        }

        // Debug: Check all devices in database (for debugging)
        const allDevices = await PetDevice.find({}).limit(10);
        console.log(`Total devices in database: ${allDevices.length}`);
        if (allDevices.length > 0) {
            console.log('Sample device:', {
                _id: allDevices[0]._id,
                ownerId: allDevices[0].ownerId,
                ownerIdType: typeof allDevices[0].ownerId,
                ownerIdString: String(allDevices[0].ownerId),
                petId: allDevices[0].petId,
                deviceId: allDevices[0].deviceId
            });
            console.log(`User ID: ${ownerId}, User ID Type: ${typeof ownerId}`);
            console.log(`Match check:`, String(allDevices[0].ownerId) === String(ownerId));
        }

        // Also check if user has pets and get devices by petId
        const { Pet } = importExistingModels();
        if (Pet) {
            const ownerObjId = ownerObjectId || new mongoose.Types.ObjectId(ownerId);
            const userPets = await Pet.find({
                $or: [
                    { ownerId: ownerObjId },
                    { owner: ownerObjId },
                    { userId: ownerObjId }
                ]
            }).select('_id name');
            
            console.log(`User has ${userPets.length} pets`);
            if (userPets.length > 0) {
                const petIds = userPets.map(p => p._id);
                console.log(`Pet IDs:`, petIds);
                
                // Try to find devices by petId
                const devicesByPet = await PetDevice.find({ petId: { $in: petIds } })
                    .sort('-updatedAt')
                    .populate('petId', 'name type');
                console.log(`Found ${devicesByPet.length} devices by petId`);
                
                if (devicesByPet.length > 0 && devices.length === 0) {
                    devices = devicesByPet;
                }
            }
        }

        console.log(`=== RETURNING ${devices.length} DEVICES ===`);

        res.status(200).json({
            success: true,
            count: devices.length,
            data: devices
        });
    } catch (error) {
        console.error('Error fetching user devices:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user devices',
            error: error.message
        });
    }
};

module.exports = {
    getCurrentUser,
    getUserPets,
    getUserDevices
};

