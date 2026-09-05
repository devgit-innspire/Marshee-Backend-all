const express = require('express');
const {
  register,
  registerAdmin,
  login,
  getMe,
  firebaseAuth,
  updateProfile,
  sendOtp,
  verifyOtp,
  firebaseOtpVerify,
  sendEmailOtp,
  verifyEmailOtp,
  verifyRegistrationOtp,
  deleteAccount,
  setupPartnerPassword
} = require('../controllers/auth.controller');

const router = express.Router();

const { protect, authorize, optionalProtect } = require('../middleware/auth');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');

// 10 attempts per 15 min per IP — credential and verification endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

// 5 OTP sends per 10 min per IP — tighter since each send costs an email/SMS
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    message: { success: false, message: 'Too many OTP requests. Please try again in 10 minutes.' },
});

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register user (step 1 – send OTP)
 *     description: Validates input and sends OTP. Complete registration with POST /verify-registration-otp.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: OTP sent successfully }
 *       400: { description: Validation error or user exists }
 */
router.post('/register', authLimiter, register);

/**
 * @swagger
 * /api/v1/auth/admin-9969/register:
 *   post:
 *     summary: Create admin user (Admin only)
 *     tags: [Auth, Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       201: { description: Admin created }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - Admin only }
 */
router.post('/admin-9969/register', protect, authorize('admin'), registerAdmin);

/**
 * @swagger
 * /api/v1/auth/verify-registration-otp:
 *   post:
 *     summary: Verify OTP and complete registration (step 2)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string }
 *     responses:
 *       201: { description: Registration completed; returns user and token }
 *       400: { description: Invalid or expired OTP }
 */
router.post('/verify-registration-otp', authLimiter, verifyRegistrationOtp);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login (email + password)
 *     description: Returns JWT token for use in Authorization header.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: Success; returns user and token }
 *       401: { description: Invalid credentials }
 */
router.post('/login', authLimiter, login);

/**
 * @swagger
 * /api/v1/auth/token:
 *   post:
 *     summary: Exchange Firebase token for JWT
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: JWT returned }
 *       401: { description: Invalid Firebase token }
 */
router.post('/token', authLimiter, firebaseAuth);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Current user object }
 *       401: { description: Unauthorized }
 */
router.get('/me', protect, getMe);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     summary: Update current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *     responses:
 *       200: { description: Profile updated }
 *       401: { description: Unauthorized }
 */
router.put('/profile', protect, updateProfile);

/**
 * @swagger
 * /api/v1/auth/firebase-otp-verify:
 *   post:
 *     summary: Verify Firebase OTP (web)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verificationId: { type: string }
 *               otp: { type: string }
 *     responses:
 *       200: { description: OTP verified }
 *       400: { description: Invalid OTP }
 */
router.post('/firebase-otp-verify', authLimiter, firebaseOtpVerify);

/**
 * @swagger
 * /api/v1/auth/send-email-otp:
 *   post:
 *     summary: Send OTP to email for verification (auth optional)
 *     description: Works without login. If JWT provided, also validates against user account.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: OTP sent to email }
 *       400: { description: Validation error }
 *       409: { description: Email already taken }
 *       429: { description: Rate limited - wait 60s }
 */
router.post('/send-email-otp', otpLimiter, optionalProtect, sendEmailOtp);

/**
 * @swagger
 * /api/v1/auth/verify-email-otp:
 *   post:
 *     summary: Verify email OTP and collect email (auth optional)
 *     description: Always saves email to marketing list. If JWT provided, also links email to user account.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string }
 *     responses:
 *       200: { description: Email verified and linked }
 *       400: { description: Invalid or expired OTP }
 *       409: { description: Email already taken by another user }
 */
router.post('/verify-email-otp', authLimiter, optionalProtect, verifyEmailOtp);

/**
 * @swagger
 * /api/v1/auth/account:
 *   delete:
 *     summary: Delete current user account
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Account deleted }
 *       401: { description: Unauthorized }
 */
router.delete('/account', protect, deleteAccount);

/**
 * @swagger
 * /api/v1/auth/setup-password:
 *   post:
 *     summary: Partner password setup (token from email link)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: Password set successfully }
 *       400: { description: Invalid or expired token }
 */
router.post('/setup-password', setupPartnerPassword);

/**
 * @swagger
 * /api/v1/auth/partner/setup-password:
 *   post:
 *     summary: Partner password setup (alias)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: Password set successfully }
 *       400: { description: Invalid or expired token }
 */
router.post('/partner/setup-password', setupPartnerPassword);

module.exports = router;
