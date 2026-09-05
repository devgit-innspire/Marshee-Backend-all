const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const User = require('../models/user.model');
const Pet = require('../models/pet.model');
const Address = require('../models/address.model');
const Otp = require('../models/otp.model');
const Cart = require('../models/cart.model');
const Wishlist = require('../models/wishlist.model');
const CollectedEmail = require('../models/collectedEmail.model');
const CollectedContact = require('../models/collectedContact.model');
const admin = require('../config/firebaseAdmin');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { sendOtpEmail } = require('../utils/emailService');


// @desc    Register user (Step 1: Validate and send OTP)
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  // Validate required fields
  if (!name || !email || !password) {
    return next(new ErrorResponse('Please provide name, email, and password', 400));
  }

  // Validate email format
  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  if (!emailRegex.test(email)) {
    return next(new ErrorResponse('Please provide a valid email address', 400));
  }

  // Validate password length
  if (password.length < 6) {
    return next(new ErrorResponse('Password must be at least 6 characters', 400));
  }

  // Prevent duplicate email registration
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return next(new ErrorResponse('Email already registered', 409));
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

  // Delete any existing OTP for this email and registration purpose
  await Otp.deleteMany({ email: email.toLowerCase(), purpose: 'registration' });

  // Store registration data temporarily in OTP record (we'll use it during verification)
  // Note: Password is stored temporarily (expires in 5 minutes) and will be hashed by User model
  // Create new OTP record with registration data
  const otpRecord = await Otp.create({
    email: email.toLowerCase(),
    otp,
    purpose: 'registration',
    expiresAt,
    // Store registration data temporarily (password will be hashed by User model pre-save hook)
    registrationData: {
      name,
      email: email.toLowerCase(),
      password: password, // Plain password - will be hashed by User model
      // IMPORTANT: Public registration can ONLY create 'user' accounts.
      // Admin/Partner accounts must be created via protected flows.
      role: 'user'
    }
  });

  // Send OTP via email
  const emailResult = await sendOtpEmail(email, otp, 'registration');

  if (!emailResult.success) {
    // Delete OTP record if email failed
    await Otp.deleteOne({ _id: otpRecord._id });
    
    // Provide detailed error message for authentication issues
    if (emailResult.code === 'EAUTH') {
      return next(new ErrorResponse(
        `Email authentication failed: ${emailResult.error}\n\n` +
        'For Gmail users:\n' +
        '1. Enable 2-Step Verification: https://myaccount.google.com/security\n' +
        '2. Generate App Password: https://myaccount.google.com/apppasswords\n' +
        '3. Use the 16-character App Password in your SMTP_PASS environment variable',
        500
      ));
    }
    
    return next(new ErrorResponse(
      `Failed to send OTP email: ${emailResult.error}`,
      500
    ));
  }

  res.status(200).json({
    success: true,
    message: 'OTP sent to your email. Please verify to complete registration.',
    email: email.toLowerCase(),
    expiresIn: 300 // 5 minutes in seconds
  });
});

// @desc    Register admin (Step 1: Validate and send OTP) - ADMIN ONLY
// @route   POST /api/v1/auth/admin/register
// @access  Private (Admin)
// @desc    Register admin (direct creation, no OTP required)
// @route   POST /api/v1/auth/admin/register
// @access  Private (Admin)
exports.registerAdmin = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;

  // Validate required fields
  if (!name || !email || !password) {
    return next(new ErrorResponse('Please provide name, email, and password', 400));
  }

  // Validate email format
  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  if (!emailRegex.test(email)) {
    return next(new ErrorResponse('Please provide a valid email address', 400));
  }

  // Validate password length
  if (password.length < 6) {
    return next(new ErrorResponse('Password must be at least 6 characters', 400));
  }

  // Prevent duplicate email registration
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return next(new ErrorResponse('Email already registered', 409));
  }

  // Create admin user directly (no OTP required for admin creation)
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: password, // Will be hashed by User model pre-save hook
    role: 'admin'
  });

  // Send token response (auto-login after admin creation)
  sendTokenResponse(user, 201, res);
});

// @desc    Verify registration OTP and complete registration
// @route   POST /api/v1/auth/verify-registration-otp
// @access  Public
exports.verifyRegistrationOtp = asyncHandler(async (req, res, next) => {
  const { email, otp } = req.body;

  // Validate inputs
  if (!email || !otp) {
    return next(new ErrorResponse('Please provide email and OTP', 400));
  }

  // Find OTP record
  const otpRecord = await Otp.findOne({ 
    email: email.toLowerCase(), 
    purpose: 'registration',
    isVerified: false
  });

  if (!otpRecord) {
    return next(new ErrorResponse('OTP not found or already used. Please request a new OTP.', 400));
  }

  // Check if OTP is valid
  if (!otpRecord.isValid()) {
    await Otp.deleteOne({ _id: otpRecord._id });
    return next(new ErrorResponse('OTP has expired. Please register again.', 400));
  }

  // Check if OTP matches
  if (otpRecord.otp !== otp) {
    await otpRecord.incrementAttempts();
    
    // Check if max attempts exceeded
    if (otpRecord.attempts >= 5) {
      await Otp.deleteOne({ _id: otpRecord._id });
      return next(new ErrorResponse('Maximum OTP verification attempts exceeded. Please register again.', 400));
    }
    
    return next(new ErrorResponse(`Invalid OTP. ${5 - otpRecord.attempts} attempts remaining.`, 400));
  }

  // Check if user already exists (double-check)
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    await Otp.deleteOne({ _id: otpRecord._id });
    return next(new ErrorResponse('Email already registered', 409));
  }

  // Get registration data from OTP record
  const registrationData = otpRecord.registrationData;
  if (!registrationData) {
    await Otp.deleteOne({ _id: otpRecord._id });
    return next(new ErrorResponse('Registration data not found. Please register again.', 400));
  }

  // Create user (password will be hashed by User model pre-save hook)
  const user = await User.create({
    name: registrationData.name,
    email: registrationData.email,
    password: registrationData.password, // Plain password - will be hashed by pre-save hook
    role: registrationData.role || 'user'
  });

  // Mark OTP as verified
  await otpRecord.markAsVerified();

  // Delete verified OTP
  await Otp.deleteOne({ _id: otpRecord._id });

  // Send token response
  sendTokenResponse(user, 201, res);
});

// @desc    Login user (Step 1: Validate credentials and send OTP)
// @route   POST /api/v1/auth/login
// @access  Public

exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  console.log("logging in with email:-", email);

  // Validate email & password
  if (!email || !password) {
    return next(new ErrorResponse('Please provide an email and password', 400));
  }

  // Check for user
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if user has password set (for partners who haven't set password yet)
  if (!user.password) {
    if (user.role === 'partner') {
      return next(new ErrorResponse('Password not set. Please check your email for the password setup link.', 401));
    }
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if password matches
  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  sendTokenResponse(user, 200, res);
});


// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Set up password for partner (using JWT token from email)
// @route   POST /api/v1/auth/setup-password | POST /api/v1/auth/partner/setup-password
// @access  Public
// @body    { token: string, password: string }
// @res     { success: boolean, token: string, user: User }
exports.setupPartnerPassword = asyncHandler(async (req, res, next) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return next(new ErrorResponse('Token and password are required', 400));
  }

  if (password.length < 6) {
    return next(new ErrorResponse('Password must be at least 6 characters', 400));
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Validate token purpose
    if (decoded.purpose !== 'password-setup') {
      return next(new ErrorResponse('Invalid token purpose', 400));
    }

    // Validate role
    if (decoded.role !== 'partner') {
      return next(new ErrorResponse('This token is only for partner accounts', 403));
    }

    // Find user
    const user = await User.findById(decoded.id).select('+password');
    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Verify email matches
    if (user.email !== decoded.email) {
      return next(new ErrorResponse('Token email mismatch', 400));
    }

    // Check if password already set
    if (user.password) {
      return next(new ErrorResponse('Password has already been set for this account', 400));
    }

    // Verify user is a partner
    if (user.role !== 'partner') {
      return next(new ErrorResponse('This setup link is only for partner accounts', 403));
    }

    // Set password (will be hashed by User model pre-save hook)
    user.password = password;
    await user.save();

    // JWT for auto-login after password setup
    const authToken = user.getSignedJwtToken();

    // User without password for response
    const userResponse = await User.findById(user._id);

    // Cookie options (same as sendTokenResponse)
    const cookieDaysRaw = process.env.JWT_COOKIE_EXPIRE;
    const parsedDays = Number(cookieDaysRaw);
    const cookieDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
    const expiresMs = cookieDays * 24 * 60 * 60 * 1000;
    const cookieOptions = {
      expires: new Date(Date.now() + expiresMs),
      httpOnly: true,
      sameSite: 'lax'
    };
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.secure = true;
    }

    res
      .status(200)
      .cookie('token', authToken, cookieOptions)
      .json({
        success: true,
        token: authToken,
        user: userResponse
      });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new ErrorResponse('Invalid token', 400));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new ErrorResponse('Token has expired. Please contact support for a new setup link.', 400));
    }
    return next(new ErrorResponse('Token verification failed', 400));
  }
});

// @desc    Login (idempotent) user with Firebase UID
// @route   POST /api/v1/auth/token
// @access  Public
exports.firebaseAuth = asyncHandler(async (req, res, next) => {
  const { firebaseUID, phoneNumber, timestamp } = req.body;

  // Validate required inputs
  if (!firebaseUID || !phoneNumber || !timestamp) {
    return next(new ErrorResponse('Please provide Firebase UID, phone number and timestamp', 400));
  }

  // Basic E.164 phone validation (spaces allowed in input)
  const normalizedPhone = phoneNumber.replace(/\s/g, '');
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(normalizedPhone)) {
    return next(new ErrorResponse('Please provide a valid phone number with country code (e.g., +91 98765 43210)', 400));
  }

  // Validate timestamp and freshness (5 minutes)
  const timestampDate = new Date(timestamp);
  if (isNaN(timestampDate.getTime())) {
    return next(new ErrorResponse('Invalid timestamp format', 400));
  }
  const currentTime = new Date();
  const timeDiff = Math.abs(currentTime - timestampDate);
  const maxAllowedDiff = 5 * 60 * 1000;
  if (timeDiff > maxAllowedDiff) {
    return next(new ErrorResponse('Timestamp is too old', 400));
  }

  // Determine if user already exists
  const existingUser = await User.findOne({ firebaseUID });

  // Upsert by firebaseUID to ensure idempotency and no duplicates
  const now = new Date();
  const update = {
    $set: {
      phoneNumber: normalizedPhone,
      'profile.lastLogin': now
    },
    $setOnInsert: {
      role: 'user',
      firebaseUID: firebaseUID,
      createdAt: now
    }
  };

  const options = { new: true, upsert: true };
  const user = await User.findOneAndUpdate({ firebaseUID }, update, options);

  // Compute profile/pet flags
  const profileCompleted = Boolean(user?.profile && user.profile.isComplete);
  const hasProfile = Boolean(
    profileCompleted || user?.name || (user?.profile && (user.profile.avatar || user.profile.bio))
  );
  const petsCount = await Pet.countDocuments({ owner: user._id });
  const hasPet = petsCount > 0;
  const userExists = Boolean(existingUser);

  // Create fresh JWT and return along with user and flags
  const token = user.getSignedJwtToken();

  return res.status(200).json({
    success: true,
    token,
    userExists,
    user: {
      id: user._id,
      firebaseUID: user.firebaseUID,
      phoneNumber: user.phoneNumber,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      profile: user.profile,
      profileCompleted,
      hasProfile,
      petsCount,
      hasPet
    },
    message: 'Token created successfully'
  });
});

// @desc    Update user profile
// @route   PUT /api/v1/auth/profile
// @access  Private
// exports.updateProfile = asyncHandler(async (req, res, next) => {
//   const { name, phoneNumber, bio } = req.body;
  
//   // Find user by ID (from auth middleware)
//   const user = await User.findById(req.user.id);
  
//   if (!user) {
//     return next(new ErrorResponse('User not found', 404));
//   }
  
//   // Update fields if provided
//   if (name && (user.role === 'admin' || user.role === 'partner')) {
//     user.name = name;
//   }
//   if (phoneNumber) user.phoneNumber = phoneNumber;
//   if (bio) user.profile.bio = bio;
  
//   // Mark profile as complete
//   user.profile.isComplete = true;
  
//   await user.save();
  
//   res.status(200).json({
//     success: true,
//     message: 'Profile updated successfully',
//     data: user
//   });
// });

// Get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  // Create token
  const token = user.getSignedJwtToken();

  // Safely compute cookie expiry (defaults to 30 days if env missing/invalid)
  const cookieDaysRaw = process.env.JWT_COOKIE_EXPIRE;
  const parsedDays = Number(cookieDaysRaw);
  const cookieDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
  const expiresMs = cookieDays * 24 * 60 * 60 * 1000;

  const options = {
    expires: new Date(Date.now() + expiresMs),
    httpOnly: true,
    sameSite: 'lax'
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token: token,
      message: "Token created successfully"
    });
};

exports.updateProfile = asyncHandler(async (req, res, next) => {
  const { name, email, avatar, address } = req.body;

  // ✅ Find logged-in user
  const user = await User.findById(req.user.id);
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // ✅ Validate and update email (check uniqueness if changed)
  if (email && email !== user.email) {
    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser._id.toString() !== user._id.toString()) {
      return next(new ErrorResponse('Email already in use', 409));
    }
    user.email = email;
  }

  // ✅ Update name
  if (name !== undefined) {
    user.name = name;
  }

  // ✅ Update avatar (user.avatar field in schema)
  if (avatar !== undefined) {
    user.avatar = avatar;
    // Also update profile.avatar for consistency
    if (!user.profile) {
      user.profile = {};
    }
    user.profile.avatar = avatar;
  }

  // ✅ Handle address update
  if (address) {
    // Try to find existing non-deleted address first
    let userAddress = await Address.findOne({ 
      user: user._id, 
      isDeleted: false 
    });

    if (userAddress) {
      // Update existing address fields
      if (address.addressType) userAddress.addressType = address.addressType;
      // Email is not stored on Address; ignore address.email
      if (address.billingAddress) {
        userAddress.billingAddress = {
          ...userAddress.billingAddress,
          ...address.billingAddress
        };
      }
      if (address.shippingAddress) {
        userAddress.shippingAddress = {
          ...userAddress.shippingAddress,
          ...address.shippingAddress
        };
      }
      if (address.isDefaultShipping !== undefined) {
        userAddress.isDefaultShipping = address.isDefaultShipping;
      }
      if (address.isDefaultBilling !== undefined) {
        userAddress.isDefaultBilling = address.isDefaultBilling;
      }
      await userAddress.save();
    } else {
      // Create new address if none exists
      userAddress = await Address.create({
        user: user._id,
        addressType: address.addressType || 'home',
        billingAddress: address.billingAddress || {},
        shippingAddress: address.shippingAddress || {},
        isDefaultShipping: address.isDefaultShipping || false,
        isDefaultBilling: address.isDefaultBilling || false,
      });
    }

    // Link address to user
    user.address = userAddress._id;
  }

  // ✅ Save user updates
  await user.save();

  // ✅ Fetch updated user with populated address
  const updatedUser = await User.findById(user._id)
    .populate('address', '-__v -isDeleted -deletedAt')
    .select('-password');

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: updatedUser
  });
});


//using for login
exports.firebaseOtpVerify = asyncHandler(async(req, res, next) => {
  try {
    console.log("Firebase OTP verify called");
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("Missing or invalid authorization header");
      return res.status(401).json({ 
        success: false, 
        message: "Authorization header missing or invalid format" 
      });
    }
    console.log("Authorization header present:", authHeader.substring(0, 20) + "...");

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) {
      console.log("ID token missing from header");
      return res.status(401).json({ 
        success: false, 
        message: "ID token missing from authorization header" 
      });
    }
    
    console.log("Verifying Firebase ID token...");
    
    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      console.error("Firebase Admin not initialized");
      return res.status(500).json({ 
        success: false, 
        message: "Firebase Admin not configured. Please check server configuration." 
      });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("Firebase token verified successfully");

    const phone = decoded.phone_number;
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone number not found in token" 
      });
    }

    // Extract user information from Firebase token and request body
    const firebaseEmail = decoded.email || null;
    const firebaseName = decoded.name || null;
    const firebasePicture = decoded.picture || decoded.photoURL || null;
    const firebaseEmailVerified = decoded.email_verified || false;
    
    // Extract additional info from request body
    const { name, email, avatar, bio } = req.body || {};
    
    // First try to find by firebaseUID (most reliable - same phone number = same UID across platforms)
    let user = await User.findOne({ firebaseUID: decoded.uid });
    
    // If not found by firebaseUID, try by phoneNumber (for backward compatibility)
    if (!user) {
      user = await User.findOne({ phoneNumber: phone });
    }
    
    const isNewUser = !user;
    
    if (!user) {
      // New user - create with all available information
      const userName = name || firebaseName || `User-${phone.substring(phone.length - 4)}`;
      const userEmail = email || firebaseEmail || null;
      const userAvatar = avatar || firebasePicture || null;
      
      const userData = {
        name: userName,
        phoneNumber: phone,
        firebaseUID: decoded.uid,
        role: 'user',
        profile: {
          isComplete: false,
          lastLogin: new Date(),
          avatar: userAvatar,
          bio: bio || null
        }
      };
      
      // Add email if available
      if (userEmail) {
        userData.email = userEmail;
      }
      
      // Add avatar at root level if available
      if (userAvatar) {
        userData.avatar = userAvatar;
      }
      
      user = await User.create(userData);
      console.log("New user created with data:", {
        id: user._id,
        name: user.name,
        phone: user.phoneNumber,
        email: user.email,
        hasAvatar: !!user.avatar
      });
    } else {
      // Existing user - update missing information and last login
      let needsUpdate = false;
      
      // Update Firebase UID if not set or if it doesn't match (same phone = same UID)
      // If we found user by phoneNumber but firebaseUID doesn't match, update it
      // because Firebase guarantees same phone = same UID, and we already checked no user has this decoded.uid
      if (!user.firebaseUID || user.firebaseUID !== decoded.uid) {
        if (user.firebaseUID && user.firebaseUID !== decoded.uid) {
          // Log warning for data inconsistency tracking
          console.warn(`Firebase UID mismatch for phone ${phone}: updating from ${user.firebaseUID} to ${decoded.uid}`);
        }
        user.firebaseUID = decoded.uid;
        needsUpdate = true;
      }
      
      // Update name if not set or if provided in request
      if (name && name !== user.name) {
        user.name = name;
        needsUpdate = true;
      } else if (!user.name && firebaseName) {
        user.name = firebaseName;
        needsUpdate = true;
      }
      
      // Update email if not set or if provided in request (and valid)
      if (email && email !== user.email) {
        // Check if email is already taken by another user
        const emailExists = await User.findOne({ 
          email: email,
          _id: { $ne: user._id }
        });
        if (!emailExists) {
          user.email = email;
          needsUpdate = true;
        }
      } else if (!user.email && firebaseEmail) {
        // Check if Firebase email is already taken
        const emailExists = await User.findOne({ 
          email: firebaseEmail,
          _id: { $ne: user._id }
        });
        if (!emailExists) {
          user.email = firebaseEmail;
          needsUpdate = true;
        }
      }
      
      // Update avatar if not set or if provided in request
      if (avatar && avatar !== user.avatar) {
        user.avatar = avatar;
        if (!user.profile) user.profile = {};
        user.profile.avatar = avatar;
        needsUpdate = true;
      } else if (!user.avatar && firebasePicture) {
        user.avatar = firebasePicture;
        if (!user.profile) user.profile = {};
        user.profile.avatar = firebasePicture;
        needsUpdate = true;
      }
      
      // Update bio if provided
      if (bio !== undefined && bio !== user.profile?.bio) {
        if (!user.profile) user.profile = {};
        user.profile.bio = bio;
        needsUpdate = true;
      }
      
      // Update last login timestamp
      if (!user.profile) user.profile = {};
      user.profile.lastLogin = new Date();
      needsUpdate = true;
      
      if (needsUpdate) {
        // Only revalidate fields actually touched here (e.g. profile.lastLogin) —
        // an unrelated pre-existing gap on this document (e.g. a legacy admin/partner
        // account saved without a name) must not block login.
        await user.save({ validateModifiedOnly: true });
        console.log("Existing user updated with new information:", {
          id: user._id,
          name: user.name,
          email: user.email,
          hasAvatar: !!user.avatar
        });
      } else {
        console.log("Existing user found (no updates needed):", user._id);
      }
    }
    
    // Create your own JWT for app sessions
    const appToken = jwt.sign(
      { 
        id: user._id, 
        phoneNumber: user.phoneNumber,
        firebaseUID: decoded.uid 
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("App token generated for user:", user._id);

    // Fetch updated user with all fields
    const userResponse = await User.findById(user._id)
      .select('-password -__v')
      .populate('address', '-__v -isDeleted -deletedAt')
      .lean();
    
    res.json({ 
      success: true,
      isNewUser,
      user: {
        id: userResponse._id,
        name: userResponse.name,
        email: userResponse.email,
        phoneNumber: userResponse.phoneNumber,
        firebaseUID: userResponse.firebaseUID,
        role: userResponse.role,
        avatar: userResponse.avatar,
        profile: userResponse.profile,
        address: userResponse.address,
        createdAt: userResponse.createdAt
      }, 
      token: appToken 
    });

  } catch (err) {
    console.error("Firebase OTP verify error:", err);
    console.error("Error details:", {
      name: err.name,
      code: err.code,
      message: err.message,
      stack: err.stack
    });
    
    // ✅ Better error handling for validation errors
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: "User validation failed: " + err.message,
        error: err.errors
      });
    }
    
    // Firebase auth errors
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expired. Please request a new OTP." 
      });
    }
    
    if (err.code && err.code.startsWith('auth/')) {
      return res.status(401).json({ 
        success: false, 
        message: "Firebase authentication failed: " + err.message,
        code: err.code
      });
    }
    
    // MongoDB duplicate key error
    if (err.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: "User with this phone number or Firebase UID already exists" 
      });
    }
    
    // Generic error
    res.status(500).json({ 
      success: false, 
      message: "Token verification failed: " + (err.message || "Unknown error"),
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});


// @desc    Send OTP to email for verification (works with or without auth)
// @route   POST /api/v1/auth/send-email-otp
// @access  Public (optionalProtect — links to user if logged in)
exports.sendEmailOtp = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new ErrorResponse('Please provide an email address', 400));
  }

  const normalizedEmail = email.toLowerCase().trim();

  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return next(new ErrorResponse('Please provide a valid email address', 400));
  }

  // If authenticated, run user-specific validations
  if (req.user) {
    const user = await User.findById(req.user.id);

    if (user) {
      if (user.email && user.email === normalizedEmail) {
        return next(new ErrorResponse('This email is already linked to your account', 400));
      }

      const emailTaken = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: user._id }
      });
      if (emailTaken) {
        return next(new ErrorResponse('This email is already associated with another account', 409));
      }
    }
  }

  // Rate-limit: 1 OTP per 60 seconds per email
  const recentOtp = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'email-verification',
    createdAt: { $gte: new Date(Date.now() - 60 * 1000) }
  });
  if (recentOtp) {
    return next(new ErrorResponse('OTP already sent. Please wait 60 seconds before requesting again.', 429));
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await Otp.deleteMany({ email: normalizedEmail, purpose: 'email-verification' });

  const otpRecord = await Otp.create({
    email: normalizedEmail,
    otp,
    purpose: 'email-verification',
    expiresAt
  });

  const emailResult = await sendOtpEmail(normalizedEmail, otp, 'email-verification');

  if (!emailResult.success) {
    await Otp.deleteOne({ _id: otpRecord._id });

    if (emailResult.code === 'EAUTH') {
      return next(new ErrorResponse(
        `Email authentication failed: ${emailResult.error}`,
        500
      ));
    }

    return next(new ErrorResponse(
      `Failed to send OTP email: ${emailResult.error}`,
      500
    ));
  }

  res.status(200).json({
    success: true,
    message: 'OTP sent to your email. Please verify.',
    email: normalizedEmail,
    expiresIn: 300
  });
});

// @desc    Verify email OTP (links to user if logged in, always saves to CollectedEmail)
// @route   POST /api/v1/auth/verify-email-otp
// @access  Public (optionalProtect — links to user if logged in)
exports.verifyEmailOtp = asyncHandler(async (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return next(new ErrorResponse('Please provide email and OTP', 400));
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Resolve user only if authenticated
  let user = null;
  if (req.user) {
    user = await User.findById(req.user.id);

    if (user) {
      const emailTaken = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: user._id }
      });
      if (emailTaken) {
        return next(new ErrorResponse('This email is already associated with another account', 409));
      }
    }
  }

  const otpRecord = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'email-verification',
    isVerified: false
  });

  if (!otpRecord) {
    return next(new ErrorResponse('OTP not found or already used. Please request a new OTP.', 400));
  }

  if (!otpRecord.isValid()) {
    await Otp.deleteOne({ _id: otpRecord._id });
    return next(new ErrorResponse('OTP has expired. Please request a new one.', 400));
  }

  if (otpRecord.otp !== otp) {
    await otpRecord.incrementAttempts();

    if (otpRecord.attempts >= 5) {
      await Otp.deleteOne({ _id: otpRecord._id });
      return next(new ErrorResponse('Maximum OTP verification attempts exceeded. Please request a new OTP.', 400));
    }

    return next(new ErrorResponse(`Invalid OTP. ${5 - otpRecord.attempts} attempts remaining.`, 400));
  }

  // OTP is valid — link email to user if authenticated
  if (user) {
    user.email = normalizedEmail;
    await user.save();
  }

  // Always upsert into CollectedEmail for marketing
  await CollectedEmail.findOneAndUpdate(
    { email: normalizedEmail },
    {
      $set: {
        isVerified: true,
        source: 'email-verification',
        subscribedToMarketing: true,
        unsubscribedAt: null
      },
      $setOnInsert: {
        email: normalizedEmail,
        user: user ? user._id : null
      }
    },
    { upsert: true, new: true }
  );

  // Clean up OTP
  await Otp.deleteOne({ _id: otpRecord._id });

  // Build response based on auth state
  if (user) {
    const updatedUser = await User.findById(user._id)
      .populate('address', '-__v -isDeleted -deletedAt')
      .select('-password');

    return res.status(200).json({
      success: true,
      message: 'Email verified and linked to your account successfully.',
      data: updatedUser,
      coupon: { code: 'SAVE15', message: 'Use code SAVE15 to get 15% off on your next order!' }
    });
  }

  res.status(200).json({
    success: true,
    message: 'Email verified successfully.',
    email: normalizedEmail,
    coupon: { code: 'SAVE15', message: 'Use code SAVE15 to get 15% off on your next order!' }
  });
});

// @desc    Delete user account
// @route   DELETE /api/v1/auth/account
// @access  Private
exports.deleteAccount = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Find user to ensure they exist
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Delete user's cart
  await Cart.deleteOne({ user: userId });

  // Delete user's wishlist
  await Wishlist.deleteMany({ user: userId });

  // Delete user's pets (owned by the user)
  await Pet.deleteMany({ owner: userId });

  // Remove user from pets' coOwners arrays
  await Pet.updateMany(
    { coOwners: userId },
    { $pull: { coOwners: userId } }
  );

  // Delete user's addresses
  await Address.deleteMany({ user: userId });

  // Delete user's OTP records
  if (user.email) {
    await Otp.deleteMany({ email: user.email.toLowerCase() });
  }

  // Remove user from other users' connections and connectionRequests
  await User.updateMany(
    { $or: [{ connections: userId }, { connectionRequests: userId }] },
    { 
      $pull: { 
        connections: userId,
        connectionRequests: userId
      }
    }
  );

  // Delete the user account
  await User.findByIdAndDelete(userId);

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully'
  });
});

//helper function
exports.generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};