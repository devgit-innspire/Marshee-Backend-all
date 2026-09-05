const Coupon = require('../models/coupon.model');
const User = require('../models/user.model');
const Pet = require('../models/pet.model');
const admin = require('../config/firebaseAdmin');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const CollectedContact = require('../models/collectedContact.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const { queueViewContentCapiEvent, queuePageViewCapiEvent } = require('../utils/metaCapi');

class CouponController {

    async landingPagePhoneLogin(req, res, next) {
        try {
            console.log("Landing page phone login called");

            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                console.log("Missing or invalid authorization header");
                return res.status(401).json({
                    success: false,
                    message: "Authorization header missing or invalid format"
                });
            }

            const idToken = authHeader.split("Bearer ")[1];
            if (!idToken) {
                console.log("ID token missing from header");
                return res.status(401).json({
                    success: false,
                    message: "ID token missing from authorization header"
                });
            }

            if (!admin.apps.length) {
                console.error("Firebase Admin not initialized");
                return res.status(500).json({
                    success: false,
                    message: "Firebase Admin not configured. Please check server configuration."
                });
            }

            const decoded = await admin.auth().verifyIdToken(idToken);

            const phone = decoded.phone_number;
            if (!phone) {
                return res.status(400).json({
                    success: false,
                    message: "Phone number not found in token"
                });
            }

            const firebaseEmail = decoded.email || null;
            const firebaseName = decoded.name || null;
            const firebasePicture = decoded.picture || decoded.photoURL || null;

            const { name, email, avatar, bio } = req.body || {};

            let user = await User.findOne({ firebaseUID: decoded.uid });

            if (!user) {
                user = await User.findOne({ phoneNumber: phone });
            }

            const isNewUser = !user;

            if (!user) {
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

                if (userEmail) {
                    userData.email = userEmail;
                }
                if (userAvatar) {
                    userData.avatar = userAvatar;
                }

                user = await User.create(userData);
                console.log("New user created:", { id: user._id, name: user.name, phone: user.phoneNumber });
            } else {
                let needsUpdate = false;

                if (!user.firebaseUID || user.firebaseUID !== decoded.uid) {
                    if (user.firebaseUID && user.firebaseUID !== decoded.uid) {
                        console.warn(`Firebase UID mismatch for phone ${phone}: updating from ${user.firebaseUID} to ${decoded.uid}`);
                    }
                    user.firebaseUID = decoded.uid;
                    needsUpdate = true;
                }

                if (name && name !== user.name) {
                    user.name = name;
                    needsUpdate = true;
                } else if (!user.name && firebaseName) {
                    user.name = firebaseName;
                    needsUpdate = true;
                }

                if (email && email !== user.email) {
                    const emailExists = await User.findOne({ email: email, _id: { $ne: user._id } });
                    if (!emailExists) {
                        user.email = email;
                        needsUpdate = true;
                    }
                } else if (!user.email && firebaseEmail) {
                    const emailExists = await User.findOne({ email: firebaseEmail, _id: { $ne: user._id } });
                    if (!emailExists) {
                        user.email = firebaseEmail;
                        needsUpdate = true;
                    }
                }

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

                if (bio !== undefined && bio !== user.profile?.bio) {
                    if (!user.profile) user.profile = {};
                    user.profile.bio = bio;
                    needsUpdate = true;
                }

                if (!user.profile) user.profile = {};
                user.profile.lastLogin = new Date();
                needsUpdate = true;

                if (needsUpdate) {
                    await user.save();
                    console.log("Existing user updated:", { id: user._id, name: user.name, email: user.email });
                }
            }

            const appToken = jwt.sign(
                {
                    id: user._id,
                    phoneNumber: user.phoneNumber,
                    firebaseUID: decoded.uid
                },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            // Save phone number for marketing
            await CollectedContact.findOneAndUpdate(
                { phoneNumber: phone },
                {
                    $set: {
                        isVerified: true,
                        source: 'airtag-landing-page',
                        subscribedToMarketing: true,
                        unsubscribedAt: null
                    },
                    $setOnInsert: {
                        phoneNumber: phone,
                        email: user.email || null,
                        user: user._id
                    }
                },
                { upsert: true, new: true }
            );

            // Check if this user has ever had a landing page coupon (active, expired, or used)
            const existingCoupon = await Coupon.findOne({
                'userRestrictions.specificUsers': user._id,
                code: { $regex: /^SAVE15-/ }
            });

            const userResponse = await User.findById(user._id)
                .select('-password -__v')
                .populate('address', '-__v -isDeleted -deletedAt')
                .lean();

            const petsCount = await Pet.countDocuments({ owner: user._id });

            if (existingCoupon) {
                const now = new Date();
                const isStillValid = existingCoupon.isActive &&
                    now >= existingCoupon.validFrom &&
                    now <= existingCoupon.validUntil &&
                    existingCoupon.usedCount < (existingCoupon.maxUsage || Infinity);

                return res.json({
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
                        petsCount,
                        hasPet: petsCount > 0,
                        createdAt: userResponse.createdAt
                    },
                    token: appToken,
                    coupon: null,
                    couponMessage: isStillValid
                        ? `You already have an active coupon: ${existingCoupon.code}. Use it before it expires!`
                        : 'Your 15% discount coupon has expired.'
                });
            }

            // Generate unique 15-minute coupon for this user (first time only)
            const now = new Date();
            const validUntil = new Date(now.getTime() + 15 * 60 * 1000);
            const uniqueSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
            const couponCode = `SAVE15-${uniqueSuffix}`;

            const coupon = await Coupon.create({
                code: couponCode,
                name: '15% OFF',
                description: 'Get 15% off your order - exclusive landing page offer (valid for 15 minutes)',
                discountType: 'percentage',
                discountValue: 15,
                validFrom: now,
                validUntil: validUntil,
                minimumOrderAmount: 2000,
                maximumDiscountAmount: 2000,
                maxUsage: 1,
                maxUsagePerUser: 1,
                isActive: true,
                isPublic: false,
                createdBy: user._id,
                autoExpire: true,
                userRestrictions: {
                    newUsersOnly: false,
                    existingUsersOnly: false,
                    specificUsers: [user._id]
                }
            });

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
                    petsCount,
                    hasPet: petsCount > 0,
                    createdAt: userResponse.createdAt
                },
                token: appToken,
                coupon: {
                    id: coupon._id,
                    code: coupon.code,
                    name: coupon.name,
                    description: coupon.description,
                    discountType: coupon.discountType,
                    discountValue: coupon.discountValue,
                    minimumOrderAmount: coupon.minimumOrderAmount,
                    maximumDiscountAmount: coupon.maximumDiscountAmount,
                    validFrom: coupon.validFrom,
                    validUntil: coupon.validUntil,
                    message: `Use code ${coupon.code} to get 15% off! Valid for 15 minutes only.`
                }
            });

        } catch (err) {
            console.error("Landing page phone login error:", err);
            console.error("Error details:", {
                name: err.name,
                code: err.code,
                message: err.message,
                stack: err.stack
            });

            if (err.name === 'ValidationError') {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed: " + err.message,
                    error: err.errors
                });
            }

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

            if (err.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: "User with this phone number or Firebase UID already exists"
                });
            }

            res.status(500).json({
                success: false,
                message: "Landing page login failed: " + (err.message || "Unknown error"),
                error: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
    }

    async getMyLandingPageCoupon(req, res, next) {
        try {
            const userId = req.user?.id;
            // Server-side CAPI ViewContent for the landing page view.
            // Triggered whenever the landing page loads and requests its coupon.
            queueViewContentCapiEvent({
                req,
                user: req.user || null,
                contentId: 'landing_page',
                contentName: 'Landing Page'
            });
            queuePageViewCapiEvent({
                req,
                user: req.user || null
            });

            const now = new Date();
            let coupon = null;
            if (userId) {
                coupon = await Coupon.findOne({
                    'userRestrictions.specificUsers': userId,
                    isActive: true,
                    isPublic: false,
                    validFrom: { $lte: now },
                    validUntil: { $gte: now },
                    code: { $regex: /^SAVE15-/ }
                }).sort({ createdAt: -1 });
            }

            if (!coupon) {
                // Landing page should not treat "no coupon" as an error.
                // Return 200 so client code (e.g. axios) doesn't go into its error path.
                return res.status(200).json({
                    success: true,
                    data: null,
                    message: "No active landing page coupon found"
                });
            }

            const remainingMs = coupon.validUntil.getTime() - now.getTime();
            const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

            return res.status(200).json({
                success: true,
                data: {
                    id: coupon._id,
                    code: coupon.code,
                    name: coupon.name,
                    description: coupon.description,
                    discountType: coupon.discountType,
                    discountValue: coupon.discountValue,
                    minimumOrderAmount: coupon.minimumOrderAmount,
                    maximumDiscountAmount: coupon.maximumDiscountAmount,
                    validFrom: coupon.validFrom,
                    validUntil: coupon.validUntil,
                    remainingSeconds,
                    message: `Use code ${coupon.code} to get 15% off! Expires in ${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s.`
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async createCoupon(req, res, next) {
        try {
            const couponData = req.body;

            console.log("couponData:-", couponData);
            
            
            // Check if coupon with code already exists
            const existingCoupon = await Coupon.findOne({ code: couponData.code.toUpperCase() });
            if (existingCoupon) {
                throw new ErrorResponse('Coupon with this code already exists', StatusCodes.CONFLICT);
            }

            // Ensure code is uppercase
            couponData.code = couponData.code.toUpperCase();

            // Parse and validate dates
            if (couponData.validFrom) {
                const validFromDate = new Date(couponData.validFrom);
                if (isNaN(validFromDate.getTime())) {
                    throw new ErrorResponse('Invalid validFrom date format', StatusCodes.BAD_REQUEST);
                }
                couponData.validFrom = validFromDate;
            }

            if (couponData.validUntil) {
                const validUntilDate = new Date(couponData.validUntil);
                if (isNaN(validUntilDate.getTime())) {
                    throw new ErrorResponse('Invalid validUntil date format', StatusCodes.BAD_REQUEST);
                }
                couponData.validUntil = validUntilDate;
            }

            // Validate that validUntil is after validFrom
            if (couponData.validFrom && couponData.validUntil) {
                if (couponData.validUntil <= couponData.validFrom) {
                    throw new ErrorResponse('validUntil must be after validFrom', StatusCodes.BAD_REQUEST);
                }
            }

            // Set createdBy from authenticated user if not provided
            if (!couponData.createdBy && req.user && req.user.id) {
                couponData.createdBy = req.user.id;
            }

            // Validate that createdBy is provided
            if (!couponData.createdBy) {
                throw new ErrorResponse('createdBy is required', StatusCodes.BAD_REQUEST);
            }

            const coupon = await Coupon.create(couponData);

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Coupon created successfully',
                data: coupon
            });

        } catch (error) {
            next(error);
        }
    }

    async getAllCoupons(req, res, next) {
        try {
            const { 
                page = 1, 
                limit = 10, 
                status,
                discountType,
                isPublic 
            } = req.query;

            const query = {};

            if (status) query.isActive = status === 'active';
            if (discountType) query.discountType = discountType;
            if (isPublic !== undefined) query.isPublic = isPublic === 'true';

            const skip = (page - 1) * limit;

            const coupons = await Coupon.find(query)
                .populate('createdBy', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit));

            const total = await Coupon.countDocuments(query);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: coupons,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getCouponById(req, res, next) {
        try {
            const { id } = req.params;

            const coupon = await Coupon.findById(id)
                .populate('createdBy', 'name email')
                .populate('applicableCategories', 'name slug')
                .populate('applicableProducts', 'name sku')
                .populate('applicableBrands', 'name slug');

            if (!coupon) {
                throw new ErrorResponse('Coupon not found', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: coupon
            });

        } catch (error) {
            next(error);
        }
    }

    async updateCoupon(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            if (updateData.code) {
                updateData.code = updateData.code.toUpperCase();
                
                // Check if new code already exists
                const existingCoupon = await Coupon.findOne({ 
                    code: updateData.code, 
                    _id: { $ne: id } 
                });
                if (existingCoupon) {
                    throw new ErrorResponse('Coupon with this code already exists', StatusCodes.CONFLICT);
                }
            }

            // Parse and validate dates if provided
            if (updateData.validFrom) {
                const validFromDate = new Date(updateData.validFrom);
                if (isNaN(validFromDate.getTime())) {
                    throw new ErrorResponse('Invalid validFrom date format', StatusCodes.BAD_REQUEST);
                }
                updateData.validFrom = validFromDate;
            }

            if (updateData.validUntil) {
                const validUntilDate = new Date(updateData.validUntil);
                if (isNaN(validUntilDate.getTime())) {
                    throw new ErrorResponse('Invalid validUntil date format', StatusCodes.BAD_REQUEST);
                }
                updateData.validUntil = validUntilDate;
            }

            // Validate that validUntil is after validFrom if both are provided
            if (updateData.validFrom && updateData.validUntil) {
                if (updateData.validUntil <= updateData.validFrom) {
                    throw new ErrorResponse('validUntil must be after validFrom', StatusCodes.BAD_REQUEST);
                }
            }

            const coupon = await Coupon.findByIdAndUpdate(
                id,
                updateData,
                { new: true, runValidators: true }
            );

            if (!coupon) {
                throw new ErrorResponse('Coupon not found', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Coupon updated successfully',
                data: coupon
            });

        } catch (error) {
            next(error);
        }
    }

    async deleteCoupon(req, res, next) {
        try {
            const { id } = req.params;

            const coupon = await Coupon.findByIdAndDelete(id);

            if (!coupon) {
                throw new ErrorResponse('Coupon not found', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Coupon deleted successfully'
            });

        } catch (error) {
            next(error);
        }
    }

    async validateCoupon(req, res, next) {
        try {
            const { code, orderAmount, userId } = req.body;
            const activeUserId = req.user ? req.user.id : userId;

            if (!code || !orderAmount) {
                throw new ErrorResponse('Coupon code and order amount are required', StatusCodes.BAD_REQUEST);
            }

            const coupon = await Coupon.findOne({ 
                code: code.toUpperCase(),
                isActive: true
            });

            if (!coupon) {
                throw new ErrorResponse('Invalid coupon code', StatusCodes.NOT_FOUND);
            }

            // Check if coupon is valid
            if (!coupon.isValid) {
                throw new ErrorResponse('Coupon is expired or inactive', StatusCodes.BAD_REQUEST);
            }

            // Check if coupon has reached max usage limit
            if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
                throw new ErrorResponse('Coupon has reached maximum usage limit', StatusCodes.BAD_REQUEST);
            }

            // Check if user can use coupon
            if (!coupon.canUserUse(activeUserId, orderAmount)) {
                throw new ErrorResponse('Coupon cannot be applied to this order', StatusCodes.BAD_REQUEST);
            }

            // Calculate discount
            const discountAmount = coupon.calculateDiscount(orderAmount);

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Coupon is valid',
                data: {
                    coupon: {
                        id: coupon._id,
                        code: coupon.code,
                        name: coupon.name,
                        discountType: coupon.discountType,
                        discountValue: coupon.discountValue
                    },
                    discountAmount,
                    finalAmount: orderAmount - discountAmount
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getPublicCoupons(req, res, next) {
        try {
            const coupons = await Coupon.find({ 
                isActive: true, 
                isPublic: true,
                validFrom: { $lte: new Date() },
                validUntil: { $gte: new Date() }
            }).select('code name description discountType discountValue minimumOrderAmount');

            return res.status(StatusCodes.OK).json({
                success: true,
                data: coupons
            });

        } catch (error) {
            next(error);
        }
    }

    async getCouponStats(req, res, next) {
        try {
            const { id } = req.params;

            const coupon = await Coupon.findById(id).select('code name usedCount maxUsage totalDiscountGiven totalOrders');

            if (!coupon) {
                throw new ErrorResponse('Coupon not found', StatusCodes.NOT_FOUND);
            }

            const usagePercentage = coupon.maxUsage 
                ? ((coupon.usedCount / coupon.maxUsage) * 100).toFixed(2)
                : null;

            return res.status(StatusCodes.OK).json({
                success: true,
                data: {
                    coupon: {
                        id: coupon._id,
                        code: coupon.code,
                        name: coupon.name
                    },
                    usage: {
                        usedCount: coupon.usedCount,
                        maxUsage: coupon.maxUsage,
                        remainingUsage: coupon.maxUsage ? coupon.maxUsage - coupon.usedCount : null,
                        usagePercentage: usagePercentage ? `${usagePercentage}%` : null
                    },
                    analytics: {
                        totalDiscountGiven: coupon.totalDiscountGiven,
                        totalOrders: coupon.totalOrders,
                        averageDiscountPerOrder: coupon.totalOrders > 0 
                            ? (coupon.totalDiscountGiven / coupon.totalOrders).toFixed(2)
                            : 0
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CouponController();
