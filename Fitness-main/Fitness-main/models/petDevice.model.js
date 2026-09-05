const mongoose = require('mongoose');

const petDeviceSchema = new mongoose.Schema({
    petId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pet',
        required: true,
        unique: true,
        index: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: [true, 'Device name is required'],
        trim: true,
        maxlength: 100
    },
    deviceId: {
        type: String,
        required: [true, 'Device ID is required'],
        trim: true,
        uppercase: true,
        unique: true,
        match: [/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'Device ID must be a valid BLE/MAC address']
    },
    serviceUUID: { type: String, trim: true },
    characteristicUUID: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date },
    firmwareVersion: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 500 },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

petDeviceSchema.index({ petId: 1, deviceId: 1 });

// Update the updatedAt field before saving
petDeviceSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('PetDevice', petDeviceSchema);
