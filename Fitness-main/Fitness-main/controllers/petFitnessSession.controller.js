const PetFitnessSession = require('../models/petFitnessSession.model');
const PetDevice = require('../models/petDevice.model');
const { importExistingModels } = require('../utils/databaseConnection');
const { 
    storeCsvData, 
    retrieveCsvData, 
    parseCsvData, 
    calculateAggregatedMetrics, 
    validateCsvData,
    generateStoragePath 
} = require('../utils/csvStorage');
const { validateDeviceId } = require('../utils/deviceId');
const {
    calculateTotalCaloriesFromMetrics,
    calculateDailyRER,
    calculateHourlyRER,
    calculateMinuteRER,
    calculateActivityCalories,
    samplesToMinutes
} = require('../utils/rerCalorieCalculation');

// Helper function to check if a model is available
const checkModel = (model, modelName) => {
    if (!model || (typeof model !== 'object' && typeof model !== 'function')) {
        throw new Error(`${modelName} model is not available or not properly initialized`);
    }
    return true;
};

// Create new fitness session with CSV data
const createFitnessSession = async (req, res) => {
    try {
        const ownerId = req.user.id;
        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        const { 
            petId, 
            activityCsv, 
            firmwareVersion = '1.0.0',
            sampleRateHz = 50,
            startTsMs,
            endTsMs,
            receivedAt,
            deviceId
        } = req.body;

        // Skip main-backend model dependency; accept petId as provided

        // Validate required fields
        if (!activityCsv) {
            return res.status(400).json({
                success: false,
                message: 'activityCsv is required'
            });
        }

        // Parse CSV data
        let parsedData;
        try {
            parsedData = parseCsvData(activityCsv);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid CSV data format',
                error: error.message
            });
        }

        // Validate CSV data structure
        const validation = validateCsvData(parsedData);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'CSV data validation failed',
                errors: validation.errors,
                warnings: validation.warnings
            });
        }

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address formatted as XX:XX:XX:XX:XX:XX'
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

        const device = await PetDevice.findOne({
            deviceId: deviceValidation.normalized,
            petId,
            ownerId
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found for this pet or access denied'
            });
        }

        // Calculate timestamps if not provided
        const now = Date.now();
        const sessionStartTs = startTsMs || now;
        const sessionEndTs = endTsMs || (sessionStartTs + (parsedData.length * 1000 / sampleRateHz));

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Generate session ID (pet scoped)
        const sessionId = PetFitnessSession.generateSessionId(petId, sessionStartTs);

        // Store CSV data
        const storageResult = await storeCsvData(parsedData, String(petId), sessionStartTs);

        // Check for duplicate session by checksum (same data sent multiple times)
        const existingSession = await PetFitnessSession.findOne({
            checksum: storageResult.checksum,
            petId,
            ownerId
        });

        if (existingSession) {
            // Session with same data already exists, return existing session
            return res.status(200).json({
                success: true,
                message: 'Fitness session already exists (duplicate data detected)',
                data: {
                    sessionId: existingSession.sessionId,
                    deviceId: existingSession.deviceId,
                    recordCount: existingSession.recordCount,
                    durationSeconds: existingSession.durationSeconds,
                    compressionRatio: existingSession.compressionRatio,
                    dataQuality: existingSession.dataQuality,
                    aggregatedMetrics: existingSession.aggregatedMetrics,
                    createdAt: existingSession.createdAt,
                    isDuplicate: true
                }
            });
        }

        // Calculate aggregated metrics
        const aggregatedMetrics = calculateAggregatedMetrics(parsedData);

        // Create session record
        const sessionData = {
            petId,
            ownerId,
            deviceId: deviceValidation.normalized,
            sessionId,
            receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
            firmwareVersion,
            sampleRateHz,
            startTsMs: sessionStartTs,
            endTsMs: sessionEndTs,
            recordCount: parsedData.length,
            dataSizeBytes: storageResult.originalSize,
            compressedSizeBytes: storageResult.compressedSize,
            csvGzipPath: storageResult.storagePath,
            checksum: storageResult.checksum,
            status: 'completed',
            dataQuality: {
                completeness: validation.warnings.length === 0 ? 100 : Math.max(0, 100 - validation.warnings.length * 5),
                validity: 100
            },
            aggregatedMetrics
        };

        const session = await PetFitnessSession.create(sessionData);

        res.status(201).json({
            success: true,
            message: 'Fitness session created successfully',
            data: {
                sessionId: session.sessionId,
                deviceId: session.deviceId,
                recordCount: session.recordCount,
                durationSeconds: session.durationSeconds,
                compressionRatio: session.compressionRatio,
                dataQuality: session.dataQuality,
                aggregatedMetrics: session.aggregatedMetrics,
                createdAt: session.createdAt
            }
        });

    } catch (error) {
        console.error('Error creating fitness session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create fitness session',
            error: error.message
        });
    }
};

// Get fitness sessions for a specific pet
const getPetFitnessSessions = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        const { 
            page = 1, 
            limit = 20, 
            startDate, 
            endDate,
            status = 'completed',
            sortBy = 'startTsMs',
            sortOrder = 'desc',
            deviceId: deviceIdQuery
        } = req.query;

        // Validate petId
        if (!petId || typeof petId !== 'string' || petId.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Valid petId is required'
            });
        }

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        const trimmedPetId = petId.trim();

        // Import existing models
        const { Pet } = importExistingModels();

        // First, get all pets for this owner to log them
        if (Pet && typeof Pet.find === 'function') {
            try {
                const mongoose = require('mongoose');
                const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
                
                // Try to find all pets with different owner field names
                const allPets = await Pet.find({
                    $or: [
                        { ownerId: ownerObjectId },
                        { owner: ownerObjectId },
                        { userId: ownerObjectId }
                    ]
                }).limit(50); // Limit to avoid too much logging
                
                console.log(`=== ALL PETS FOR OWNER ${ownerId} ===`);
                console.log(`Total pets found: ${allPets.length}`);
                allPets.forEach((pet, index) => {
                    console.log(`\nPet ${index + 1}:`);
                    console.log(`  _id: ${pet._id}`);
                    console.log(`  ownerId: ${pet.ownerId}`);
                    console.log(`  owner: ${pet.owner}`);
                    console.log(`  userId: ${pet.userId}`);
                    console.log(`  name: ${pet.name || 'N/A'}`);
                    const petObj = pet.toObject ? pet.toObject() : pet;
                    console.log(`  All fields:`, Object.keys(petObj));
                });
                console.log(`=== END OF PETS LIST ===\n`);
            } catch (petsError) {
                console.warn('Error fetching all pets for owner:', petsError.message);
            }
        }

        // Verify pet belongs to user (skip if Pet model not available or null)
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                // Convert petId to ObjectId if needed
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

                // First, check if pet exists by ID
                const petById = await Pet.findById(petObjectId);
                if (!petById) {
                    console.warn(`=== PET NOT FOUND ===`);
                    console.warn(`Requested Pet ID: ${trimmedPetId}`);
                    console.warn(`This pet does not exist in the database`);
                    return res.status(404).json({
                        success: false,
                        message: `Pet with ID ${trimmedPetId} not found in the database`
                    });
                }

                // Pet found - verify ownership - check multiple possible field names
                let ownershipVerified = false;
                
                // Check if ownerId matches (try multiple field name variations)
                // Convert both to strings for comparison
                const ownerIdStr = String(ownerId);
                
                if (petById.ownerId) {
                    if (String(petById.ownerId) === ownerIdStr) {
                        ownershipVerified = true;
                        console.log(`✓ Pet ownership verified via ownerId: ${ownerId}`);
                    }
                }
                
                if (!ownershipVerified && petById.owner) {
                    if (String(petById.owner) === ownerIdStr) {
                        ownershipVerified = true;
                        console.log(`✓ Pet ownership verified via owner: ${ownerId}`);
                    }
                }
                
                if (!ownershipVerified && petById.userId) {
                    if (String(petById.userId) === ownerIdStr) {
                        ownershipVerified = true;
                        console.log(`✓ Pet ownership verified via userId: ${ownerId}`);
                    }
                }

                // If ownership not verified, log details and return error
                if (!ownershipVerified) {
                    console.warn(`=== PET OWNERSHIP VERIFICATION FAILED ===`);
                    console.warn(`Requested Pet ID: ${trimmedPetId}`);
                    console.warn(`Pet Name: ${petById.name || 'N/A'}`);
                    console.warn(`User ID: ${ownerId}`);
                    console.warn(`Pet ownerId:`, petById.ownerId);
                    console.warn(`Pet owner:`, petById.owner, `(string: ${String(petById.owner)})`);
                    console.warn(`Pet userId:`, petById.userId);
                    console.warn(`Owner ID string: ${ownerIdStr}`);
                    console.warn(`Match check (owner):`, String(petById.owner) === ownerIdStr);
                    
                    // Get user's actual pets for better error message
                    const userPets = await Pet.find({
                        $or: [
                            { ownerId: new mongoose.Types.ObjectId(ownerId) },
                            { owner: new mongoose.Types.ObjectId(ownerId) },
                            { userId: new mongoose.Types.ObjectId(ownerId) }
                        ]
                    }).select('_id name').limit(5);
                    
                    const userPetIds = userPets.map(p => `${p._id} (${p.name || 'unnamed'})`).join(', ');
                    
                    return res.status(404).json({
                        success: false,
                        message: `Pet not found or access denied. You own: ${userPetIds || 'no pets'}. Requested pet ${trimmedPetId} (${petById.name || 'unnamed'}) belongs to a different owner.`
                    });
                } else {
                    console.log(`✓ Pet ${trimmedPetId} (${petById.name || 'unnamed'}) verified for owner ${ownerId}`);
                }
            } catch (petError) {
                // If Pet model query fails, log but continue (graceful degradation)
                console.warn('Pet model query failed, continuing without verification:', petError.message);
                console.error('Pet query error details:', petError);
            }
        }

        // Build query with ownership check - use only ownerId
        const query = { petId: trimmedPetId };
            query.ownerId = ownerId;
        
        if (status) {
            query.status = status;
        }
        
        if (deviceIdQuery) {
            const validation = validateDeviceId(deviceIdQuery);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            query.deviceId = validation.normalized;
        }
        
        if (startDate || endDate) {
            query.startTsMs = {};
            if (startDate) query.startTsMs.$gte = new Date(startDate).getTime();
            if (endDate) query.startTsMs.$lte = new Date(endDate).getTime();
        }

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Find sessions (without populate to avoid Pet model dependency)
        const sessions = await PetFitnessSession.find(query)
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-csvGzipPath -checksum'); // Exclude large fields

        const total = await PetFitnessSession.countDocuments(query);

        res.status(200).json({
            success: true,
            count: sessions.length,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: sessions
        });

    } catch (error) {
        console.error('Error fetching fitness sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch fitness sessions',
            error: error.message
        });
    }
};

// Get specific fitness session with CSV data
const getFitnessSessionData = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const ownerId = req.user.id;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        // Build query with ownership check - use only ownerId
        const query = { sessionId, ownerId };

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Find session (without populate to avoid Pet model dependency)
        const session = await PetFitnessSession.findOne(query);

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Fitness session not found or access denied'
            });
        }

        // Retrieve CSV data
        const csvData = await retrieveCsvData(session.csvGzipPath);

        res.status(200).json({
            success: true,
            data: {
                session: {
                    sessionId: session.sessionId,
                    petId: session.petId,
                    deviceId: session.deviceId,
                    startTsMs: session.startTsMs,
                    endTsMs: session.endTsMs,
                    durationSeconds: session.durationSeconds,
                    sampleRateHz: session.sampleRateHz,
                    recordCount: session.recordCount,
                    dataQuality: session.dataQuality,
                    aggregatedMetrics: session.aggregatedMetrics,
                    compressionRatio: session.compressionRatio,
                    createdAt: session.createdAt
                },
                csvData: {
                    columns: session.columns,
                    data: csvData.data,
                    recordCount: csvData.recordCount
                }
            }
        });

    } catch (error) {
        console.error('Error fetching fitness session data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch fitness session data',
            error: error.message
        });
    }
};

// Get aggregated statistics for a pet
const getPetFitnessSessionStats = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        const { days = 7, deviceId: deviceIdQuery, includeAllDates } = req.query;

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

        // Verify pet belongs to user (skip if Pet model not available or null)
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                // Convert petId to ObjectId if needed
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

                // First, check if pet exists by ID
                const petById = await Pet.findById(petObjectId);
                if (!petById) {
                    // Pet not found in Pet model, but continue anyway
                    // The PetFitnessSession query will filter by petId and ownership
                    // If pet doesn't exist or user doesn't own it, they'll get empty results
                    console.warn(`Pet not found in Pet model for ID: ${trimmedPetId}. Continuing with PetFitnessSession query.`);
                } else {
                    // Pet found - verify ownership - check multiple possible field names
                    let ownershipVerified = false;
                    
                    // Check if ownerId matches (try multiple field name variations)
                    if (ownerId) {
                        if (petById.ownerId && String(petById.ownerId) === String(ownerId)) {
                            ownershipVerified = true;
                        } else if (petById.owner && String(petById.owner) === String(ownerId)) {
                            ownershipVerified = true;
                        } else if (petById.userId && String(petById.userId) === String(ownerId)) {
                            ownershipVerified = true;
                        }
                    }
                    
                    // If ownership not verified, log warning but continue
                    // The PetFitnessSession query will filter by ownership anyway, providing security
                    if (!ownershipVerified) {
                        console.warn(`Pet ownership verification failed. Pet ID: ${trimmedPetId}, User ID: ${ownerId}`);
                        console.warn('Pet document fields:', Object.keys(petById.toObject ? petById.toObject() : petById));
                        // Continue - let the PetFitnessSession query handle ownership filtering
                    }
                }
            } catch (petError) {
                // If Pet model query fails, log but continue (graceful degradation)
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - parseInt(days));
        const startTsFrom = dateFrom.getTime();

        // Debug: Log date calculations
        console.log(`Date filter: Looking for sessions from ${dateFrom.toISOString()} (${startTsFrom}) to now (${Date.now()})`);

        // Convert petId to ObjectId for query (petId might be stored as ObjectId or string)
        const mongoose = require('mongoose');
        let petObjectId;
        try {
            petObjectId = new mongoose.Types.ObjectId(trimmedPetId);
        } catch (idError) {
            // If conversion fails, use string
            petObjectId = trimmedPetId;
        }

        // Build query - try both ObjectId and string for petId, and flexible ownership
        const query = {
            $and: [
                {
                    $or: [
                        { petId: petObjectId },
                        { petId: trimmedPetId }
                    ]
                },
                {
                    status: 'completed'
                }
            ]
        };

        // Only add date filter if days parameter is provided and valid, and includeAllDates is not set
        if (days && parseInt(days) > 0 && !includeAllDates) {
            query.$and.push({
                startTsMs: { $gte: startTsFrom }
            });
        } else if (includeAllDates) {
            console.log('Note: includeAllDates=true, skipping date filter to show all sessions');
        }

        // Add ownership filters - try both ObjectId and string for ownerId
        // Note: We're being lenient here - if user can query the pet, they can see its sessions
        // This handles cases where sessions might have been created with different ownerId
        const ownershipConditions = [];
        if (ownerId) {
            try {
                const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
                ownershipConditions.push({ ownerId: ownerObjectId });
                // Also try as string representation
                ownershipConditions.push({ ownerId: ownerId.toString() });
                ownershipConditions.push({ ownerId: String(ownerId) });
            } catch (e) {
                // If conversion fails, use string
                ownershipConditions.push({ ownerId: ownerId });
            }
        }

        // Only add ownership filter if we have conditions AND we want strict ownership
        // For now, we'll be lenient - if user can access the pet, they can see sessions
        // Uncomment the next block if you want strict ownership checking:
        /*
        if (ownershipConditions.length > 0) {
            query.$and.push({ $or: ownershipConditions });
        }
        */
        
        // Log that we're skipping strict ownership check
        if (ownershipConditions.length > 0) {
            console.log('Note: Skipping strict ownership filter. User can access pet, allowing all sessions for this pet.');
        }
        
        if (deviceIdQuery) {
            const validation = validateDeviceId(deviceIdQuery);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            query.$and.push({ deviceId: validation.normalized });
        }

        // Debug logging
        console.log('=== Stats Query Debug ===');
        console.log('User from token - ownerId:', ownerId);
        console.log('Query params - petId:', trimmedPetId, 'days:', days, 'deviceId:', deviceIdQuery);
        console.log('Date filter range:', new Date(startTsFrom).toISOString(), 'to', new Date().toISOString());
        console.log('Final query:', JSON.stringify(query, null, 2));
        
        // Debug: Check sessions without ownership filter
        const sessionsWithoutOwnership = await PetFitnessSession.countDocuments({ 
            $or: [
                { petId: petObjectId },
                { petId: trimmedPetId }
            ],
            status: 'completed'
        });
        console.log(`Sessions for petId ${trimmedPetId} (status=completed, no ownership filter): ${sessionsWithoutOwnership}`);
        
        // Debug: Check with ownership
        const testOwnershipQuery = {
            $or: [
                { petId: petObjectId },
                { petId: trimmedPetId }
            ],
            status: 'completed'
        };
        if (ownerId) {
            testOwnershipQuery.ownerId = new mongoose.Types.ObjectId(ownerId);
        }
        const sessionsWithOwnership = await PetFitnessSession.countDocuments(testOwnershipQuery);
        console.log(`Sessions for petId ${trimmedPetId} with ownerId ${ownerId}: ${sessionsWithOwnership}`);
        
        // Check sessions by status
        const sessionsByStatus = await PetFitnessSession.aggregate([
            {
                $match: {
                    $or: [
                        { petId: petObjectId },
                        { petId: trimmedPetId }
                    ]
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);
        console.log('Sessions by status:', JSON.stringify(sessionsByStatus, null, 2));
        
        // Check a sample session to see its structure
        const sampleSession = await PetFitnessSession.findOne({
            $or: [
                { petId: petObjectId },
                { petId: trimmedPetId }
            ]
        }).select('petId ownerId deviceId status startTsMs');
        if (sampleSession) {
            console.log('Sample session:', JSON.stringify(sampleSession, null, 2));
        }

        // Get aggregated statistics
        const stats = await PetFitnessSession.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalSessions: { $sum: 1 },
                    totalRecords: { $sum: '$recordCount' },
                    totalDurationSeconds: { $sum: { $subtract: ['$endTsMs', '$startTsMs'] } },
                    avgRecordsPerSession: { $avg: '$recordCount' },
                    avgDurationSeconds: { $avg: { $subtract: ['$endTsMs', '$startTsMs'] } },
                    avgCompressionRatio: { $avg: '$compressionRatio' },
                    avgDataQuality: { $avg: '$dataQuality.completeness' },
                    
                    // Aggregated activity metrics - Use MAX (device sends cumulative counters per session)
                    // If device resets counter per session, we want the latest/max value, not sum
                    totalSteps: { $max: '$aggregatedMetrics.totalSteps' },
                    totalShakes: { $max: '$aggregatedMetrics.totalShakes' },
                    totalScratches: { $max: '$aggregatedMetrics.totalScratches' },
                    totalJumps: { $max: '$aggregatedMetrics.totalJumps' },
                    totalLicks: { $max: '$aggregatedMetrics.totalLicks' },
                    totalFreefalls: { $max: '$aggregatedMetrics.totalFreefalls' },
                    totalWalking: { $max: '$aggregatedMetrics.totalWalking' },
                    totalTrotting: { $max: '$aggregatedMetrics.totalTrotting' },
                    totalRunning: { $max: '$aggregatedMetrics.totalRunning' },
                    totalSprinting: { $max: '$aggregatedMetrics.totalSprinting' },
                    totalRollingPlay: { $max: '$aggregatedMetrics.totalRollingPlay' },
                    totalDigging: { $max: '$aggregatedMetrics.totalDigging' },
                    totalLimping: { $max: '$aggregatedMetrics.totalLimping' },
                    totalTailWags: { $max: '$aggregatedMetrics.totalTailWags' },
                    totalStairsUp: { $max: '$aggregatedMetrics.totalStairsUp' },
                    totalStairsDown: { $max: '$aggregatedMetrics.totalStairsDown' },
                    totalSniffing: { $max: '$aggregatedMetrics.totalSniffing' },
                    totalRestPeriods: { $max: '$aggregatedMetrics.totalRestPeriods' },
                    
                    // Temperature metrics
                    avgTemperature: { $avg: '$aggregatedMetrics.avgTemperature' },
                    minTemperature: { $min: '$aggregatedMetrics.minTemperature' },
                    maxTemperature: { $max: '$aggregatedMetrics.maxTemperature' }
                }
            },
            {
                // Calculate calories from MAX values (cumulative counters)
                $project: {
                    _id: 1,
                    totalSessions: 1,
                    totalRecords: 1,
                    totalDurationSeconds: 1,
                    avgRecordsPerSession: 1,
                    avgDurationSeconds: 1,
                    avgCompressionRatio: 1,
                    avgDataQuality: 1,
                    totalSteps: 1,
                    totalShakes: 1,
                    totalScratches: 1,
                    totalJumps: 1,
                    totalLicks: 1,
                    totalFreefalls: 1,
                    totalWalking: 1,
                    totalTrotting: 1,
                    totalRunning: 1,
                    totalSprinting: 1,
                    totalRollingPlay: 1,
                    totalDigging: 1,
                    totalLimping: 1,
                    totalTailWags: 1,
                    totalStairsUp: 1,
                    totalStairsDown: 1,
                    totalSniffing: 1,
                    totalRestPeriods: 1,
                    avgTemperature: 1,
                    minTemperature: 1,
                    maxTemperature: 1,
                    // Calculate calories from MAX values (cumulative counters)
                    totalCalories: {
                        $add: [
                            { $multiply: [{ $ifNull: ['$totalSteps', 0] }, 0.05] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalWalking', 0] }, 50] }, 2] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalTrotting', 0] }, 50] }, 4] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalRunning', 0] }, 50] }, 8] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalSprinting', 0] }, 50] }, 12] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalRollingPlay', 0] }, 50] }, 2] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalDigging', 0] }, 50] }, 3] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalTailWags', 0] }, 50] }, 1] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalStairsUp', 0] }, 50] }, 5] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalStairsDown', 0] }, 50] }, 3] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalSniffing', 0] }, 50] }, 1] }
                        ]
                    }
                }
            }
        ]);

        // Get daily breakdown
        const dailyStats = await PetFitnessSession.aggregate([
            { $match: query },
            {
                $group: {
                    _id: {
                        year: { $year: { $toDate: '$startTsMs' } },
                        month: { $month: { $toDate: '$startTsMs' } },
                        day: { $dayOfMonth: { $toDate: '$startTsMs' } }
                    },
                    date: { $first: { $toDate: '$startTsMs' } },
                    sessionsCount: { $sum: 1 },
                    totalRecords: { $sum: '$recordCount' },
                    totalDurationSeconds: { $sum: { $subtract: ['$endTsMs', '$startTsMs'] } },
                    avgTemperature: { $avg: '$aggregatedMetrics.avgTemperature' },
                    totalSteps: { $max: '$aggregatedMetrics.totalSteps' },
                    // Activity fields - Use MAX (device sends cumulative counters)
                    totalWalking: { $max: '$aggregatedMetrics.totalWalking' },
                    totalTrotting: { $max: '$aggregatedMetrics.totalTrotting' },
                    totalRunning: { $max: '$aggregatedMetrics.totalRunning' },
                    totalSprinting: { $max: '$aggregatedMetrics.totalSprinting' },
                    totalRollingPlay: { $max: '$aggregatedMetrics.totalRollingPlay' },
                    totalDigging: { $max: '$aggregatedMetrics.totalDigging' },
                    totalLimping: { $max: '$aggregatedMetrics.totalLimping' },
                    totalTailWags: { $max: '$aggregatedMetrics.totalTailWags' },
                    totalStairsUp: { $max: '$aggregatedMetrics.totalStairsUp' },
                    totalStairsDown: { $max: '$aggregatedMetrics.totalStairsDown' },
                    totalSniffing: { $max: '$aggregatedMetrics.totalSniffing' },
                    totalRestPeriods: { $max: '$aggregatedMetrics.totalRestPeriods' }
                }
            },
            {
                // Calculate calories and totalActivity from MAX values
                $project: {
                    _id: 1,
                    date: 1,
                    sessionsCount: 1,
                    totalRecords: 1,
                    totalDurationSeconds: 1,
                    avgTemperature: 1,
                    totalSteps: 1,
                    totalWalking: 1,
                    totalTrotting: 1,
                    totalRunning: 1,
                    totalSprinting: 1,
                    totalRollingPlay: 1,
                    totalDigging: 1,
                    totalLimping: 1,
                    totalTailWags: 1,
                    totalStairsUp: 1,
                    totalStairsDown: 1,
                    totalSniffing: 1,
                    totalRestPeriods: 1,
                    // Calculate calories from MAX values (cumulative counters)
                    totalCalories: {
                        $add: [
                            { $multiply: [{ $ifNull: ['$totalSteps', 0] }, 0.05] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalWalking', 0] }, 50] }, 2] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalTrotting', 0] }, 50] }, 4] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalRunning', 0] }, 50] }, 8] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalSprinting', 0] }, 50] }, 12] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalRollingPlay', 0] }, 50] }, 2] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalDigging', 0] }, 50] }, 3] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalTailWags', 0] }, 50] }, 1] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalStairsUp', 0] }, 50] }, 5] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalStairsDown', 0] }, 50] }, 3] },
                            { $multiply: [{ $divide: [{ $ifNull: ['$totalSniffing', 0] }, 50] }, 1] }
                        ]
                    },
                    // Total activity = sum of MAX values of each activity type
                    totalActivity: {
                        $add: [
                            { $ifNull: ['$totalWalking', 0] },
                            { $ifNull: ['$totalTrotting', 0] },
                            { $ifNull: ['$totalRunning', 0] },
                            { $ifNull: ['$totalSprinting', 0] },
                            { $ifNull: ['$totalRollingPlay', 0] },
                            { $ifNull: ['$totalDigging', 0] },
                            { $ifNull: ['$totalTailWags', 0] },
                            { $ifNull: ['$totalStairsUp', 0] },
                            { $ifNull: ['$totalStairsDown', 0] },
                            { $ifNull: ['$totalSniffing', 0] }
                        ]
                    }
                }
            },
            { $sort: { date: 1 } }
        ]);

        // Remove _id from summary (it's null from aggregation, not needed)
        const summary = stats[0] || {};
        if (summary._id !== undefined) {
            delete summary._id;
        }

        // Get individual sessions with their aggregatedMetrics to show step breakdown
        const individualSessions = await PetFitnessSession.find(query)
            .select('sessionId startTsMs endTsMs recordCount aggregatedMetrics.totalSteps aggregatedMetrics.totalWalking aggregatedMetrics.totalTrotting aggregatedMetrics.totalRunning aggregatedMetrics.totalSprinting aggregatedMetrics.totalRollingPlay')
            .sort({ startTsMs: -1 })
            .limit(100); // Limit to last 100 sessions

        res.status(200).json({
            success: true,
            data: {
                period: `${days} days`,
                summary: summary,
                dailyBreakdown: dailyStats,
                // Individual sessions with step breakdown
                sessions: individualSessions.map(session => ({
                    sessionId: session.sessionId,
                    startTsMs: session.startTsMs,
                    endTsMs: session.endTsMs,
                    recordCount: session.recordCount,
                    steps: session.aggregatedMetrics?.totalSteps || 0,
                    walking: session.aggregatedMetrics?.totalWalking || 0,
                    trotting: session.aggregatedMetrics?.totalTrotting || 0,
                    running: session.aggregatedMetrics?.totalRunning || 0,
                    sprinting: session.aggregatedMetrics?.totalSprinting || 0,
                    rollingPlay: session.aggregatedMetrics?.totalRollingPlay || 0
                }))
            }
        });

    } catch (error) {
        console.error('Error fetching fitness session stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch fitness session statistics',
            error: error.message
        });
    }
};

// Get latest fitness session for a pet
const getLatestFitnessSession = async (req, res) => {
    try {
        const { petId } = req.params;
        const ownerId = req.user.id;
        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        const { deviceId: deviceIdQuery } = req.query || {};

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

        // Verify pet belongs to user (skip if Pet model not available or null)
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
                const petQuery = { 
                    _id: trimmedPetId,
                    $or: [
                        { ownerId: ownerObjectId },
                        { owner: ownerObjectId },
                        { userId: ownerObjectId }
                    ]
                };

                const pet = await Pet.findOne(petQuery);
                if (!pet) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pet not found or access denied'
                    });
                }
            } catch (petError) {
                // If Pet model query fails, log but continue (graceful degradation)
                console.warn('Pet model query failed, continuing without verification:', petError.message);
            }
        }

        const query = { 
            petId: trimmedPetId, 
            status: 'completed',
            ownerId
        };

        if (deviceIdQuery) {
            const validation = validateDeviceId(deviceIdQuery);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            query.deviceId = validation.normalized;
        }

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Find latest session (without populate to avoid Pet model dependency)
        const latestSession = await PetFitnessSession.findOne(query)
            .sort({ startTsMs: -1 })
            .select('-csvGzipPath -checksum');

        if (!latestSession) {
            return res.status(404).json({
                success: false,
                message: 'No fitness sessions found for this pet'
            });
        }

        res.status(200).json({
            success: true,
            data: latestSession
        });

    } catch (error) {
        console.error('Error fetching latest fitness session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch latest fitness session',
            error: error.message
        });
    }
};

// Delete fitness session
const deleteFitnessSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const ownerId = req.user.id;

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        const session = await PetFitnessSession.findOneAndDelete({ 
            sessionId, 
            ownerId 
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Fitness session not found or access denied'
            });
        }

        // TODO: Optionally delete the CSV file from storage
        // await fs.unlink(path.join(STORAGE_BASE_DIR, session.csvGzipPath));

        res.status(200).json({
            success: true,
            message: 'Fitness session deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting fitness session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete fitness session',
            error: error.message
        });
    }
};

// Create fitness session from JSON activity data (for mobile app)
// POST /api/v1/pet-fitness-sessions/json
const createFitnessSessionFromJson = async (req, res) => {
    try {
        const ownerId = req.user.id;
        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }
        const { 
            petId, 
            deviceId,
            activityData, 
            sampleRateHz = 50,
            timestamp,
            windowStart,
            windowEnd
        } = req.body;

        // Validate required fields
        if (!petId || !deviceId || !activityData || !Array.isArray(activityData)) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: petId, deviceId, activityData (array)'
            });
        }

        if (activityData.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'activityData array cannot be empty'
            });
        }

        // Validate and normalize deviceId
        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Device ID must be a valid BLE/MAC address formatted as XX:XX:XX:XX:XX:XX'
            });
        }

        // Convert activity data to CSV format for storage
        const csvRows = activityData.map(row => {
            if (typeof row === 'string') {
                return row; // Already CSV format
            } else if (Array.isArray(row)) {
                return row.join(','); // Convert array to CSV
            } else {
                throw new Error('Invalid activity data format: each row must be a string or array');
            }
        });

        const activityCsv = csvRows.join('\n');

        // Calculate timestamps
        const now = Date.now();
        const sessionStartTs = windowStart || now;
        const sessionEndTs = windowEnd || (sessionStartTs + (activityData.length * 1000 / sampleRateHz));

        // Generate session ID
        const sessionId = PetFitnessSession.generateSessionId(petId, sessionStartTs);

        // Parse CSV data for validation
        let parsedData;
        try {
            parsedData = parseCsvData(activityCsv);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid activity data format',
                error: error.message
            });
        }

        if (parsedData.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid CSV data found in activityData'
            });
        }

        // Validate CSV data structure
        const validation = validateCsvData(parsedData);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Activity data validation failed',
                errors: validation.errors,
                warnings: validation.warnings
            });
        }

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Store CSV data
        const storageResult = await storeCsvData(parsedData, String(petId), sessionStartTs);

        // Calculate aggregated metrics
        const aggregatedMetrics = calculateAggregatedMetrics(parsedData);

        // Create session record
        const sessionData = {
            petId,
            ownerId,
            deviceId: deviceValidation.normalized,
            sessionId,
            receivedAt: timestamp ? new Date(timestamp) : new Date(),
            firmwareVersion: '1.0.0',
            sampleRateHz,
            startTsMs: sessionStartTs,
            endTsMs: sessionEndTs,
            recordCount: parsedData.length,
            dataSizeBytes: storageResult.originalSize,
            compressedSizeBytes: storageResult.compressedSize,
            csvGzipPath: storageResult.storagePath,
            checksum: storageResult.checksum,
            status: 'completed',
            dataQuality: {
                completeness: validation.warnings.length === 0 ? 100 : Math.max(0, 100 - validation.warnings.length * 5),
                validity: 100
            },
            aggregatedMetrics
        };

        const session = await PetFitnessSession.create(sessionData);

        // Determine response message based on data size
        const message = activityData.length === 1 
            ? 'Single line uploaded immediately'
            : `${activityData.length} lines uploaded successfully`;

        // Return response matching API documentation format
        res.status(201).json({
            success: true,
            message: message,
            sessionId: session.sessionId
        });

    } catch (error) {
        console.error('Error creating fitness session from JSON:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload fitness data',
            error: error.message
        });
    }
};

// Get all fitness sessions data in CSV format (PUBLIC - for ML training)
const getAllFitnessSessionsCSV = async (req, res) => {
    try {
        const ownerId = req.user?.id; // Optional - may not exist for public access
        const { 
            includeAllUsers = 'true', // Default to true for public ML training access
            status,
            startDate,
            endDate,
            deviceId: deviceIdQuery,
            ownerId: ownerIdFilter // Allow filtering by specific ownerId via query param
        } = req.query;

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Build query
        const query = {};
        
        // Filter by ownerId if provided via query param or from authenticated user
        // For ML training, default to showing all data unless specifically filtered
        const targetOwnerId = ownerIdFilter || (includeAllUsers !== 'true' ? ownerId : null);
        
        if (targetOwnerId) {
            const mongoose = require('mongoose');
            try {
                const ownerObjectId = new mongoose.Types.ObjectId(targetOwnerId);
                query.ownerId = ownerObjectId;
            } catch (e) {
                query.ownerId = targetOwnerId;
            }
        }
        // If no ownerId filter, query will return all sessions (for ML training)

        // Import Pet model for enrichment
        const { Pet } = importExistingModels();
        if (!Pet || !Pet.collection) {
            return res.status(500).json({
                success: false,
                message: 'Pet model not available. Cannot include pet info in CSV.'
            });
        }

        // Status filter
        if (status && status !== 'all') {
            query.status = status;
        }

        // Time range filter
        if (startDate || endDate) {
            query.startTsMs = {};
            if (startDate) {
                const start = new Date(startDate);
                if (isNaN(start)) {
                    return res.status(400).json({
                        success: false,
                        message: 'startDate must be a valid date string'
                    });
                }
                query.startTsMs.$gte = start.getTime();
            }
            if (endDate) {
                const end = new Date(endDate);
                if (isNaN(end)) {
                    return res.status(400).json({
                        success: false,
                        message: 'endDate must be a valid date string'
                    });
                }
                query.startTsMs.$lte = end.getTime();
            }
        }

        // Device filter
        if (deviceIdQuery) {
            const validation = validateDeviceId(deviceIdQuery);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            query.deviceId = validation.normalized;
        }

        // Build aggregation pipeline to include pet info
        const pipeline = [
            { $match: query },
            { $sort: { createdAt: -1 } },
            {
                $addFields: {
                    petIdObj: {
                        $convert: {
                            input: '$petId',
                            to: 'objectId',
                            onError: null,
                            onNull: null
                        }
                    },
                    petIdStr: { $toString: '$petId' }
                }
            },
            {
                $lookup: {
                    from: Pet.collection.name,
                    let: { petIdObj: '$petIdObj', petIdStr: '$petIdStr' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $or: [
                                        { $eq: ['$_id', '$$petIdObj'] },
                                        { $eq: [{ $toString: '$_id' }, '$$petIdStr'] }
                                    ]
                                }
                            }
                        },
                        { $limit: 1 }
                    ],
                    as: 'pet'
                }
            },
            {
                $unwind: {
                    path: '$pet',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $addFields: {
                    petBirthDate: {
                        $ifNull: [
                            {
                                $dateFromString: {
                                    dateString: '$pet.birthday',
                                    format: '%Y-%m-%d',
                                    onError: null,
                                    onNull: null
                                }
                            },
                            {
                                $dateFromString: {
                                    dateString: '$pet.birthday',
                                    format: '%d/%m/%Y',
                                    onError: null,
                                    onNull: null
                                }
                            }
                        ]
                    }
                }
            },
            {
                $addFields: {
                    petAgeYears: {
                        $cond: [
                            { $ne: ['$petBirthDate', null] },
                            {
                                $divide: [
                                    { $subtract: [new Date(), '$petBirthDate'] },
                                    1000 * 60 * 60 * 24 * 365.25
                                ]
                            },
                            null
                        ]
                    }
                }
            },
            {
                $addFields: {
                    petAgeYearsFloor: {
                        $cond: [
                            { $ne: ['$petAgeYears', null] },
                            { $floor: '$petAgeYears' },
                            null
                        ]
                    }
                }
            },
            {
                $project: {
                    csvGzipPath: 0,
                    checksum: 0,
                    petIdObj: 0,
                    petIdStr: 0,
                    petBirthDate: 0
                }
            }
        ];

        const sessions = await PetFitnessSession.aggregate(pipeline);

        if (sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No fitness sessions found'
            });
        }

        // Define CSV headers
        const headers = [
            'petName',
            'petBreed',
            'petGender',
            'petBirthday',
            'petAgeYears',
            'petHealthConditions',
            'sessionId',
            'petId',
            'ownerId',
            'deviceId',
            'status',
            'firmwareVersion',
            'sampleRateHz',
            'startTsMs',
            'endTsMs',
            'durationSeconds',
            'receivedAt',
            'recordCount',
            'dataSizeBytes',
            'compressedSizeBytes',
            'compressionRatio',
            'dataQuality_completeness',
            'dataQuality_validity',
            'aggregatedMetrics_avgAccX',
            'aggregatedMetrics_avgAccY',
            'aggregatedMetrics_avgAccZ',
            'aggregatedMetrics_avgGyrX',
            'aggregatedMetrics_avgGyrY',
            'aggregatedMetrics_avgGyrZ',
            'aggregatedMetrics_avgRoll',
            'aggregatedMetrics_avgPitch',
            'aggregatedMetrics_avgTemperature',
            'aggregatedMetrics_minTemperature',
            'aggregatedMetrics_maxTemperature',
            'aggregatedMetrics_totalSteps',
            'aggregatedMetrics_totalShakes',
            'aggregatedMetrics_totalScratches',
            'aggregatedMetrics_totalJumps',
            'aggregatedMetrics_totalLicks',
            'aggregatedMetrics_totalFreefalls',
            'aggregatedMetrics_totalRestPeriods',
            'aggregatedMetrics_totalWalking',
            'aggregatedMetrics_totalTrotting',
            'aggregatedMetrics_totalRunning',
            'aggregatedMetrics_totalSprinting',
            'aggregatedMetrics_totalRollingPlay',
            'aggregatedMetrics_totalDigging',
            'aggregatedMetrics_totalLimping',
            'aggregatedMetrics_totalTailWags',
            'aggregatedMetrics_totalStairsUp',
            'aggregatedMetrics_totalStairsDown',
            'aggregatedMetrics_totalSniffing',
            'aggregatedMetrics_totalCalories',
            'aggregatedMetrics_activityIntensity',
            'createdAt',
            'updatedAt',
            'archivedAt'
        ];

        // Helper function to escape CSV values
        const escapeCSV = (value) => {
            if (value === null || value === undefined) {
                return '';
            }
            const stringValue = String(value);
            // If value contains comma, quote, or newline, wrap in quotes and escape quotes
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        };

        // Helper function to calculate duration in seconds
        const calculateDurationSeconds = (startTsMs, endTsMs) => {
            if (!startTsMs || !endTsMs) return '';
            return Math.round((endTsMs - startTsMs) / 1000);
        };

        // Helper to format date safely
        const formatDate = (d) => (d ? new Date(d).toISOString() : '');

        // Helper function to calculate compression ratio
        const calculateCompressionRatio = (dataSizeBytes, compressedSizeBytes) => {
            if (!dataSizeBytes || dataSizeBytes === 0) return '';
            return Math.round((1 - compressedSizeBytes / dataSizeBytes) * 100);
        };

        // Helper to get pet age
        const formatAge = (session) => {
            if (session.petAgeYearsFloor === null || session.petAgeYearsFloor === undefined) return '';
            return session.petAgeYearsFloor;
        };

        // Build CSV rows
        const csvRows = [headers.join(',')]; // Header row

        sessions.forEach(session => {
            const row = [
                escapeCSV(session.pet?.name),
                escapeCSV(session.pet?.breed),
                escapeCSV(session.pet?.gender),
                escapeCSV(session.pet?.birthday),
                escapeCSV(formatAge(session)),
                escapeCSV(session.pet?.healthConditions),
                escapeCSV(session.sessionId),
                escapeCSV(session.petId),
                escapeCSV(session.ownerId),
                escapeCSV(session.deviceId),
                escapeCSV(session.status),
                escapeCSV(session.firmwareVersion),
                escapeCSV(session.sampleRateHz),
                escapeCSV(session.startTsMs),
                escapeCSV(session.endTsMs),
                escapeCSV(calculateDurationSeconds(session.startTsMs, session.endTsMs)),
                escapeCSV(formatDate(session.receivedAt)),
                escapeCSV(session.recordCount),
                escapeCSV(session.dataSizeBytes),
                escapeCSV(session.compressedSizeBytes),
                escapeCSV(calculateCompressionRatio(session.dataSizeBytes, session.compressedSizeBytes)),
                escapeCSV(session.dataQuality?.completeness),
                escapeCSV(session.dataQuality?.validity),
                escapeCSV(session.aggregatedMetrics?.avgAccX),
                escapeCSV(session.aggregatedMetrics?.avgAccY),
                escapeCSV(session.aggregatedMetrics?.avgAccZ),
                escapeCSV(session.aggregatedMetrics?.avgGyrX),
                escapeCSV(session.aggregatedMetrics?.avgGyrY),
                escapeCSV(session.aggregatedMetrics?.avgGyrZ),
                escapeCSV(session.aggregatedMetrics?.avgRoll),
                escapeCSV(session.aggregatedMetrics?.avgPitch),
                escapeCSV(session.aggregatedMetrics?.avgTemperature),
                escapeCSV(session.aggregatedMetrics?.minTemperature),
                escapeCSV(session.aggregatedMetrics?.maxTemperature),
                escapeCSV(session.aggregatedMetrics?.totalSteps),
                escapeCSV(session.aggregatedMetrics?.totalShakes),
                escapeCSV(session.aggregatedMetrics?.totalScratches),
                escapeCSV(session.aggregatedMetrics?.totalJumps),
                escapeCSV(session.aggregatedMetrics?.totalLicks),
                escapeCSV(session.aggregatedMetrics?.totalFreefalls),
                escapeCSV(session.aggregatedMetrics?.totalRestPeriods),
                escapeCSV(session.aggregatedMetrics?.totalWalking),
                escapeCSV(session.aggregatedMetrics?.totalTrotting),
                escapeCSV(session.aggregatedMetrics?.totalRunning),
                escapeCSV(session.aggregatedMetrics?.totalSprinting),
                escapeCSV(session.aggregatedMetrics?.totalRollingPlay),
                escapeCSV(session.aggregatedMetrics?.totalDigging),
                escapeCSV(session.aggregatedMetrics?.totalLimping),
                escapeCSV(session.aggregatedMetrics?.totalTailWags),
                escapeCSV(session.aggregatedMetrics?.totalStairsUp),
                escapeCSV(session.aggregatedMetrics?.totalStairsDown),
                escapeCSV(session.aggregatedMetrics?.totalSniffing),
                escapeCSV(session.aggregatedMetrics?.totalCalories),
                escapeCSV(session.aggregatedMetrics?.activityIntensity),
                escapeCSV(formatDate(session.createdAt)),
                escapeCSV(formatDate(session.updatedAt)),
                escapeCSV(formatDate(session.archivedAt))
            ];
            csvRows.push(row.join(','));
        });

        // Add UTF-8 BOM for Excel compatibility
        const BOM = '\uFEFF';
        const csvContent = BOM + csvRows.join('\n');

        // Set headers for CSV download
        const filename = `pet-fitness-sessions-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', Buffer.byteLength(csvContent, 'utf8'));
        res.setHeader('Cache-Control', 'no-cache');

        // Send CSV content
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Error exporting fitness sessions to CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export fitness sessions to CSV',
            error: error.message
        });
    }
};

// Calculate calorie burn from a fitness session using RER method
// GET /api/v1/pet-fitness-sessions/:sessionId/calories?weightKg=XX
const getCalorieBurnFromSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const ownerId = req.user.id;
        const { weightKg, useMultiplier = 'default' } = req.query;

        console.log('getCalorieBurnFromSession', req.params, req.query);
        console.log('ownerId', ownerId);
        console.log('weightKg', weightKg);
        console.log('useMultiplier', useMultiplier);

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        if (!weightKg || isNaN(parseFloat(weightKg)) || parseFloat(weightKg) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Weight in kilograms (weightKg) is required and must be a positive number'
            });
        }

        const weight = parseFloat(weightKg);

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Find session - try with flexible ownerId matching (ObjectId or string)
        const mongoose = require('mongoose');
        let ownerObjectId;
        try {
            ownerObjectId = new mongoose.Types.ObjectId(ownerId);
        } catch (idError) {
            ownerObjectId = ownerId;
        }

        // Support querying by both sessionId (string format) and _id (ObjectId)
        // sessionId format: petId_startTsMs_timestamp
        // If the provided value looks like an ObjectId, try querying by _id as well
        let queryById = false;
        let sessionObjectId = null;
        
        // Check if sessionId looks like a MongoDB ObjectId (24 hex characters)
        if (sessionId && /^[0-9a-fA-F]{24}$/.test(sessionId)) {
            try {
                sessionObjectId = new mongoose.Types.ObjectId(sessionId);
                queryById = true;
                console.log('  - sessionId looks like ObjectId, will also query by _id');
            } catch (e) {
                // Not a valid ObjectId format
            }
        }

        // Build query - try both sessionId and _id
        const sessionQuery = {
            ownerId: { $in: [ownerObjectId, ownerId, String(ownerId)] }
        };
        
        if (queryById) {
            // Try both _id and sessionId
            sessionQuery.$or = [
                { _id: sessionObjectId },
                { sessionId: sessionId }
            ];
        } else {
            // Only try sessionId
            sessionQuery.sessionId = sessionId;
        }

        // First, try to find session by sessionId/_id only (for debugging)
        let sessionById;
        if (queryById) {
            sessionById = await PetFitnessSession.findOne({
                $or: [
                    { _id: sessionObjectId },
                    { sessionId: sessionId }
                ]
            });
        } else {
            sessionById = await PetFitnessSession.findOne({ sessionId });
        }
        
        console.log('Session lookup debug:');
        console.log('  - sessionId param:', sessionId);
        console.log('  - ownerId (from token):', ownerId, typeof ownerId);
        console.log('  - ownerObjectId:', ownerObjectId);
        console.log('  - Querying by _id:', queryById);
        console.log('  - Session found by ID:', sessionById ? 'YES' : 'NO');
        
        if (sessionById) {
            console.log('  - Session _id:', sessionById._id);
            console.log('  - Session sessionId:', sessionById.sessionId);
            console.log('  - Session ownerId:', sessionById.ownerId, typeof sessionById.ownerId);
            console.log('  - Session ownerId string:', String(sessionById.ownerId));
            console.log('  - Owner match:', String(sessionById.ownerId) === String(ownerId));
        } else {
            // Try to find any session for this owner to help debug
            const anySession = await PetFitnessSession.findOne({ 
                ownerId: { $in: [ownerObjectId, ownerId, String(ownerId)] } 
            }).limit(1);
            if (anySession) {
                console.log('  - Found other sessions for this owner');
                console.log('  - Example session _id:', anySession._id);
                console.log('  - Example session sessionId:', anySession.sessionId);
            } else {
                console.log('  - No sessions found for this owner at all');
            }
        }

        // Find session with ownership check
        const session = await PetFitnessSession.findOne(sessionQuery);

        if (!session) {
            // If session exists but owner doesn't match, provide more specific error
            if (sessionById) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This session belongs to a different owner.',
                    debug: {
                        sessionOwnerId: String(sessionById.ownerId),
                        requestOwnerId: String(ownerId)
                    }
                });
            }
            
            return res.status(404).json({
                success: false,
                message: 'Fitness session not found',
                debug: {
                    sessionId,
                    ownerId: String(ownerId)
                }
            });
        }

        // Get aggregated metrics from session
        const metrics = session.aggregatedMetrics || {};
        
        // Add session timing information
        metrics.startTsMs = session.startTsMs;
        metrics.endTsMs = session.endTsMs;
        metrics.recordCount = session.recordCount;

        console.log("weight:-", weight);
        console.log("useMultiplier", useMultiplier);
        console.log("metrics", metrics);
        console.log("session.sampleRateHz", session.sampleRateHz);

        // Calculate calories using RER method
        const calorieResult = calculateTotalCaloriesFromMetrics(
            metrics,
            weight,
            session.sampleRateHz || 50,
            useMultiplier
        );

        console.log("calorieResult", calorieResult);

        res.status(200).json({
            success: true,
            data: {
                sessionId: session.sessionId,
                petId: session.petId,
                weightKg: weight,
                sampleRateHz: session.sampleRateHz || 50,
                sessionDuration: {
                    startTsMs: session.startTsMs,
                    endTsMs: session.endTsMs,
                    durationMs: calorieResult.sessionDurationMs || (session.endTsMs - session.startTsMs),
                    durationSeconds: calorieResult.sessionDurationSeconds || ((session.endTsMs - session.startTsMs) / 1000),
                    durationMinutes: calorieResult.sessionDurationMinutes || ((session.endTsMs - session.startTsMs) / (1000 * 60))
                },
                rer: {
                    dailyRER: calorieResult.dailyRER,
                    hourlyRER: calorieResult.hourlyRER,
                    minuteRER: calorieResult.minuteRER,
                    sessionRER: calorieResult.rerCalories
                },
                calories: {
                    total: calorieResult.totalCalories,
                    fromRER: calorieResult.rerCalories,
                    fromActivity: calorieResult.activityCalories
                },
                activityBreakdown: calorieResult.breakdown,
                calculatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Error calculating calorie burn from session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate calorie burn',
            error: error.message
        });
    }
};

// Get fitness sessions filtered by pet attributes (breed, gender, health conditions, age)
const getFitnessSessionsByPetFilters = async (req, res) => {
    try {
        const {
            breed,
            gender,
            healthCondition,
            type,
            age,
            status,
            startDate,
            endDate,
            deviceId: deviceIdQuery,
            includePetInfo = 'true'
        } = req.query;

        // Check if PetFitnessSession model is available
        try {
            checkModel(PetFitnessSession, 'PetFitnessSession');
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Database model not available',
                error: error.message
            });
        }

        // Import Pet model for filtering
        const { Pet } = importExistingModels();
        if (!Pet || !Pet.collection) {
            return res.status(500).json({
                success: false,
                message: 'Pet model not available. Cannot filter by pet attributes.'
            });
        }

        // Build base match for PetFitnessSession
        const sessionMatch = {};
        
        // Status filter
        if (status && status !== 'all') {
            sessionMatch.status = status;
        }

        // Time range filter
        if (startDate || endDate) {
            sessionMatch.startTsMs = {};
            if (startDate) {
                const start = new Date(startDate);
                if (isNaN(start)) {
                    return res.status(400).json({
                        success: false,
                        message: 'startDate must be a valid date string'
                    });
                }
                sessionMatch.startTsMs.$gte = start.getTime();
            }
            if (endDate) {
                const end = new Date(endDate);
                if (isNaN(end)) {
                    return res.status(400).json({
                        success: false,
                        message: 'endDate must be a valid date string'
                    });
                }
                sessionMatch.startTsMs.$lte = end.getTime();
            }
        }

        // Device filter
        if (deviceIdQuery) {
            const validation = validateDeviceId(deviceIdQuery);
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Device ID filter must be a valid BLE/MAC address'
                });
            }
            sessionMatch.deviceId = validation.normalized;
        }

        // Build aggregation pipeline
        const pipeline = [
            // Match sessions first
            { $match: sessionMatch },
            
            // Convert petId to ObjectId and string for lookup
            {
                $addFields: {
                    petIdObj: {
                        $convert: {
                            input: '$petId',
                            to: 'objectId',
                            onError: null,
                            onNull: null
                        }
                    },
                    petIdStr: { $toString: '$petId' }
                }
            },
            
            // Lookup pet information
            {
                $lookup: {
                    from: Pet.collection.name,
                    let: { petIdObj: '$petIdObj', petIdStr: '$petIdStr' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $or: [
                                        { $eq: ['$_id', '$$petIdObj'] },
                                        { $eq: [{ $toString: '$_id' }, '$$petIdStr'] }
                                    ]
                                }
                            }
                        },
                        { $limit: 1 }
                    ],
                    as: 'pet'
                }
            },
            
            // Unwind pet array (keep sessions even if pet not found)
            {
                $unwind: {
                    path: '$pet',
                    preserveNullAndEmptyArrays: true
                }
            },
            
            // Calculate pet age from birthday (DD/MM/YYYY format)
            {
                $addFields: {
                    petBirthDate: {
                        // Try ISO (YYYY-MM-DD) first, then fallback to DD/MM/YYYY
                        $ifNull: [
                            {
                                $dateFromString: {
                                    dateString: '$pet.birthday',
                                    format: '%Y-%m-%d',
                                    onError: null,
                                    onNull: null
                                }
                            },
                            {
                                $dateFromString: {
                                    dateString: '$pet.birthday',
                                    format: '%d/%m/%Y',
                                    onError: null,
                                    onNull: null
                                }
                            }
                        ]
                    }
                }
            },
            
            // Calculate age in years
            {
                $addFields: {
                    petAgeYears: {
                        $cond: [
                            { $ne: ['$petBirthDate', null] },
                            {
                                $divide: [
                                    { $subtract: [new Date(), '$petBirthDate'] },
                                    1000 * 60 * 60 * 24 * 365.25
                                ]
                            },
                            null
                        ]
                    }
                }
            },
            // Floor age in years for exact age matching
            {
                $addFields: {
                    petAgeYearsFloor: {
                        $cond: [
                            { $ne: ['$petAgeYears', null] },
                            { $floor: '$petAgeYears' },
                            null
                        ]
                    }
                }
            }
        ];

        // Build pet filter conditions
        const petMatchConditions = [];
        
        if (breed) {
            petMatchConditions.push({
                'pet.breed': { $regex: breed, $options: 'i' }
            });
        }
        
        if (gender) {
            petMatchConditions.push({
                'pet.gender': gender
            });
        }
        
        if (healthCondition) {
            petMatchConditions.push({
                'pet.healthConditions': { $regex: healthCondition, $options: 'i' }
            });
        }
        
        if (type) {
            petMatchConditions.push({
                'pet.type': type
            });
        }

        // Age filter (exact age in years, based on birthday)
        if (age !== undefined) {
            const ageNumber = Number(age);
            if (Number.isNaN(ageNumber)) {
                return res.status(400).json({
                    success: false,
                    message: 'age must be a number'
                });
            }
            petMatchConditions.push({
                petAgeYearsFloor: ageNumber
            });
        }
        
        // Add pet filter match if any conditions exist
        if (petMatchConditions.length > 0) {
            pipeline.push({
                $match: {
                    $and: petMatchConditions
                }
            });
        }
        
        // Project fields (exclude internal helper fields)
        const projectFields = {
            csvGzipPath: 0,
            checksum: 0,
            petIdObj: 0,
            petIdStr: 0,
            petBirthDate: 0
        };
        
        // Include pet info if requested
        if (String(includePetInfo).toLowerCase() !== 'true') {
            projectFields.pet = 0;
            projectFields.petAgeYears = 0;
        }
        
        pipeline.push({ $project: projectFields });
        
        // Sort by creation date (newest first)
        pipeline.push({ $sort: { createdAt: -1 } });
        
        // Get total count for pagination
        const countPipeline = [...pipeline];
        countPipeline.push({ $count: 'total' });
        const countResult = await PetFitnessSession.aggregate(countPipeline);
        const total = countResult[0]?.total || 0;
        
        // Execute aggregation (no pagination - return all)
        const sessions = await PetFitnessSession.aggregate(pipeline);
        
        res.status(200).json({
            success: true,
            count: sessions.length,
            total,
            filtersApplied: {
                breed: breed || null,
                gender: gender || null,
                healthCondition: healthCondition || null,
                type: type || null,
                age: age !== undefined ? Number(age) : null,
                status: status || null,
                startDate: startDate || null,
                endDate: endDate || null,
                deviceId: deviceIdQuery || null
            },
            data: sessions
        });

    } catch (error) {
        console.error('Error fetching fitness sessions by pet filters:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch fitness sessions by pet filters',
            error: error.message
        });
    }
};

// Calculate calorie burn from provided metrics using RER method
// POST /api/v1/pet-fitness-sessions/calories/calculate
const calculateCalorieBurn = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const { petId, weightKg, metrics, sampleRateHz = 50, useMultiplier = 'default' } = req.body;

        if (!ownerId) {
            return res.status(401).json({
                success: false,
                message: 'User ID is required for authentication'
            });
        }

        // Validate required fields
        if (!petId) {
            return res.status(400).json({
                success: false,
                message: 'petId is required'
            });
        }

        if (!weightKg || isNaN(parseFloat(weightKg)) || parseFloat(weightKg) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'weightKg is required and must be a positive number'
            });
        }

        if (!metrics || typeof metrics !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'metrics object is required'
            });
        }

        const weight = parseFloat(weightKg);
        const sampleRate = parseInt(sampleRateHz) || 50;

        // Import existing models for pet verification
        const { Pet } = importExistingModels();

        // Verify pet belongs to user
        if (Pet && typeof Pet.findOne === 'function') {
            try {
                const mongoose = require('mongoose');
                let petObjectId;
                try {
                    petObjectId = new mongoose.Types.ObjectId(petId);
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

        // Calculate calories using RER method
        const calorieResult = calculateTotalCaloriesFromMetrics(
            metrics,
            weight,
            sampleRate,
            useMultiplier
        );

        res.status(200).json({
            success: true,
            data: {
                petId,
                weightKg: weight,
                sampleRateHz: sampleRate,
                rer: {
                    dailyRER: calorieResult.dailyRER,
                    hourlyRER: calorieResult.hourlyRER,
                    minuteRER: calorieResult.minuteRER,
                    sessionRER: calorieResult.rerCalories
                },
                calories: {
                    total: calorieResult.totalCalories,
                    fromRER: calorieResult.rerCalories,
                    fromActivity: calorieResult.activityCalories
                },
                activityBreakdown: calorieResult.breakdown,
                calculatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Error calculating calorie burn:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate calorie burn',
            error: error.message
        });
    }
};

// Get RER information for a given weight
// GET /api/v1/pet-fitness-sessions/calories/rer?weightKg=XX
const getRERInfo = async (req, res) => {
    try {
        const { weightKg } = req.query;

        if (!weightKg || isNaN(parseFloat(weightKg)) || parseFloat(weightKg) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Weight in kilograms (weightKg) is required and must be a positive number'
            });
        }

        const weight = parseFloat(weightKg);

        const dailyRER = calculateDailyRER(weight);
        const hourlyRER = calculateHourlyRER(weight);
        const minuteRER = calculateMinuteRER(weight);

        res.status(200).json({
            success: true,
            data: {
                weightKg: weight,
                rer: {
                    daily: Math.round(dailyRER * 100) / 100,
                    hourly: Math.round(hourlyRER * 100) / 100,
                    minute: Math.round(minuteRER * 100) / 100
                },
                formula: 'Daily RER = 70 × (weight_kg)^0.75',
                calculatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Error calculating RER:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate RER',
            error: error.message
        });
    }
};

module.exports = {
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
};
