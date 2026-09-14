const jwt = require('jsonwebtoken');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/user.model');
const config = require('../config/config');
const { hasAnyPermission } = require('../utils/roles');

// Protect routes
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  // 1) Authorization: Bearer <token>
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
    else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  // 3. Raw cookie header (fallback)
  else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    
    if (cookies.token) {
      token = cookies.token;
    }
  }
  // 2) x-access-token header
  if (!token && req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }

  // 3) Cookie named 'token'
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  // Make sure token exists
  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route 1', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret);

    req.user = await User.findById(decoded.id);
    if (!req.user) {
      return next(new ErrorResponse('Not authorized to access this route (user not found)', 401));
    }
    // Deactivated staff accounts lose access immediately, even with a valid JWT
    if (req.user.isActive === false) {
      return next(new ErrorResponse('This account has been deactivated', 403));
    }
    console.log("req.user:-", req.user._id);

    next();
  } catch (err) {
    return next(new ErrorResponse('Not authorized to access this route 2', 401));
  }
});

// Same as protect but does NOT reject unauthenticated requests.
// Sets req.user if a valid token is present, otherwise req.user = null.
exports.optionalProtect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = await User.findById(decoded.id);
  } catch (err) {
    req.user = null;
  }

  next();
});

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorResponse(
          `User role ${req.user.role} is not authorized to access this route 3`,
          403
        )
      );
    }
    next();
  };
};

// Role groups
// -----------
// `admin`    – full access, including payment-out actions and staff/user management
// `subadmin` – day-to-day operations staff (incl. the firmware team). Everything an
//              admin can do EXCEPT payment-out actions, user records and staff creation.
exports.STAFF_ROLES = ['admin', 'subadmin'];

// Grant access to any staff member (admin or sub-admin).
exports.authorizeStaff = exports.authorize('admin', 'subadmin');

/**
 * Gate a route on a specific staff permission, e.g. requirePermission('products.pricing').
 *
 * Full admins always pass. Sub-admins must hold the key. Partners and customers
 * are rejected unless `allowPartner` is set — some routes (products, brands)
 * serve partners too, and those controllers already scope results to the
 * caller's own records, so the permission check simply does not apply to them.
 *
 * Pass several keys to require any one of them.
 */
exports.requirePermission = (...permissions) => {
  // Trailing options object, e.g. requirePermission('products.edit', { allowPartner: true })
  let options = {};
  if (permissions.length && typeof permissions[permissions.length - 1] === 'object') {
    options = permissions.pop();
  }

  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return next(new ErrorResponse('Not authorized to access this route', 401));
    }

    if (options.allowPartner && user.role === 'partner') return next();

    if (hasAnyPermission(user, ...permissions)) return next();

    return next(
      new ErrorResponse(
        `You do not have permission to do this. Required: ${permissions.join(' or ')}. Ask an admin to grant it.`,
        403
      )
    );
  };
};

// Grant access to full admins only. Use for payment-out, user records and
// staff management routes.
exports.authorizeAdminOnly = exports.authorize('admin');
