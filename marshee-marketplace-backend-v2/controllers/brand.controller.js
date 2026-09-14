const Brand = require('../models/brand.model');
const Partner = require('../models/partner.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const { isStaff } = require('../utils/roles');

class BrandController {
    async createBrand(req, res, next) {
        try {
            const { name, slug, description, logo, bannerImage, socialMedia, seo } = req.body;
            let partnerId = null;

            // If user is a partner, auto-assign the brand to them
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                if (partner.status.verificationStatus !== 'verified') {
                    throw new ErrorResponse('Partner account not verified', StatusCodes.FORBIDDEN);
                }
                partnerId = partner._id;
            }
            // Admin can optionally specify a partner
            else if (isStaff(req.user) && req.body.partner) {
                partnerId = req.body.partner;
            }

            // Check if brand with slug already exists
            if (slug) {
                const existingBrand = await Brand.findOne({ slug });
                if (existingBrand) {
                    throw new ErrorResponse('Brand with this slug already exists', StatusCodes.CONFLICT);
                }
            }

            // Check if brand name already exists
            const existingBrandName = await Brand.findOne({ name });
            if (existingBrandName) {
                throw new ErrorResponse('Brand with this name already exists', StatusCodes.CONFLICT);
            }

            const brand = await Brand.create({
                name,
                slug,
                description,
                logo,
                bannerImage,
                socialMedia,
                seo,
                partner: partnerId
            });

            // Populate partner info if exists
            await brand.populate('partner', 'name code contact.email');

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Brand created successfully',
                data: brand
            });

        } catch (error) {
            next(error);
        }
    }

    async getBrands(req, res, next) {
        try {
            let query = { 'status.isActive': true };

            // If user is a partner, only show their brands
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                query.partner = partner._id;
            }

            const brands = await Brand.find(query)
                .populate('partner', 'name code contact.email')
                .sort({ name: 1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                count: brands.length,
                data: brands
            });

        } catch (error) {
            next(error);
        }
    }

    async getBrand(req, res, next) {
        try {
            const { id } = req.params;

            const brand = await Brand.findById(id).populate('partner', 'name code contact.email');
            if (!brand) {
                throw new ErrorResponse('Brand not found', StatusCodes.NOT_FOUND);
            }

            // If user is a partner, verify they own this brand
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                if (brand.partner && brand.partner._id.toString() !== partner._id.toString()) {
                    throw new ErrorResponse('You do not have permission to access this brand', StatusCodes.FORBIDDEN);
                }
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: brand
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Update brand (Partner can update their own brands, Admin can update any)
     * @route PUT /api/v1/brands/:id
     * @access Private (Partner/Admin)
     */
    async updateBrand(req, res, next) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const brand = await Brand.findById(id);
            if (!brand) {
                throw new ErrorResponse('Brand not found', StatusCodes.NOT_FOUND);
            }

            // If user is a partner, verify they own this brand
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                if (!brand.partner || brand.partner.toString() !== partner._id.toString()) {
                    throw new ErrorResponse('You do not have permission to update this brand', StatusCodes.FORBIDDEN);
                }
            }

            // Prevent changing partner ownership (only admin can do this)
            if (req.user && req.user.role === 'partner' && updateData.partner) {
                delete updateData.partner;
            }

            // Update brand
            Object.assign(brand, updateData);
            brand.updatedAt = new Date();
            await brand.save();

            await brand.populate('partner', 'name code contact.email');

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Brand updated successfully',
                data: brand
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete brand (Partner can delete their own brands, Admin can delete any)
     * @route DELETE /api/v1/brands/:id
     * @access Private (Partner/Admin)
     */
    async deleteBrand(req, res, next) {
        try {
            const { id } = req.params;

            const brand = await Brand.findById(id);
            if (!brand) {
                throw new ErrorResponse('Brand not found', StatusCodes.NOT_FOUND);
            }

            // If user is a partner, verify they own this brand
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                if (!brand.partner || brand.partner.toString() !== partner._id.toString()) {
                    throw new ErrorResponse('You do not have permission to delete this brand', StatusCodes.FORBIDDEN);
                }
            }

            await Brand.findByIdAndDelete(id);

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Brand deleted successfully'
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Dashboard: Get brands (Partner sees own brands, Admin sees all)
     * @route GET /api/v1/brands/dashboard
     * @access Private (Partner/Admin)
     */
    async getMyBrands(req, res, next) {
        try {
            let query = {};

            // Partner filter: If user is partner, only show their brands
            if (req.user && req.user.role === 'partner') {
                const partner = await Partner.findOne({ 'contact.email': req.user.email });
                if (!partner) {
                    throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
                }
                query.partner = partner._id;
            }
            // Admin sees all brands (no partner filter)

            const brands = await Brand.find(query)
                .populate('partner', 'name code contact.email')
                .sort({ createdAt: -1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                count: brands.length,
                data: brands
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new BrandController();
