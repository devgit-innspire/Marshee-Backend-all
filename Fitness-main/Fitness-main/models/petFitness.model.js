const mongoose = require('mongoose');

const petFitnessSchema = new mongoose.Schema({
    petId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pet',
        required: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Fitness band activity data
    timestamp: {
        type: Date,
        required: true,
        default: Date.now
    },
    // Activity metrics from fitness band
    eefalls: {
        type: Number,
        default: 0
    },
    rest: {
        type: Number,
        default: 0
    },
    walk: {
        type: Number,
        default: 0
    },
    trot: {
        type: Number,
        default: 0
    },
    run: {
        type: Number,
        default: 0
    },
    sprint: {
        type: Number,
        default: 0
    },
    rollplay: {
        type: Number,
        default: 0
    },
    dig: {
        type: Number,
        default: 0
    },
    limp: {
        type: Number,
        default: 0
    },
    tailwags: {
        type: Number,
        default: 0
    },
    stairs_up: {
        type: Number,
        default: 0
    },
    stairs_down: {
        type: Number,
        default: 0
    },
    sniff: {
        type: Number,
        default: 0
    },
    // Sensor data
    roll: {
        type: Number,
        required: true
    },
    pitch: {
        type: Number,
        required: true
    },
    temp: {
        type: Number,
        required: true
    },
    // Additional fitness metrics
    heartRate: {
        type: Number,
        min: 0
    },
    steps: {
        type: Number,
        default: 0,
        min: 0
    },
    calories: {
        type: Number,
        default: 0,
        min: 0
    },
    distance: {
        type: Number,
        default: 0,
        min: 0
    },
    // Device information
    deviceId: {
        type: String,
        required: [true, 'Device ID is required'],
        trim: true,
        uppercase: true,
        index: true,
        match: [/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'Device ID must be a valid BLE/MAC address']
    },
    // BLE specific fields
    raw: {
        type: String
    },
    attHandle: {
        type: Number
    },
    deviceCounter: {
        type: Number
    },
    // Additional activity counters from your BLE data
    shakes: {
        type: Number,
        default: 0
    },
    scratches: {
        type: Number,
        default: 0
    },
    jumps: {
        type: Number,
        default: 0
    },
    licks: {
        type: Number,
        default: 0
    },
    freefalls: {
        type: Number,
        default: 0
    },
    batteryLevel: {
        type: Number,
        min: 0,
        max: 100
    },
    signalStrength: {
        type: Number
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient queries
petFitnessSchema.index({ petId: 1, timestamp: -1 });
petFitnessSchema.index({ ownerId: 1, timestamp: -1 });
petFitnessSchema.index({ timestamp: -1 });
petFitnessSchema.index({ petId: 1, deviceId: 1, timestamp: -1 });
petFitnessSchema.index({ ownerId: 1, deviceId: 1, timestamp: -1 });

// Virtual for total activity score
petFitnessSchema.virtual('totalActivity').get(function() {
    return this.walk + this.trot + this.run + this.sprint + this.rollplay + this.dig + this.tailwags + this.stairs_up + this.stairs_down + this.sniff;
});

// Virtual for activity intensity level
petFitnessSchema.virtual('activityLevel').get(function() {
    const total = this.totalActivity;
    if (total === 0) return 'Rest';
    if (total < 10) return 'Low';
    if (total < 30) return 'Moderate';
    if (total < 60) return 'High';
    return 'Very High';
});

// Ensure virtual fields are serialized
petFitnessSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('PetFitness', petFitnessSchema);


