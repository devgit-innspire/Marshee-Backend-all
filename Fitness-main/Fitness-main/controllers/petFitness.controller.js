const PetFitness = require('../models/petFitness.model');
const { importExistingModels } = require('../utils/databaseConnection');

// Helper to parse BLE log lines like:
// I (207792) DogTracker: roll=169.08 pitch=38.20 temp=34.84 | steps=12 ...
function parseBleLogToFitness(logLines, attHandle) {
    const joined = Array.isArray(logLines) ? logLines.join(' ') : String(logLines || '');
    const numeric = (key) => {
        const m = joined.match(new RegExp(`${key}=(-?[0-9]+(?:\\.[0-9]+)?)`));
        return m ? Number(m[1]) : undefined;
    };
    const attFromTextMatch = joined.match(/att[_ ]?handle=(\\d+)/i);
    const attFromText = attFromTextMatch ? Number(attFromTextMatch[1]) : undefined;
    const counterMatch = joined.match(/I\\s*\\((\\d+)\\)/);
    const deviceCounter = counterMatch ? Number(counterMatch[1]) : undefined;
    
    return {
        raw: joined,
        attHandle: attHandle ?? attFromText,
        deviceCounter,
        roll: numeric('roll'),
        pitch: numeric('pitch'),
        temp: numeric('temp'),
        steps: numeric('steps'),
        shakes: numeric('shakes'),
        scratches: numeric('scratches'),
        jumps: numeric('jumps'),
        licks: numeric('licks'),
        freefalls: numeric('freefalls'),
        rest: numeric('rest'),
        walk: numeric('walk'),
        trot: numeric('trot'),
        run: numeric('run'),
        sprint: numeric('sprint'),
        rollplay: numeric('rollplay'),
        dig: numeric('dig'),
        limp: numeric('limp'),
        tailwags: numeric('tailwags'),
        stairs_up: numeric('stairs_up'),
        stairs_down: numeric('stairs_down'),
        sniff: numeric('sniff')
    };
}

// Create new fitness data entry
const createFitnessData = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const firebaseUID = req.user.firebaseUID;
        const { petId, lines, attHandle, capturedAt, deviceId, ...fitnessData } = req.body;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet belongs to user - support both ownerId and firebaseUID
        let pet;
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const petQuery = { _id: petId };
                if (ownerId && firebaseUID) {
                    petQuery.$or = [{ ownerId }, { firebaseUID }];
                } else if (ownerId) {
                    petQuery.ownerId = ownerId;
                } else if (firebaseUID) {
                    petQuery.firebaseUID = firebaseUID;
                }

                pet = await Pet.findOne(petQuery);
        if (!pet) {
            return res.status(404).json({
                success: false,
                message: 'Pet not found or access denied'
            });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Parse BLE data if lines are provided
        let parsedData = {};
        if (lines) {
            parsedData = parseBleLogToFitness(lines, attHandle);
        }

        // Use ownerId from pet if available, otherwise use req.user.id
        const finalOwnerId = (pet && (pet.owner || pet.ownerId)) ? (pet.owner || pet.ownerId) : ownerId;

        const fitnessEntry = await PetFitness.create({
            petId,
            ownerId: finalOwnerId,
            deviceId,
            timestamp: capturedAt ? new Date(capturedAt) : new Date(),
            ...parsedData,
            ...fitnessData
        });

        res.status(201).json({
            success: true,
            data: fitnessEntry
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get fitness data for a specific pet
const getPetFitnessData = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        const firebaseUID = req.user.firebaseUID;
        const { 
            page = 1, 
            limit = 50, 
            startDate, 
            endDate,
            sortBy = 'timestamp',
            sortOrder = 'desc'
        } = req.query;

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet belongs to user - support both ownerId and firebaseUID
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const petQuery = { _id: petId };
                if (ownerId && firebaseUID) {
                    petQuery.$or = [{ ownerId }, { firebaseUID }];
                } else if (ownerId) {
                    petQuery.ownerId = ownerId;
                } else if (firebaseUID) {
                    petQuery.firebaseUID = firebaseUID;
                }

                const pet = await Pet.findOne(petQuery);
        if (!pet) {
            return res.status(404).json({
                success: false,
                message: 'Pet not found or access denied'
            });
        }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Build query - PetFitness model uses ownerId, not firebaseUID
        const query = { petId };
        
        // Use ownerId for querying PetFitness data
        if (ownerId) {
            query.ownerId = ownerId;
        } else {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const fitnessData = await PetFitness.find(query)
            .populate('petId ownerId')
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await PetFitness.countDocuments(query);

        res.status(200).json({
            success: true,
            count: fitnessData.length,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: fitnessData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get all fitness data for a user (all pets)
const getAllUserFitnessData = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { 
            page = 1, 
            limit = 100, 
            startDate, 
            endDate,
            sortBy = 'timestamp',
            sortOrder = 'desc'
        } = req.query;

        // Build query - PetFitness model uses ownerId
        const query = {};
        
        if (ownerId) {
            query.ownerId = ownerId;
        } else {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const fitnessData = await PetFitness.find(query)
            .populate('petId ownerId')
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await PetFitness.countDocuments(query);

        res.status(200).json({
            success: true,
            count: fitnessData.length,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: fitnessData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get fitness statistics for a pet
const getPetFitnessStats = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        const firebaseUID = req.user.firebaseUID;
        const { days = 7 } = req.query;

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet belongs to user - support both ownerId and firebaseUID
        let pet;
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const petQuery = { _id: petId };
                if (ownerId && firebaseUID) {
                    petQuery.$or = [{ ownerId }, { firebaseUID }];
                } else if (ownerId) {
                    petQuery.ownerId = ownerId;
                } else if (firebaseUID) {
                    petQuery.firebaseUID = firebaseUID;
                }

                pet = await Pet.findOne(petQuery);
                if (!pet) {
                    // Pet not found - return empty stats instead of error
                    // This allows new users to see the dashboard with zero values
                    console.warn(`[PetFitness] Pet ${petId} not found, returning empty stats`);
                    return res.status(200).json({
                        success: true,
                        data: {
                            period: `${days} days`,
                            summary: {
                                totalCalories: 0,
                                totalWalk: 0,
                                totalRest: 0,
                                totalRecords: 0
                            },
                            dailyBreakdown: []
                        }
                    });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - parseInt(days));

        const stats = await PetFitness.aggregate([
            {
                $match: {
                    petId: pet ? pet._id : petId,
                    ownerId: ownerId,
                    timestamp: { $gte: dateFrom }
                }
            },
            {
                $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    avgRoll: { $avg: '$roll' },
                    avgPitch: { $avg: '$pitch' },
                    avgTemp: { $avg: '$temp' },
                    totalSteps: { $sum: '$steps' },
                    totalCalories: { $sum: '$calories' },
                    totalDistance: { $sum: '$distance' },
                    totalWalk: { $sum: '$walk' },
                    totalTrot: { $sum: '$trot' },
                    totalRun: { $sum: '$run' },
                    totalSprint: { $sum: '$sprint' },
                    totalRollplay: { $sum: '$rollplay' },
                    totalDig: { $sum: '$dig' },
                    totalTailwags: { $sum: '$tailwags' },
                    totalStairsUp: { $sum: '$stairs_up' },
                    totalStairsDown: { $sum: '$stairs_down' },
                    totalSniff: { $sum: '$sniff' },
                    totalRest: { $sum: '$rest' },
                    totalEefalls: { $sum: '$eefalls' },
                    totalLimp: { $sum: '$limp' },
                    minTemp: { $min: '$temp' },
                    maxTemp: { $max: '$temp' },
                    minRoll: { $min: '$roll' },
                    maxRoll: { $max: '$roll' },
                    minPitch: { $min: '$pitch' },
                    maxPitch: { $max: '$pitch' }
                }
            }
        ]);

        const dailyStats = await PetFitness.aggregate([
            {
                $match: {
                    petId: pet ? pet._id : petId,
                    ownerId: ownerId,
                    timestamp: { $gte: dateFrom }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$timestamp' },
                        month: { $month: '$timestamp' },
                        day: { $dayOfMonth: '$timestamp' }
                    },
                    date: { $first: '$timestamp' },
                    totalSteps: { $sum: '$steps' },
                    totalCalories: { $sum: '$calories' },
                    totalDistance: { $sum: '$distance' },
                    avgTemp: { $avg: '$temp' },
                    avgRoll: { $avg: '$roll' },
                    avgPitch: { $avg: '$pitch' },
                    totalActivity: { $sum: { $add: ['$walk', '$trot', '$run', '$sprint', '$rollplay', '$dig', '$tailwags', '$stairs_up', '$stairs_down', '$sniff'] } }
                }
            },
            {
                $sort: { date: 1 }
            }
        ]);

        res.status(200).json({
            success: true,
            data: {
                period: `${days} days`,
                summary: stats[0] || {},
                dailyBreakdown: dailyStats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get latest fitness data for a pet
const getLatestFitnessData = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        const firebaseUID = req.user.firebaseUID;

        // Import existing models
        const { Pet } = importExistingModels();

        // Verify pet belongs to user - support both ownerId and firebaseUID
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const petQuery = { _id: petId };
                if (ownerId && firebaseUID) {
                    petQuery.$or = [{ ownerId }, { firebaseUID }];
                } else if (ownerId) {
                    petQuery.ownerId = ownerId;
                } else if (firebaseUID) {
                    petQuery.firebaseUID = firebaseUID;
                }

                const pet = await Pet.findOne(petQuery);
        if (!pet) {
            return res.status(404).json({
                success: false,
                message: 'Pet not found or access denied'
            });
                }
            } catch (petError) {
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        const latestData = await PetFitness.findOne({ petId, ownerId })
            .populate('petId ownerId')
            .sort({ timestamp: -1 });

        if (!latestData) {
            return res.status(404).json({
                success: false,
                message: 'No fitness data found for this pet'
            });
        }

        res.status(200).json({
            success: true,
            data: latestData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update fitness data
const updateFitnessData = async (req, res) => {
    try {
        const { fitnessId } = req.params;
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        const fitnessData = await PetFitness.findOneAndUpdate(
            { _id: fitnessId, ownerId },
            req.body,
            { new: true, runValidators: true }
        );

        if (!fitnessData) {
            return res.status(404).json({
                success: false,
                message: 'Fitness data not found'
            });
        }

        res.status(200).json({
            success: true,
            data: fitnessData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete fitness data
const deleteFitnessData = async (req, res) => {
    try {
        const { fitnessId } = req.params;
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        const fitnessData = await PetFitness.findOneAndDelete({ 
            _id: fitnessId, 
            ownerId 
        });

        if (!fitnessData) {
            return res.status(404).json({
                success: false,
                message: 'Fitness data not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Fitness data deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createFitnessData,
    getPetFitnessData,
    getAllUserFitnessData,
    getPetFitnessStats,
    getLatestFitnessData,
    updateFitnessData,
    deleteFitnessData
};


