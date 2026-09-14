const crypto = require('crypto');
const Device = require('../models/device.model');
const { DEVICE_STATUSES } = require('../models/device.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const config = require('../config/config');

/** Normalise a device code as typed by the firmware team (spaces/dashes are common). */
const normaliseImei = (raw) => String(raw || '').replace(/[\s-]/g, '').toUpperCase();

/**
 * Validate an IMEI and return an error message, or null when it is fine.
 * `allowChecksumFailure` exists because some pre-production units carry
 * non-Luhn test IMEIs; the caller can opt out explicitly.
 */
const validateImei = (imei, allowChecksumFailure) => {
  if (!imei) return 'IMEI is required';
  if (!/^[0-9]{15}$/.test(imei)) return 'IMEI must be exactly 15 digits';
  if (!allowChecksumFailure && !Device.isValidImei(imei)) {
    return 'IMEI failed its checksum — please re-check the digits';
  }
  return null;
};

/** Canonical AA:BB:CC:DD:EE:FF, or null when the input is not 12 hex digits. */
const normaliseMac = (raw) => Device.normaliseMac(raw);

/**
 * A unit needs all three identifiers to be usable in the field: the MAC to
 * connect over BLE, the IMEI for the LTE module, and the ICCID for its SIM.
 * Returns an error message, or null when the set is complete and well-formed.
 */
const validateMac = (mac, raw) => {
  if (!raw) return 'MAC address is required';
  if (!mac) return 'MAC address must be 12 hex digits (AA:BB:CC:DD:EE:FF)';
  return null;
};

const validateIccid = (iccid) => {
  if (!iccid) return 'ICCID is required';
  // ICCIDs are 19 or 20 digits; some carriers print a trailing check digit.
  if (!/^[0-9]{19,20}$/.test(iccid)) return 'ICCID must be 19 or 20 digits';
  return null;
};

/**
 * Random handle printed into the label URL. 20 base58-ish chars (~117 bits) —
 * far too sparse to guess, and unambiguous when a human reads it off a label
 * (no 0/O or 1/l/I).
 */
const QR_TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const generateQrToken = () => {
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += QR_TOKEN_ALPHABET[bytes[i] % QR_TOKEN_ALPHABET.length];
  return out;
};

/**
 * The string that actually gets encoded into the QR.
 *
 * A generic phone camera opens this as a web page (onboarding / app store
 * hand-off); the Marshee app reads the query string directly and goes straight
 * to BLE pairing. MAC is sent without colons to keep the QR small enough to
 * print legibly at label size.
 */
const buildQrPayload = (device) => {
  const params = new URLSearchParams({
    m: (device.macAddress || '').replace(/:/g, ''),
    i: device.imei,
    c: device.iccid || '',
    t: device.qrToken
  });
  return `${config.deviceActivationBaseUrl}?${params.toString()}`;
};

/** What the console needs to render and print one label. */
const qrLabelFor = (device) => ({
  id: device._id,
  imei: device.imei,
  macAddress: device.macAddress,
  iccid: device.iccid,
  model: device.model,
  serialNumber: device.serialNumber,
  batchNumber: device.batchNumber,
  qrToken: device.qrToken,
  qrGeneratedAt: device.qrGeneratedAt,
  qrPrintedAt: device.qrPrintedAt,
  qrPrintCount: device.qrPrintCount,
  qrPayload: buildQrPayload(device)
});

// @desc    Register a single device
// @route   POST /api/v1/devices
// @access  Staff (admin, subadmin)
exports.createDevice = asyncHandler(async (req, res, next) => {
  const {
    imei: rawImei,
    macAddress: rawMac,
    serialNumber,
    iccid,
    msisdn,
    model,
    hardwareRevision,
    firmwareVersion,
    batchNumber,
    manufacturedAt,
    status,
    notes,
    allowChecksumFailure
  } = req.body;

  const imei = normaliseImei(rawImei);
  const macAddress = normaliseMac(rawMac);
  const cleanIccid = iccid ? String(iccid).replace(/[\s-]/g, '').toUpperCase() : null;

  const imeiError = validateImei(imei, allowChecksumFailure === true);
  if (imeiError) return next(new ErrorResponse(imeiError, StatusCodes.BAD_REQUEST));

  // MAC and ICCID are not optional extras — the QR label is useless without
  // them, since the app cannot pair over BLE or identify the SIM.
  const macError = validateMac(macAddress, rawMac);
  if (macError) return next(new ErrorResponse(macError, StatusCodes.BAD_REQUEST));

  const iccidError = validateIccid(cleanIccid);
  if (iccidError) return next(new ErrorResponse(iccidError, StatusCodes.BAD_REQUEST));

  if (!model || !String(model).trim()) {
    return next(new ErrorResponse('Device model is required', StatusCodes.BAD_REQUEST));
  }

  if (status && !DEVICE_STATUSES.includes(status)) {
    return next(new ErrorResponse(
      `Invalid status. Must be one of: ${DEVICE_STATUSES.join(', ')}`,
      StatusCodes.BAD_REQUEST
    ));
  }

  const existing = await Device.findOne({ imei });
  if (existing) {
    return next(new ErrorResponse('A device with this IMEI is already registered', StatusCodes.CONFLICT));
  }

  const macClash = await Device.findOne({ macAddress });
  if (macClash) {
    return next(new ErrorResponse('A device with this MAC address is already registered', StatusCodes.CONFLICT));
  }

  const cleanSerial = serialNumber ? String(serialNumber).trim().toUpperCase() : null;
  if (cleanSerial) {
    const serialClash = await Device.findOne({ serialNumber: cleanSerial });
    if (serialClash) {
      return next(new ErrorResponse('A device with this serial number is already registered', StatusCodes.CONFLICT));
    }
  }

  const initialStatus = status || 'registered';

  const device = await Device.create({
    imei,
    macAddress,
    serialNumber: cleanSerial,
    iccid: cleanIccid,
    msisdn: msisdn ? String(msisdn).trim() : null,
    model: String(model).trim(),
    hardwareRevision: hardwareRevision || null,
    firmwareVersion: firmwareVersion || null,
    batchNumber: batchNumber ? String(batchNumber).trim().toUpperCase() : null,
    manufacturedAt: manufacturedAt || null,
    status: initialStatus,
    notes: notes || undefined,
    registeredBy: req.user._id,
    history: [{ from: null, to: initialStatus, note: 'Registered', by: req.user._id }]
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: 'Device registered successfully',
    data: device
  });
});

// @desc    Register many devices at once (one row per unit off the line)
// @route   POST /api/v1/devices/bulk
// @access  Staff (admin, subadmin)
exports.bulkCreateDevices = asyncHandler(async (req, res, next) => {
  const { devices, allowChecksumFailure } = req.body;

  if (!Array.isArray(devices) || devices.length === 0) {
    return next(new ErrorResponse('Provide a non-empty `devices` array', StatusCodes.BAD_REQUEST));
  }
  if (devices.length > 500) {
    return next(new ErrorResponse('Register at most 500 devices per request', StatusCodes.BAD_REQUEST));
  }

  const skipChecksum = allowChecksumFailure === true;
  const results = { registered: [], failed: [] };

  // Reject duplicates inside the payload itself before touching the DB
  const seen = new Set();
  const seenMacs = new Set();

  for (let i = 0; i < devices.length; i++) {
    const row = devices[i] || {};
    const imei = normaliseImei(row.imei);
    const macAddress = normaliseMac(row.macAddress);
    const rowIccid = row.iccid ? String(row.iccid).replace(/[\s-]/g, '').toUpperCase() : null;
    const rowRef = { row: i + 1, imei: row.imei ?? null };

    const imeiError = validateImei(imei, skipChecksum);
    if (imeiError) {
      results.failed.push({ ...rowRef, reason: imeiError });
      continue;
    }
    if (seen.has(imei)) {
      results.failed.push({ ...rowRef, reason: 'Duplicate IMEI within this upload' });
      continue;
    }
    const macError = validateMac(macAddress, row.macAddress);
    if (macError) {
      results.failed.push({ ...rowRef, reason: macError });
      continue;
    }
    if (seenMacs.has(macAddress)) {
      results.failed.push({ ...rowRef, reason: 'Duplicate MAC address within this upload' });
      continue;
    }
    const iccidError = validateIccid(rowIccid);
    if (iccidError) {
      results.failed.push({ ...rowRef, reason: iccidError });
      continue;
    }
    if (!row.model || !String(row.model).trim()) {
      results.failed.push({ ...rowRef, reason: 'Device model is required' });
      continue;
    }
    if (row.status && !DEVICE_STATUSES.includes(row.status)) {
      results.failed.push({ ...rowRef, reason: `Invalid status "${row.status}"` });
      continue;
    }
    seen.add(imei);
    seenMacs.add(macAddress);

    const cleanSerial = row.serialNumber ? String(row.serialNumber).trim().toUpperCase() : null;
    const initialStatus = row.status || 'registered';

    try {
      const device = await Device.create({
        imei,
        macAddress,
        serialNumber: cleanSerial,
        iccid: rowIccid,
        msisdn: row.msisdn ? String(row.msisdn).trim() : null,
        model: String(row.model).trim(),
        hardwareRevision: row.hardwareRevision || null,
        firmwareVersion: row.firmwareVersion || null,
        batchNumber: row.batchNumber ? String(row.batchNumber).trim().toUpperCase() : null,
        manufacturedAt: row.manufacturedAt || null,
        status: initialStatus,
        notes: row.notes || undefined,
        registeredBy: req.user._id,
        history: [{ from: null, to: initialStatus, note: 'Registered (bulk)', by: req.user._id }]
      });
      results.registered.push({ ...rowRef, id: device._id, imei: device.imei });
    } catch (err) {
      // 11000 = duplicate key; the unit is already in the registry
      const reason = err.code === 11000
        ? 'Already registered (IMEI, MAC or serial number in use)'
        : (err.message || 'Failed to register');
      results.failed.push({ ...rowRef, reason });
    }
  }

  res.status(results.registered.length ? StatusCodes.CREATED : StatusCodes.BAD_REQUEST).json({
    success: results.registered.length > 0,
    message: `${results.registered.length} registered, ${results.failed.length} failed`,
    data: results
  });
});

// @desc    List devices with filters
// @route   GET /api/v1/devices
// @access  Staff (admin, subadmin)
exports.getDevices = asyncHandler(async (req, res, next) => {
  const {
    search,
    status,
    model,
    batchNumber,
    firmwareVersion,
    assignedTo,
    hasQr,
    page = 1,
    limit = 25
  } = req.query;

  const filter = {};

  // "Which units still need a label printed?" — the firmware team's main view.
  if (hasQr === 'true') filter.qrToken = { $type: 'string' };
  else if (hasQr === 'false') filter.qrToken = null;
  if (status) filter.status = status;
  if (model) filter.model = model;
  if (batchNumber) filter.batchNumber = String(batchNumber).toUpperCase();
  if (firmwareVersion) filter.firmwareVersion = firmwareVersion;
  if (assignedTo) filter.assignedTo = assignedTo;

  if (search) {
    // Escape so an operator pasting an odd code cannot break the regex
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [
      { imei: rx },
      { macAddress: rx },
      { serialNumber: rx },
      { iccid: rx },
      { msisdn: rx },
      { batchNumber: rx }
    ];
    // A MAC pasted bare or with dashes still has to find the colon-form record.
    const asMac = normaliseMac(search);
    if (asMac) filter.$or.push({ macAddress: asMac });
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

  const [devices, total] = await Promise.all([
    Device.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .populate('registeredBy', 'name email')
      .populate('assignedTo', 'name email phoneNumber')
      .lean(),
    Device.countDocuments(filter)
  ]);

  res.status(StatusCodes.OK).json({
    success: true,
    count: devices.length,
    total,
    currentPage: pageNum,
    totalPages: Math.ceil(total / perPage) || 1,
    data: devices
  });
});

// @desc    Counts by status, for the console header
// @route   GET /api/v1/devices/stats
// @access  Staff (admin, subadmin)
exports.getDeviceStats = asyncHandler(async (req, res, next) => {
  const [byStatus, total, qrGenerated, qrPrinted] = await Promise.all([
    Device.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Device.countDocuments(),
    Device.countDocuments({ qrToken: { $type: 'string' } }),
    Device.countDocuments({ qrPrintedAt: { $ne: null } })
  ]);

  // Always return every status, so the UI doesn't have to fill gaps
  const counts = DEVICE_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  byStatus.forEach((row) => { if (row._id) counts[row._id] = row.count; });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      total,
      byStatus: counts,
      // QR coverage — how many units are still waiting on a label
      qr: {
        generated: qrGenerated,
        pending: total - qrGenerated,
        printed: qrPrinted
      }
    }
  });
});

// @desc    Look a device up by its code — the "is this unit ours?" check
// @route   GET /api/v1/devices/lookup/:imei
// @access  Staff (admin, subadmin)
exports.lookupDeviceByImei = asyncHandler(async (req, res, next) => {
  const imei = normaliseImei(req.params.imei);

  const device = await Device.findOne({ imei })
    .populate('registeredBy', 'name email')
    .populate('assignedTo', 'name email phoneNumber');

  if (!device) {
    return next(new ErrorResponse('No device registered with this IMEI', StatusCodes.NOT_FOUND));
  }

  res.status(StatusCodes.OK).json({ success: true, data: device });
});

// @desc    Get one device
// @route   GET /api/v1/devices/:id
// @access  Staff (admin, subadmin)
exports.getDeviceById = asyncHandler(async (req, res, next) => {
  const device = await Device.findById(req.params.id)
    .populate('registeredBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('assignedTo', 'name email phoneNumber')
    .populate('history.by', 'name email');

  if (!device) {
    return next(new ErrorResponse('Device not found', StatusCodes.NOT_FOUND));
  }

  res.status(StatusCodes.OK).json({ success: true, data: device });
});

// @desc    Update a device (status, firmware, notes, assignment)
// @route   PUT /api/v1/devices/:id
// @access  Staff (admin, subadmin)
exports.updateDevice = asyncHandler(async (req, res, next) => {
  const device = await Device.findById(req.params.id);
  if (!device) {
    return next(new ErrorResponse('Device not found', StatusCodes.NOT_FOUND));
  }

  const {
    macAddress: rawMac,
    serialNumber,
    iccid,
    msisdn,
    model,
    hardwareRevision,
    firmwareVersion,
    batchNumber,
    manufacturedAt,
    status,
    notes,
    assignedTo,
    assignedPet,
    order,
    statusNote
  } = req.body;

  // IMEI is the unit's identity — it is deliberately not editable. Delete and
  // re-register if a unit was entered under the wrong code.
  if (req.body.imei && normaliseImei(req.body.imei) !== device.imei) {
    return next(new ErrorResponse(
      'IMEI cannot be changed. Delete the record and register the device again.',
      StatusCodes.BAD_REQUEST
    ));
  }

  if (status && !DEVICE_STATUSES.includes(status)) {
    return next(new ErrorResponse(
      `Invalid status. Must be one of: ${DEVICE_STATUSES.join(', ')}`,
      StatusCodes.BAD_REQUEST
    ));
  }

  // MAC may be corrected (a board swap, or a typo caught at QC), but it must
  // stay unique and well-formed. Changing it invalidates any printed label,
  // so the QR is dropped and has to be regenerated deliberately.
  if (rawMac !== undefined) {
    const macAddress = normaliseMac(rawMac);
    const macError = validateMac(macAddress, rawMac);
    if (macError) return next(new ErrorResponse(macError, StatusCodes.BAD_REQUEST));

    if (macAddress !== device.macAddress) {
      const clash = await Device.findOne({ macAddress, _id: { $ne: device._id } });
      if (clash) {
        return next(new ErrorResponse('A device with this MAC address is already registered', StatusCodes.CONFLICT));
      }
      if (device.qrToken) {
        device.qrToken = null;
        device.qrGeneratedAt = null;
        device.qrGeneratedBy = null;
        device.qrPrintedAt = null;
        device.qrPrintCount = 0;
        device.history.push({
          from: device.status,
          to: device.status,
          note: 'QR invalidated — MAC address changed',
          by: req.user._id
        });
      }
      device.macAddress = macAddress;
    }
  }

  if (serialNumber !== undefined) {
    const cleanSerial = serialNumber ? String(serialNumber).trim().toUpperCase() : null;
    if (cleanSerial && cleanSerial !== device.serialNumber) {
      const clash = await Device.findOne({ serialNumber: cleanSerial, _id: { $ne: device._id } });
      if (clash) {
        return next(new ErrorResponse('A device with this serial number is already registered', StatusCodes.CONFLICT));
      }
    }
    device.serialNumber = cleanSerial;
  }

  if (iccid !== undefined) {
    const cleanIccid = iccid ? String(iccid).replace(/[\s-]/g, '').toUpperCase() : null;
    const iccidError = validateIccid(cleanIccid);
    if (iccidError) return next(new ErrorResponse(iccidError, StatusCodes.BAD_REQUEST));
    device.iccid = cleanIccid;
  }
  if (msisdn !== undefined) device.msisdn = msisdn ? String(msisdn).trim() : null;
  if (model !== undefined && String(model).trim()) device.model = String(model).trim();
  if (hardwareRevision !== undefined) device.hardwareRevision = hardwareRevision || null;
  if (firmwareVersion !== undefined) device.firmwareVersion = firmwareVersion || null;
  if (batchNumber !== undefined) device.batchNumber = batchNumber ? String(batchNumber).trim().toUpperCase() : null;
  if (manufacturedAt !== undefined) device.manufacturedAt = manufacturedAt || null;
  if (notes !== undefined) device.notes = notes;

  if (assignedTo !== undefined) {
    device.assignedTo = assignedTo || null;
    device.assignedAt = assignedTo ? new Date() : null;
  }
  if (assignedPet !== undefined) device.assignedPet = assignedPet || null;
  if (order !== undefined) device.order = order || null;

  if (status && status !== device.status) {
    device.history.push({
      from: device.status,
      to: status,
      note: statusNote || '',
      by: req.user._id
    });
    device.status = status;
    if (status === 'activated' && !device.activatedAt) device.activatedAt = new Date();
  }

  device.updatedBy = req.user._id;
  await device.save();

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Device updated successfully',
    data: device
  });
});

// @desc    Delete a device record
// @route   DELETE /api/v1/devices/:id
// @access  Admin only — removing a unit's audit trail is not a sub-admin action
exports.deleteDevice = asyncHandler(async (req, res, next) => {
  const device = await Device.findById(req.params.id);
  if (!device) {
    return next(new ErrorResponse('Device not found', StatusCodes.NOT_FOUND));
  }

  await device.deleteOne();

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Device deleted successfully',
    data: {}
  });
});

// ---------------------------------------------------------------------------
// QR labels
//
// The label is what turns a boxed unit into something a customer can set up
// without typing anything: it carries the MAC (BLE pairing), the IMEI (LTE
// module) and the ICCID (SIM), which are exactly the three identifiers the app
// needs to talk to the collar.
// ---------------------------------------------------------------------------

// @desc    Generate (or regenerate) a device's QR label
// @route   POST /api/v1/devices/:id/qr
// @access  Staff (admin, subadmin)
exports.generateDeviceQr = asyncHandler(async (req, res, next) => {
  const device = await Device.findById(req.params.id);
  if (!device) {
    return next(new ErrorResponse('Device not found', StatusCodes.NOT_FOUND));
  }

  // A unit missing any of the three identifiers would produce a label the app
  // cannot act on, so refuse rather than print something half-usable.
  if (!device.macAddress || !device.iccid) {
    return next(new ErrorResponse(
      'Device is missing its MAC address or ICCID — add them before generating a QR',
      StatusCodes.BAD_REQUEST
    ));
  }

  // Regenerating is deliberate: it kills every label already printed for this
  // unit, so the caller has to ask for it explicitly.
  if (device.qrToken && req.body.regenerate !== true) {
    return next(new ErrorResponse(
      'This device already has a QR. Pass regenerate:true to issue a new one and invalidate the old label.',
      StatusCodes.CONFLICT
    ));
  }

  const wasRegenerated = Boolean(device.qrToken);

  device.qrToken = generateQrToken();
  device.qrGeneratedAt = new Date();
  device.qrGeneratedBy = req.user._id;
  device.qrPrintedAt = null;
  device.qrPrintCount = 0;
  device.updatedBy = req.user._id;
  device.history.push({
    from: device.status,
    to: device.status,
    note: wasRegenerated ? 'QR regenerated — previous label invalidated' : 'QR generated',
    by: req.user._id
  });

  await device.save();

  res.status(StatusCodes.OK).json({
    success: true,
    message: wasRegenerated ? 'QR regenerated — reprint the label' : 'QR generated successfully',
    data: qrLabelFor(device)
  });
});

// @desc    Generate QR labels for a batch of devices in one pass
// @route   POST /api/v1/devices/qr/bulk
// @access  Staff (admin, subadmin)
exports.bulkGenerateDeviceQr = asyncHandler(async (req, res, next) => {
  const { ids, batchNumber, limit = 200 } = req.body;

  const filter = { qrToken: null };
  if (Array.isArray(ids) && ids.length) filter._id = { $in: ids };
  else if (batchNumber) filter.batchNumber = String(batchNumber).trim().toUpperCase();

  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  const devices = await Device.find(filter).limit(cap);

  const generated = [];
  const skipped = [];

  for (const device of devices) {
    if (!device.macAddress || !device.iccid) {
      skipped.push({ id: device._id, imei: device.imei, reason: 'Missing MAC address or ICCID' });
      continue;
    }
    device.qrToken = generateQrToken();
    device.qrGeneratedAt = new Date();
    device.qrGeneratedBy = req.user._id;
    device.updatedBy = req.user._id;
    device.history.push({ from: device.status, to: device.status, note: 'QR generated (bulk)', by: req.user._id });
    await device.save();
    generated.push(qrLabelFor(device));
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${generated.length} QR labels generated, ${skipped.length} skipped`,
    data: { generated, skipped }
  });
});

// @desc    Fetch print-ready label data for a set of devices
// @route   POST /api/v1/devices/qr/labels
// @access  Staff (admin, subadmin)
exports.getQrLabels = asyncHandler(async (req, res, next) => {
  const { ids, batchNumber, limit = 200 } = req.body;

  const filter = { qrToken: { $type: 'string' } };
  if (Array.isArray(ids) && ids.length) filter._id = { $in: ids };
  else if (batchNumber) filter.batchNumber = String(batchNumber).trim().toUpperCase();

  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  const devices = await Device.find(filter).sort({ createdAt: -1 }).limit(cap).lean();

  res.status(StatusCodes.OK).json({
    success: true,
    count: devices.length,
    data: devices.map(qrLabelFor)
  });
});

// @desc    Record that labels went to a printer
// @route   POST /api/v1/devices/qr/printed
// @access  Staff (admin, subadmin)
exports.markQrPrinted = asyncHandler(async (req, res, next) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return next(new ErrorResponse('Provide a non-empty `ids` array', StatusCodes.BAD_REQUEST));
  }

  const result = await Device.updateMany(
    { _id: { $in: ids }, qrToken: { $type: 'string' } },
    { $set: { qrPrintedAt: new Date(), updatedBy: req.user._id }, $inc: { qrPrintCount: 1 } }
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${result.modifiedCount} device(s) marked as printed`,
    data: { modified: result.modifiedCount }
  });
});

// ---------------------------------------------------------------------------
// Customer-facing activation
// ---------------------------------------------------------------------------

// @desc    Resolve a scanned label — "is this a real Marshee unit, and is it free?"
// @route   GET /api/v1/devices/activate/:token
// @access  Public (the customer has not logged in yet when they scan)
exports.getActivationPayload = asyncHandler(async (req, res, next) => {
  const token = String(req.params.token || '').trim();

  const device = await Device.findOne({ qrToken: token });
  if (!device) {
    return next(new ErrorResponse('This QR code is not recognised', StatusCodes.NOT_FOUND));
  }
  if (device.status === 'decommissioned') {
    return next(new ErrorResponse('This device has been retired and cannot be activated', StatusCodes.GONE));
  }

  // Deliberately narrow: enough for the app to pair and for the web page to
  // greet the customer, but no owner details to an unauthenticated caller.
  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      macAddress: device.macAddress,
      imei: device.imei,
      iccid: device.iccid,
      model: device.model,
      firmwareVersion: device.firmwareVersion,
      status: device.status,
      alreadyClaimed: Boolean(device.assignedTo)
    }
  });
});

// @desc    Bind a scanned device to the signed-in customer
// @route   POST /api/v1/devices/activate/:token/claim
// @access  Private (any logged-in user)
exports.claimDevice = asyncHandler(async (req, res, next) => {
  const token = String(req.params.token || '').trim();
  const { petId } = req.body;

  const device = await Device.findOne({ qrToken: token });
  if (!device) {
    return next(new ErrorResponse('This QR code is not recognised', StatusCodes.NOT_FOUND));
  }
  if (device.status === 'decommissioned') {
    return next(new ErrorResponse('This device has been retired and cannot be activated', StatusCodes.GONE));
  }

  // Re-scanning your own collar is normal (new phone, re-install); someone
  // else's is not.
  if (device.assignedTo && String(device.assignedTo) !== String(req.user._id)) {
    return next(new ErrorResponse(
      'This device is already registered to another account. Please contact support.',
      StatusCodes.CONFLICT
    ));
  }

  const firstClaim = !device.assignedTo;
  const previousStatus = device.status;

  device.assignedTo = req.user._id;
  if (petId) device.assignedPet = petId;
  if (!device.assignedAt) device.assignedAt = new Date();
  if (!device.activatedAt) device.activatedAt = new Date();
  device.lastSeenAt = new Date();

  if (device.status !== 'activated') {
    device.status = 'activated';
    device.history.push({
      from: previousStatus,
      to: 'activated',
      note: firstClaim ? 'Claimed by customer via QR scan' : 'Re-activated by owner via QR scan',
      by: req.user._id
    });
  }

  await device.save();

  res.status(StatusCodes.OK).json({
    success: true,
    message: firstClaim ? 'Device activated' : 'Device already yours — re-activated',
    data: {
      macAddress: device.macAddress,
      imei: device.imei,
      iccid: device.iccid,
      model: device.model,
      status: device.status,
      assignedPet: device.assignedPet
    }
  });
});
