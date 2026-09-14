const mongoose = require('mongoose');

/**
 * Device registry.
 *
 * The firmware team registers every unit here BEFORE it ships, keyed by its
 * IMEI. Nothing downstream (activation, fitness telemetry, warranty) should
 * accept a device code that is not in this collection.
 */

// Lifecycle of a unit, in the order it normally moves through.
const DEVICE_STATUSES = [
  'registered',     // in the DB, sitting with the firmware team
  'in_stock',       // handed to warehouse, ready to ship
  'assigned',       // allocated to a customer/order, not yet powered on
  'activated',      // seen by the fitness backend, paired to a pet
  'faulty',         // failed QC or returned broken
  'returned',       // back from a customer, not yet re-tested
  'decommissioned'  // permanently retired, never to be reissued
];

const deviceSchema = new mongoose.Schema({
  // Primary device code. 15-digit IMEI for cellular units.
  imei: {
    type: String,
    required: [true, 'IMEI is required'],
    unique: true,
    trim: true,
    uppercase: true,
    match: [/^[0-9]{15}$/, 'IMEI must be exactly 15 digits']
  },

  // BLE MAC of the collar. The app connects over Bluetooth by this address, so
  // it is as much a part of the unit's identity as the IMEI. Stored normalised
  // to upper-case colon form (AA:BB:CC:DD:EE:FF).
  macAddress: {
    type: String,
    trim: true,
    uppercase: true,
    default: null,
    match: [/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'MAC address must look like AA:BB:CC:DD:EE:FF']
  },

  // Board/PCB serial printed on the unit. Optional but unique when present.
  serialNumber: {
    type: String,
    trim: true,
    uppercase: true,
    default: null
  },

  // SIM identifiers, for cellular collars
  iccid: { type: String, trim: true, uppercase: true, default: null },
  msisdn: { type: String, trim: true, default: null },

  // Hardware identity
  model: {
    type: String,
    required: [true, 'Device model is required'],
    trim: true
  },
  hardwareRevision: { type: String, trim: true, default: null },
  firmwareVersion: { type: String, trim: true, default: null },

  // Manufacturing traceability
  batchNumber: { type: String, trim: true, uppercase: true, default: null },
  manufacturedAt: { type: Date, default: null },

  status: {
    type: String,
    enum: DEVICE_STATUSES,
    default: 'registered',
    index: true
  },

  // Set once the unit is allocated to a customer
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedPet: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  assignedAt: { type: Date, default: null },

  // First time the device reported in to the fitness backend
  activatedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },

  notes: { type: String, trim: true, maxlength: [1000, 'Notes cannot be more than 1000 characters'] },

  // --- QR label -----------------------------------------------------------
  // The printed label carries MAC + IMEI + ICCID so the app can both pair over
  // BLE and verify the unit against this registry. `qrToken` is the random
  // handle in that URL: it proves the scan came off a real label and is what a
  // customer's claim is matched against. Regenerating it invalidates old prints.
  qrToken: { type: String, trim: true, default: null },
  qrGeneratedAt: { type: Date, default: null },
  qrGeneratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Bumped each time the firmware team sends the label to a printer, so a unit
  // that was printed twice is visible rather than silently double-labelled.
  qrPrintedAt: { type: Date, default: null },
  qrPrintCount: { type: Number, default: 0 },

  // Audit — who put this unit in the registry and who touched it last
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Append-only trail of status changes, so a unit's history survives edits
  history: [{
    from: { type: String },
    to: { type: String },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }]
}, { timestamps: true });

// Serial numbers are unique only among devices that have one.
deviceSchema.index(
  { serialNumber: 1 },
  { name: 'serialNumber_1', unique: true, partialFilterExpression: { serialNumber: { $type: 'string' } } }
);

// MAC addresses are unique only among devices that have one, same as serials.
deviceSchema.index(
  { macAddress: 1 },
  { name: 'macAddress_1', unique: true, partialFilterExpression: { macAddress: { $type: 'string' } } }
);

// The claim lookup hits this on every scan, and a token must never collide.
deviceSchema.index(
  { qrToken: 1 },
  { name: 'qrToken_1', unique: true, partialFilterExpression: { qrToken: { $type: 'string' } } }
);

// Supports the console's default listing (newest first, optionally by status)
deviceSchema.index({ createdAt: -1 });
deviceSchema.index({ batchNumber: 1 });

/**
 * Luhn checksum over the 15 IMEI digits. A typo'd IMEI almost always fails
 * this, which is what stops a mistyped unit entering the registry.
 */
deviceSchema.statics.isValidImei = function (imei) {
  if (!/^[0-9]{15}$/.test(imei || '')) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = Number(imei[i]);
    // Double every second digit counting from the right (i.e. even indices from the left)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

/**
 * Accept a MAC however the firmware team pastes it — colons, dashes or bare
 * hex — and return the canonical AA:BB:CC:DD:EE:FF form, or null if it is not
 * twelve hex digits. Mirrors normalizeDeviceId() in the mobile app so the same
 * collar yields the same string on both sides.
 */
deviceSchema.statics.normaliseMac = function (raw) {
  const hex = String(raw || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
};

deviceSchema.statics.DEVICE_STATUSES = DEVICE_STATUSES;

module.exports = mongoose.model('Device', deviceSchema);
module.exports.DEVICE_STATUSES = DEVICE_STATUSES;
