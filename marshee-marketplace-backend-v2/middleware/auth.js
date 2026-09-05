const jwt = require('jsonwebtoken');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/user.model');
const config = require('../config/config');

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
