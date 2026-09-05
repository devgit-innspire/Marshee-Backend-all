const Partner = require('../models/partner.model');
const User = require('../models/user.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { sendPartnerPasswordSetupEmail } = require('../utils/emailService');
const shiprocketService = require('../utils/shiprocket.service');
const shiprocketIntegration = require('../utils/shiprocket.integration');

/** Resolve Partner for current user; backfill Partner.user from contact.email for legacy records. */
async function getPartnerForUser(req) {
    let partner = await Partner.findOne({ user: req.user._id });
    if (!partner && req.user.email) {
        partner = await Partner.findOne({ 'contact.email': req.user.email });
        if (partner) {
            partner.user = req.user._id;
            await partner.save();
        }
    }
    return partner;
}

class PartnerController {
    async createPartner(req, res, next) {
        try {
            const partnerData = req.body;

            // Check if partner with code already exists
            const existingPartner = await Partner.findOne({ code: partnerData.code });
            if (existingPartner) {
                throw new ErrorResponse('Partner with this code already exists', StatusCodes.CONFLICT);
            }

            // Check if CIN number already exists (if provided)
            if (partnerData.legal?.cinNumber) {
                const existingCIN = await Partner.findOne({ 
                    'legal.cinNumber': partnerData.legal.cinNumber 
                });
                if (existingCIN) {
                    throw new ErrorResponse('A partner with this CIN number already exists', StatusCodes.CONFLICT);
                }
            }

            const partner = await Partner.create(partnerData);

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Partner created successfully',
                data: partner
            });

        } catch (error) {
            next(error);
        }
    }

    async getPartners(req, res, next) {
        try {
            const partners = await Partner.find(
                { 'status.isActive': true },
                { name: 1, logo: 1, brandDescription: 1, slug: 1, status: 1 }
            ).sort({ name: 1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                data: partners
            });

        } catch (error) {
            next(error);
        }
    }

    async getPartner(req, res, next) {
        try {
            const { id } = req.params;

            const partner = await Partner.findById(id);
            if (!partner) {
                throw new ErrorResponse('Partner not found', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: partner
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Submit partner application (Seller applies)
     * @route POST /api/v1/partners/apply
     * @access Public
     */
    async submitApplication(req, res, next) {
        try {
            const applicationData = req.body;

            // Check if partner with code already exists
            const existingPartner = await Partner.findOne({ code: applicationData.code });
            if (existingPartner) {
                throw new ErrorResponse('Partner with this code already exists', StatusCodes.CONFLICT);
            }

            // Check if email already used
            const existingEmail = await Partner.findOne({ 
                'contact.email': applicationData.contact?.email 
            });
            if (existingEmail) {
                throw new ErrorResponse('A partner with this email already exists', StatusCodes.CONFLICT);
            }

            // Check if CIN number already exists (if provided)
            if (applicationData.legal?.cinNumber) {
                const existingCIN = await Partner.findOne({ 
                    'legal.cinNumber': applicationData.legal.cinNumber 
                });
                if (existingCIN) {
                    throw new ErrorResponse('A partner with this CIN number already exists', StatusCodes.CONFLICT);
                }
            }

            // Check if user already exists with this email
            const existingUser = await User.findOne({ email: applicationData.contact?.email });
            if (existingUser) {
                throw new ErrorResponse('A user with this email already exists', StatusCodes.CONFLICT);
            }

            // Create partner with pending status (this is the application)
            const partner = await Partner.create({
                ...applicationData,
                status: {
                    ...applicationData.status,
                    isActive: false, // Inactive until approved
                    verificationStatus: 'pending'
                }
            });

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Partner application submitted successfully. Our team will review it shortly.',
                data: partner
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Approve partner application (Admin only)
     * Creates User (passwordHash = null) and sends password-setup link (JWT)
     * @route PATCH /api/v1/partners/:id/approve
     * @access Private (Admin)
     */
    async approvePartner(req, res, next) {
        const mongoose = require('mongoose');
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { id } = req.params;
            const { adminNotes } = req.body;

            console.log('approving partner');

            // Find partner
            const partner = await Partner.findById(id).session(session);
            if (!partner) {
                throw new ErrorResponse('Partner not found', StatusCodes.NOT_FOUND);
            }

            if (partner.status.verificationStatus === 'verified') {
                throw new ErrorResponse('Partner is already approved', StatusCodes.BAD_REQUEST);
            }

            if (partner.status.verificationStatus === 'rejected') {
                throw new ErrorResponse('Cannot approve a rejected partner', StatusCodes.BAD_REQUEST);
            }

            // Check if user already exists
            const existingUser = await User.findOne({
                email: partner.contact.email
            }).session(session);

            if (existingUser) {
                throw new ErrorResponse(
                    'A user with this email already exists',
                    StatusCodes.CONFLICT
                );
            }

            // Update partner status to verified
            partner.status.verificationStatus = 'verified';
            partner.status.isActive = true;
            partner.status.verifiedAt = new Date();
            partner.status.verifiedBy = req.user._id;
            partner.status.verificationNotes = adminNotes || 'Approved by admin';
            await partner.save({ session });

            // Create User WITHOUT password (passwordHash = null)
            const user = await User.create([{
                name: partner.name,
                email: partner.contact.email,
                role: 'partner'
                // No password - will be set via setup link
            }], { session });

            const createdUser = user[0];

            // Link Partner to User so products/orders reference Partner _id and we resolve by user when needed
            partner.user = createdUser._id;
            await partner.save({ session });

            // Commit transaction
            await session.commitTransaction();

            // Generate JWT token for password setup (expires in 7 days)
            const setupToken = jwt.sign(
                { 
                    id: createdUser._id,
                    email: createdUser.email,
                    purpose: 'password-setup',
                    role: 'partner'
                },
                config.jwtSecret,
                { expiresIn: '7d' }
            );

            // Build password setup URL
        const baseUrl = process.env.BASE_URL || 'http://www.marshee.com';
            const setupUrl = `${baseUrl}/partner/setup-password?token=${setupToken}`;

            // Send password setup email (outside transaction)
            const emailResult = await sendPartnerPasswordSetupEmail(
                partner.contact.email,
                partner.name,
                setupToken,
                setupUrl
            );

            if (!emailResult.success) {
                console.error('Failed to send password setup email:', emailResult.error);
                // Don't fail the approval, but log the error
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Partner approved successfully. User created. Password setup email sent.',
                data: {
                    partner,
                    user: {
                        id: createdUser._id,
                        email: createdUser.email,
                        role: createdUser.role
                    },
                    emailSent: emailResult.success
                }
            });

        } catch (error) {
            await session.abortTransaction();
            next(error);
        } finally {
            session.endSession();
        }
    }

    /**
     * Reject partner application (Admin only)
     * @route PATCH /api/v1/partners/:id/reject
     * @access Private (Admin)
     */
    async rejectPartner(req, res, next) {
        try {
            const { id } = req.params;
            const { reason, adminNotes } = req.body;

            if (!reason) {
                throw new ErrorResponse('Rejection reason is required', StatusCodes.BAD_REQUEST);
            }

            const partner = await Partner.findById(id);
            if (!partner) {
                throw new ErrorResponse('Partner not found', StatusCodes.NOT_FOUND);
            }

            if (partner.status.verificationStatus === 'rejected') {
                return res.status(StatusCodes.OK).json({
                    success: true,
                    message: 'Partner is already rejected',
                    data: partner
                });
            }

            if (partner.status.verificationStatus === 'verified') {
                throw new ErrorResponse('Cannot reject an approved partner', StatusCodes.BAD_REQUEST);
            }

            // Update partner status
            partner.status.verificationStatus = 'rejected';
            partner.status.isActive = false;
            partner.status.rejectionReason = reason;
            partner.status.rejectedAt = new Date();
            partner.status.verifiedBy = req.user._id;
            partner.status.verificationNotes = adminNotes || null;
            await partner.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Partner rejected successfully',
                data: partner
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get pending partners (for admin dashboard)
     * @route GET /api/v1/partners/pending
     * @access Private (Admin)
     */
    async getPendingPartners(req, res, next) {
        try {
            const partners = await Partner.find({ 'status.verificationStatus': 'pending' })
                .sort({ createdAt: -1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                count: partners.length,
                data: partners
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get partners by verification status
     * @route GET /api/v1/partners/status/:status
     * @access Private (Admin)
     */
    async getPartnersByStatus(req, res, next) {
        try {
            const { status } = req.params;
            
            const validStatuses = ['pending', 'verified', 'rejected'];
            if (!validStatuses.includes(status)) {
                throw new ErrorResponse(
                    `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
                    StatusCodes.BAD_REQUEST
                );
            }

            const partners = await Partner.find({ 'status.verificationStatus': status })
                .sort({ createdAt: -1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                count: partners.length,
                data: partners
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get partner statistics
     * @route GET /api/v1/partners/stats
     * @access Private (Admin)
     */
    async getPartnerStats(req, res, next) {
        try {
            const [total, pending, verified, rejected, active] = await Promise.all([
                Partner.countDocuments(),
                Partner.countDocuments({ 'status.verificationStatus': 'pending' }),
                Partner.countDocuments({ 'status.verificationStatus': 'verified' }),
                Partner.countDocuments({ 'status.verificationStatus': 'rejected' }),
                Partner.countDocuments({ 'status.isActive': true })
            ]);

            return res.status(StatusCodes.OK).json({
                success: true,
                data: {
                    total,
                    pending,
                    verified,
                    rejected,
                    active,
                    inactive: total - active
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Partner: Add Shiprocket pickup location and save in DB
     * @route POST /api/v1/partners/me/pickup-locations
     * @access Private (Partner)
     */
    async addMyPickupLocation(req, res, next) {
        try {
            if (!req.user?.email) {
                throw new ErrorResponse('Not authorized', StatusCodes.UNAUTHORIZED);
            }

            const partner = await getPartnerForUser(req);
            if (!partner) {
                throw new ErrorResponse('Partner not found for this user', StatusCodes.NOT_FOUND);
            }

            const {
                pickup_location,
                name,
                email,
                phone,
                address,
                address_2,
                city,
                state,
                country,
                pin_code
            } = req.body;

            // Validate required fields
            if (!pickup_location || pickup_location === '') {
                throw new ErrorResponse('pickup_location is required', StatusCodes.BAD_REQUEST);
            }
            if (!name || name === '') {
                throw new ErrorResponse('name is required', StatusCodes.BAD_REQUEST);
            }
            if (!email || email === '') {
                throw new ErrorResponse('email is required', StatusCodes.BAD_REQUEST);
            }
            if (!phone && phone !== 0) {
                throw new ErrorResponse('phone is required', StatusCodes.BAD_REQUEST);
            }
            if (!address || address === '') {
                throw new ErrorResponse('address is required', StatusCodes.BAD_REQUEST);
            }
            if (!city || city === '') {
                throw new ErrorResponse('city is required', StatusCodes.BAD_REQUEST);
            }
            if (!state || state === '') {
                throw new ErrorResponse('state is required', StatusCodes.BAD_REQUEST);
            }
            if (!country || country === '') {
                throw new ErrorResponse('country is required', StatusCodes.BAD_REQUEST);
            }
            if (!pin_code && pin_code !== 0) {
                throw new ErrorResponse('pin_code is required', StatusCodes.BAD_REQUEST);
            }

            // Unique pickup_location per account: PARTNERCODE_LOCATION (e.g. HAPPYYADAV_Jammu, SELLER_A_DELHI)
            const locationSlug = String(pickup_location).trim().replace(/\s+/g, '_');
            const normalizedPickupLocation = `${partner.code}_${locationSlug}`;

            const pickupData = {
                pickup_location: normalizedPickupLocation,
                name: String(name).trim(),
                email: String(email).trim(),
                phone: String(phone).trim(),
                address: String(address).trim(),
                address_2: address_2 === undefined || address_2 === null ? '' : String(address_2),
                city: String(city).trim(),
                state: String(state).trim(),
                country: String(country).trim(),
                pin_code: String(pin_code).trim()
            };

            // Avoid duplicate within this partner
            const existingSamePartner = partner.shiprocket?.pickupLocations?.find(
                (p) => p.pickup_location?.toLowerCase() === pickupData.pickup_location.toLowerCase()
            );
            if (existingSamePartner) {
                throw new ErrorResponse('Pickup location with this name already exists for your account', StatusCodes.CONFLICT);
            }

            // Ensure globally unique (one Shiprocket account = all partners share pickup names)
            const existingOther = await Partner.findOne({
                _id: { $ne: partner._id },
                'shiprocket.pickupLocations.pickup_location': { $eq: normalizedPickupLocation }
            });
            if (existingOther) {
                throw new ErrorResponse('This pickup location name is already in use. Try a different location name.', StatusCodes.CONFLICT);
            }

            // Use server Shiprocket creds (do NOT use app JWT header)
            const shiprocketToken = await shiprocketIntegration.getToken();
            const shiprocketRes = await shiprocketService.addPickupLocation(shiprocketToken, pickupData);

            partner.shiprocket = partner.shiprocket || {};
            partner.shiprocket.pickupLocations = partner.shiprocket.pickupLocations || [];
            partner.shiprocket.pickupLocations.push({
                ...pickupData,
                shiprocketResponse: shiprocketRes
            });

            await partner.save();

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Pickup location added successfully',
                data: {
                    pickupLocation: pickupData,
                    shiprocket: shiprocketRes
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Partner: Get saved pickup locations from DB
     * @route GET /api/v1/partners/me/pickup-locations
     * @access Private (Partner)
     */
    async getMyPickupLocations(req, res, next) {
        try {
            if (!req.user?.email) {
                throw new ErrorResponse('Not authorized', StatusCodes.UNAUTHORIZED);
            }

            const partner = await getPartnerForUser(req);
            if (!partner) {
                throw new ErrorResponse('Partner not found for this user', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: partner.shiprocket?.pickupLocations || []
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PartnerController();
