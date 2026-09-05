const mongoose = require('mongoose');

const petFitnessSessionSchema = new mongoose.Schema({
    // Session identification
    petId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pet',
        required: true,
        index: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    
    // Session metadata
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    receivedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    firmwareVersion: {
        type: String,
        default: '1.0.0'
    },
    deviceId: {
        type: String,
        required: [true, 'Device ID is required'],
        trim: true,
        uppercase: true,
        index: true,
        match: [/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'Device ID must be a valid BLE/MAC address']
    },
    
    // Data structure information
    columns: {
        type: [String],
        required: true,
        default: [
            'roll', 'pitch',                     // Orientation (2)
            'temperature',                        // Temperature (1)
            'acc_x', 'acc_y', 'acc_z',           // Accelerometer (3)
            'gyr_x', 'gyr_y', 'gyr_z',           // Gyroscope (3)
            'steps', 'shakes', 'scratches', 'jumps', 'licks', 'freefalls', // Activity counters (6)
            'rest_periods', 'walking', 'trotting', 'running', 'sprinting', // Movement types (5)
            'rolling_play', 'digging', 'limping', 'tail_wags', // Behavioral activities (4)
            'stairs_up', 'stairs_down', 'sniffing' // Additional activities (3)
        ]
    },
    sampleRateHz: {
        type: Number,
        required: true,
        default: 50
    },
    
    // Time window information
    startTsMs: {
        type: Number,
        required: true,
        index: true
    },
    endTsMs: {
        type: Number,
        required: true,
        index: true
    },
    
    // Data statistics
    recordCount: {
        type: Number,
        required: true,
        default: 0
    },
    dataSizeBytes: {
        type: Number,
        default: 0
    },
    compressedSizeBytes: {
        type: Number,
        default: 0
    },
    
    // Storage information
    csvGzipPath: {
        type: String,
        required: true
    },
    checksum: {
        type: String,
        required: true
    },
    checksumAlgorithm: {
        type: String,
        default: 'sha256'
    },
    
    // Processing status
    status: {
        type: String,
        enum: ['processing', 'completed', 'failed', 'archived'],
        default: 'processing',
        index: true
    },
    processingErrors: [{
        timestamp: Date,
        error: String,
        details: mongoose.Schema.Types.Mixed
    }],
    
    // Data quality metrics
    dataQuality: {
        completeness: {
            type: Number,
            min: 0,
            max: 100,
            default: 100
        },
        validity: {
            type: Number,
            min: 0,
            max: 100,
            default: 100
        },
        anomalies: [{
            timestamp: Number,
            column: String,
            value: mongoose.Schema.Types.Mixed,
            severity: {
                type: String,
                enum: ['low', 'medium', 'high', 'critical']
            }
        }]
    },
    
    // Aggregated metrics for quick access
    aggregatedMetrics: {
        avgAccX: Number,
        avgAccY: Number,
        avgAccZ: Number,
        avgGyrX: Number,
        avgGyrY: Number,
        avgGyrZ: Number,
        avgRoll: Number,
        avgPitch: Number,
        avgTemperature: Number,
        totalSteps: Number,
        totalShakes: Number,
        totalScratches: Number,
        totalJumps: Number,
        totalLicks: Number,
        totalFreefalls: Number,
        totalRestPeriods: Number,
        totalWalking: Number,
        totalTrotting: Number,
        totalRunning: Number,
        totalSprinting: Number,
        totalRollingPlay: Number,
        totalDigging: Number,
        totalLimping: Number,
        totalTailWags: Number,
        totalStairsUp: Number,
        totalStairsDown: Number,
        totalSniffing: Number,
        totalCalories: Number,
        minTemperature: Number,
        maxTemperature: Number,
        activityIntensity: {
            type: String,
            enum: ['rest', 'low', 'moderate', 'high', 'very_high']
        }
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    archivedAt: {
        type: Date
    }
});

// Indexes for efficient queries
petFitnessSessionSchema.index({ petId: 1, startTsMs: -1 });
petFitnessSessionSchema.index({ ownerId: 1, startTsMs: -1 });
petFitnessSessionSchema.index({ receivedAt: -1 });
petFitnessSessionSchema.index({ status: 1, receivedAt: -1 });
petFitnessSessionSchema.index({ petId: 1, deviceId: 1, startTsMs: -1 });
petFitnessSessionSchema.index({ ownerId: 1, deviceId: 1, startTsMs: -1 });

// Virtual for session duration in milliseconds
petFitnessSessionSchema.virtual('durationMs').get(function() {
    return this.endTsMs - this.startTsMs;
});

// Virtual for session duration in seconds
petFitnessSessionSchema.virtual('durationSeconds').get(function() {
    return Math.round((this.endTsMs - this.startTsMs) / 1000);
});

// Virtual for compression ratio
petFitnessSessionSchema.virtual('compressionRatio').get(function() {
    if (this.dataSizeBytes === 0) return 0;
    return Math.round((1 - this.compressedSizeBytes / this.dataSizeBytes) * 100);
});

// Virtual for data density (records per second)
petFitnessSessionSchema.virtual('dataDensity').get(function() {
    const durationSeconds = this.durationSeconds;
    if (durationSeconds === 0) return 0;
    return Math.round(this.recordCount / durationSeconds);
});

// Ensure virtual fields are serialized
petFitnessSessionSchema.set('toJSON', { virtuals: true });

// Pre-save middleware to update timestamps
petFitnessSessionSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Static method to generate session ID (pet-scoped)
petFitnessSessionSchema.statics.generateSessionId = function(petId, startTsMs) {
    return `${petId}_${startTsMs}_${Date.now()}`;
};

// Static method to calculate checksum
petFitnessSessionSchema.statics.calculateChecksum = function(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
};

module.exports = mongoose.model('PetFitnessSession', petFitnessSessionSchema);
