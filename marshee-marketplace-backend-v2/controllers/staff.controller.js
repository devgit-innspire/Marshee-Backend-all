const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const config = require('../config/config');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { sendSubadminPasswordSetupEmail } = require('../utils/emailService');
const {
  PERMISSION_GROUPS,
  DEFAULT_PERMISSIONS,
  isValidPermission
} = require('../config/permissions');

/**
 * Staff (admin + sub-admin) account management. Every route here is
 * full-admin-only — sub-admins cannot create or modify staff accounts.
 */

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

/**
 * Validate and de-duplicate a permission list from the API. Rejects unknown
 * keys outright rather than silently dropping them — a typo'd key would
 * otherwise look granted in the request but never take effect.
 */
const cleanPermissions = (raw) => {
  if (raw === undefined) return { permissions: undefined, invalid: [] };
  if (!Array.isArray(raw)) return { permissions: undefined, invalid: ['(not an array)'] };

  const invalid = raw.filter((k) => !isValidPermission(k));
  return { permissions: [...new Set(raw)], invalid };
};

/** Where the sub-admin sets their password — the admin console, not the storefront. */
const consoleBaseUrl = () =>
  process.env.ADMIN_CONSOLE_URL || process.env.BASE_URL || 'http://www.marshee.com';

/** Password-setup JWT, valid for 7 days — same shape the partner flow uses. */
const buildSetupUrl = (user) => {
  const setupToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      purpose: 'password-setup',
      role: 'subadmin'
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  return `${consoleBaseUrl()}/setup-password?token=${setupToken}`;
};

// @desc    List all staff accounts (admins and sub-admins)
// @route   GET /api/v1/staff
// @access  Admin only
exports.getStaff = asyncHandler(async (req, res, next) => {
  const staff = await User.find({ role: { $in: ['admin', 'subadmin'] } })
    .select('name email role isActive permissions createdAt createdBy')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  // `password` is select:false, so we re-query the ids that have one set in
  // order to show who still has a pending invite.
  const withPassword = await User.find(
    { _id: { $in: staff.map((s) => s._id) }, password: { $exists: true, $ne: null } }
  ).select('_id').lean();
  const hasPassword = new Set(withPassword.map((u) => String(u._id)));

  res.status(StatusCodes.OK).json({
    success: true,
    count: staff.length,
    data: staff.map((s) => ({ ...s, passwordSet: hasPassword.has(String(s._id)) }))
  });
});

// @desc    Create a sub-admin and email them a password-setup link
// @route   POST /api/v1/staff
// @access  Admin only
exports.createSubadmin = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;

  const { permissions, invalid } = cleanPermissions(req.body.permissions);
  if (invalid.length) {
    return next(new ErrorResponse(`Unknown permission(s): ${invalid.join(', ')}`, StatusCodes.BAD_REQUEST));
  }

  if (!name || !String(name).trim()) {
    return next(new ErrorResponse('Name is required', StatusCodes.BAD_REQUEST));
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    return next(new ErrorResponse('Please provide a valid email address', StatusCodes.BAD_REQUEST));
  }

  const normalisedEmail = String(email).toLowerCase().trim();

  const existing = await User.findOne({ email: normalisedEmail });
  if (existing) {
    return next(new ErrorResponse('Email already registered', StatusCodes.CONFLICT));
  }

  const userData = {
    name: String(name).trim(),
    email: normalisedEmail,
    role: 'subadmin',
    // An admin who does not pick anything gets the read-only starter set rather
    // than a blank account that can sign in but see nothing.
    permissions: permissions ?? DEFAULT_PERMISSIONS,
    createdBy: req.user._id
  };

  const hasDirectPassword = password && String(password).trim().length >= 6;
  if (hasDirectPassword) {
    userData.password = String(password).trim();
  }

  const user = await User.create(userData);

  let emailSent = false;
  if (!hasDirectPassword) {
    const emailResult = await sendSubadminPasswordSetupEmail(user.email, user.name, buildSetupUrl(user));
    emailSent = emailResult.success;
    if (!emailResult.success) {
      console.error('Failed to send sub-admin password setup email:', emailResult.error);
    }
  }

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: hasDirectPassword
      ? 'Sub-admin created with password.'
      : (emailSent
        ? 'Sub-admin created. Password setup email sent.'
        : 'Sub-admin created, but the setup email could not be sent. Use "Resend invite".'),
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      permissions: user.permissions,
      passwordSet: Boolean(user.password || hasDirectPassword)
    },
    emailSent
  });
});

// @desc    Resend the password-setup link to a sub-admin who hasn't set one
// @route   POST /api/v1/staff/:id/resend-invite
// @access  Admin only
exports.resendInvite = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) {
    return next(new ErrorResponse('Staff account not found', StatusCodes.NOT_FOUND));
  }
  if (user.role !== 'subadmin') {
    return next(new ErrorResponse('Invites can only be resent to sub-admins', StatusCodes.BAD_REQUEST));
  }
  if (user.password) {
    return next(new ErrorResponse('This account already has a password set', StatusCodes.BAD_REQUEST));
  }

  const emailResult = await sendSubadminPasswordSetupEmail(user.email, user.name, buildSetupUrl(user));
  if (!emailResult.success) {
    return next(new ErrorResponse('Failed to send the setup email. Please try again.', StatusCodes.BAD_GATEWAY));
  }

  res.status(StatusCodes.OK).json({ success: true, message: 'Setup email resent' });
});

// @desc    Activate or deactivate a staff account
// @route   PATCH /api/v1/staff/:id/status
// @access  Admin only
exports.setStaffStatus = asyncHandler(async (req, res, next) => {
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return next(new ErrorResponse('`isActive` must be true or false', StatusCodes.BAD_REQUEST));
  }
  if (String(req.params.id) === String(req.user._id)) {
    return next(new ErrorResponse('You cannot change your own account status', StatusCodes.BAD_REQUEST));
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse('Staff account not found', StatusCodes.NOT_FOUND));
  }
  if (!['admin', 'subadmin'].includes(user.role)) {
    return next(new ErrorResponse('This is not a staff account', StatusCodes.BAD_REQUEST));
  }

  // Never let the last active admin be locked out
  if (user.role === 'admin' && isActive === false) {
    const activeAdmins = await User.countDocuments({ role: 'admin', isActive: { $ne: false } });
    if (activeAdmins <= 1) {
      return next(new ErrorResponse('Cannot deactivate the last active admin', StatusCodes.BAD_REQUEST));
    }
  }

  user.isActive = isActive;
  await user.save();

  res.status(StatusCodes.OK).json({
    success: true,
    message: isActive ? 'Account activated' : 'Account deactivated',
    data: { id: user._id, isActive: user.isActive }
  });
});

// @desc    Delete a sub-admin account
// @route   DELETE /api/v1/staff/:id
// @access  Admin only
exports.deleteSubadmin = asyncHandler(async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id)) {
    return next(new ErrorResponse('You cannot delete your own account', StatusCodes.BAD_REQUEST));
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse('Staff account not found', StatusCodes.NOT_FOUND));
  }
  // Admin accounts are deliberately not deletable here — deactivate instead.
  if (user.role !== 'subadmin') {
    return next(new ErrorResponse('Only sub-admin accounts can be deleted here', StatusCodes.BAD_REQUEST));
  }

  await user.deleteOne();

  res.status(StatusCodes.OK).json({ success: true, message: 'Sub-admin deleted', data: {} });
});

// @desc    The permission catalogue, for rendering the grant UI
// @route   GET /api/v1/staff/permissions
// @access  Admin only
exports.getPermissionCatalogue = asyncHandler(async (req, res, next) => {
  res.status(StatusCodes.OK).json({
    success: true,
    data: { groups: PERMISSION_GROUPS, defaults: DEFAULT_PERMISSIONS }
  });
});

// @desc    Replace a sub-admin's permission set
// @route   PATCH /api/v1/staff/:id/permissions
// @access  Admin only
exports.setStaffPermissions = asyncHandler(async (req, res, next) => {
  const { permissions, invalid } = cleanPermissions(req.body.permissions);

  if (permissions === undefined) {
    return next(new ErrorResponse('Provide a `permissions` array', StatusCodes.BAD_REQUEST));
  }
  if (invalid.length) {
    return next(new ErrorResponse(`Unknown permission(s): ${invalid.join(', ')}`, StatusCodes.BAD_REQUEST));
  }

  const staff = await User.findById(req.params.id);
  if (!staff) {
    return next(new ErrorResponse('Staff account not found', StatusCodes.NOT_FOUND));
  }
  if (!['admin', 'subadmin'].includes(staff.role)) {
    return next(new ErrorResponse('This account is not a staff account', StatusCodes.BAD_REQUEST));
  }

  // A full admin already holds everything implicitly, so storing a narrower
  // list on one would be misleading — and would read as a demotion that the
  // permission check never actually honours.
  if (staff.role === 'admin') {
    return next(new ErrorResponse(
      'Admins hold every permission by default. Change the account to a sub-admin to restrict it.',
      StatusCodes.BAD_REQUEST
    ));
  }

  staff.permissions = permissions;
  await staff.save();

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Permissions updated for ${staff.name || staff.email}`,
    data: { id: staff._id, name: staff.name, email: staff.email, permissions: staff.permissions }
  });
});
