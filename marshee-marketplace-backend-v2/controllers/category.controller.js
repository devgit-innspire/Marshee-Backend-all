const { SuperCategory, ServiceCategory, SubCategory } = require('../models/category.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');

// In-memory cache for Category Hierarchy
let cachedHierarchy = null;
let lastCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute in milliseconds

const invalidateCategoryCache = () => {
  cachedHierarchy = null;
  lastCacheTime = 0;
};

class CategoryController {
    async createSuperCategory(req, res, next) {
        try {
            const { name, slug, description, displayOrder, status } = req.body;

            // Check if super category with slug already exists
            const existingCategory = await SuperCategory.findOne({ slug });
            if (existingCategory) {
                throw new ErrorResponse('Super category with this slug already exists', StatusCodes.CONFLICT);
            }

            const superCategory = await SuperCategory.create({
                name,
                slug,
                description,
                displayOrder,
                status
            });

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Super category created successfully',
                data: superCategory
            });

        } catch (error) {
            next(error);
        }
    }

    async createServiceCategory(req, res, next) {
        try {
            const { name, slug, superCategory, description, displayOrder, status, icon } = req.body;

            // Check if service category with slug already exists
            const existingCategory = await ServiceCategory.findOne({ slug });
            if (existingCategory) {
                throw new ErrorResponse('Service category with this slug already exists', StatusCodes.CONFLICT);
            }

            // Verify all super categories exist
            if (Array.isArray(superCategory)) {
                for (const superCatId of superCategory) {
                    const superCategoryExists = await SuperCategory.findById(superCatId);
                    if (!superCategoryExists) {
                        throw new ErrorResponse(`Super category with ID ${superCatId} not found`, StatusCodes.NOT_FOUND);
                    }
                }
            } else {
                // Handle single superCategory for backward compatibility
                const superCategoryExists = await SuperCategory.findById(superCategory);
                if (!superCategoryExists) {
                    throw new ErrorResponse('Super category not found', StatusCodes.NOT_FOUND);
                }
            }

            const serviceCategory = await ServiceCategory.create({
                name,
                slug,
                superCategory: Array.isArray(superCategory) ? superCategory : [superCategory],
                description,
                displayOrder,
                status,
                icon
            });

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Service category created successfully',
                data: serviceCategory
            });

        } catch (error) {
            next(error);
        }
    }

    async createSubCategory(req, res, next) {
        try {
            const { name, slug, serviceCategory, icon, description, displayOrder, status } = req.body;

            // Check if sub category with slug already exists
            const existingCategory = await SubCategory.findOne({ slug });
            if (existingCategory) {
                throw new ErrorResponse('Sub category with this slug already exists', StatusCodes.CONFLICT);
            }

            // Verify service category exists
            const serviceCategoryExists = await ServiceCategory.findById(serviceCategory);
            if (!serviceCategoryExists) {
                throw new ErrorResponse('Service category not found', StatusCodes.NOT_FOUND);
            }

            const subCategory = await SubCategory.create({
                name,
                slug,
                serviceCategory,
                icon,
                description,
                displayOrder,
                status
            });

            return res.status(StatusCodes.CREATED).json({
                success: true,
                message: 'Sub category created successfully',
                data: subCategory
            });

        } catch (error) {
            next(error);
        }
    }

    async getSuperCategories(req, res, next) {
        try {
            const superCategories = await SuperCategory.find({ isActive: true }).sort({ displayOrder: 1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                data: superCategories
            });

        } catch (error) {
            next(error);
        }
    }

    async getServiceCategories(req, res, next) {
        try {
            const serviceCategories = await ServiceCategory.find({ isActive: true })
                .populate('superCategory', 'name slug')
                .sort({ displayOrder: 1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                data: serviceCategories
            });

        } catch (error) {
            next(error);
        }
    }

    async getSubCategories(req, res, next) {
        try {
            const subCategories = await SubCategory.find({ isActive: true })
                .populate('serviceCategory', 'name slug')
                .sort({ displayOrder: 1 });

            return res.status(StatusCodes.OK).json({
                success: true,
                data: subCategories
            });

        } catch (error) {
            next(error);
        }
    }

    async getCategoryHierarchy(req, res, next) {
      try {
        const now = Date.now();
        if (cachedHierarchy && (now - lastCacheTime < CACHE_TTL)) {
          return res.status(StatusCodes.OK).json({
            success: true,
            data: cachedHierarchy,
          });
        }

        /**
         * IMPORTANT:
         * Your DB has mixed "active" fields across old/new data:
         * - some docs use `isActive: true`
         * - some docs use `status.isActive: true`
         * - some old docs might have neither
         *
         * So we match all of those as "active" to build the hierarchy correctly.
         */
        const activeMatch = {
          $or: [
            { isActive: true },
            { 'status.isActive': true },
            { isActive: { $exists: false }, 'status.isActive': { $exists: false } },
          ],
        };

        const serviceCollection = ServiceCategory.collection.name;
        const subCollection = SubCategory.collection.name;

        const hierarchy = await SuperCategory.aggregate([
          { $match: activeMatch },
          { $sort: { displayOrder: 1, createdAt: 1 } },
          {
            $lookup: {
              from: serviceCollection,
              let: { superId: '$_id' },
              pipeline: [
                { $match: { $expr: { $in: ['$$superId', '$superCategory'] } } },
                { $match: activeMatch },
                { $sort: { displayOrder: 1, createdAt: 1 } },
                {
                  $lookup: {
                    from: subCollection,
                    let: { serviceId: '$_id' },
                    pipeline: [
                      { $match: { $expr: { $eq: ['$serviceCategory', '$$serviceId'] } } },
                      { $match: activeMatch },
                      { $sort: { displayOrder: 1, createdAt: 1 } },
                    ],
                    as: 'subs',
                  },
                },
              ],
              as: 'services',
            },
          },
        ]);

        // Save cache
        cachedHierarchy = hierarchy;
        lastCacheTime = now;

        return res.status(StatusCodes.OK).json({
          success: true,
          data: hierarchy,
        });
      } catch (error) {
        next(error);
      }
    }

    // ========== ADMIN-ONLY: UPDATE / DELETE ==========

    async updateSuperCategory(req, res, next) {
        try {
            const { id } = req.params;
            const { name, slug, description, displayOrder, status } = req.body;

            const superCategory = await SuperCategory.findById(id);
            if (!superCategory) {
                throw new ErrorResponse('Super category not found', StatusCodes.NOT_FOUND);
            }

            if (slug && slug !== superCategory.slug) {
                const existing = await SuperCategory.findOne({ slug });
                if (existing) {
                    throw new ErrorResponse('Super category with this slug already exists', StatusCodes.CONFLICT);
                }
            }

            if (name !== undefined) superCategory.name = name;
            if (slug !== undefined) superCategory.slug = slug;
            if (description !== undefined) superCategory.description = description;
            if (displayOrder !== undefined) superCategory.displayOrder = displayOrder;

            // Support both legacy `isActive` and newer `status.isActive`
            if (status !== undefined) {
                superCategory.isActive = status;
                superCategory.set('status.isActive', status, { strict: false });
            }

            superCategory.updatedAt = Date.now();
            await superCategory.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Super category updated successfully',
                data: superCategory
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteSuperCategory(req, res, next) {
        try {
            const { id } = req.params;

            const superCategory = await SuperCategory.findById(id);
            if (!superCategory) {
                throw new ErrorResponse('Super category not found', StatusCodes.NOT_FOUND);
            }

            // Soft-delete (safer than hard delete because products/services may reference it)
            superCategory.isActive = false;
            superCategory.set('status.isActive', false, { strict: false });
            superCategory.updatedAt = Date.now();
            await superCategory.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Super category deleted (deactivated) successfully'
            });
        } catch (error) {
            next(error);
        }
    }

async updateServiceCategory(req, res, next) {
    try {
        const { id } = req.params;
        const { name, slug, superCategory, description, displayOrder, status, icon } = req.body;

        // 1️⃣ Check if the service category exists
        const serviceCategory = await ServiceCategory.findById(id);
        if (!serviceCategory) {
            throw new ErrorResponse('Service category not found', StatusCodes.NOT_FOUND);
        }

        // 2️⃣ Check slug uniqueness if slug is being updated
        if (slug && slug !== serviceCategory.slug) {
            const existingCategory = await ServiceCategory.findOne({ slug });
            if (existingCategory) {
                throw new ErrorResponse('Service category with this slug already exists', StatusCodes.CONFLICT);
            }
        }

        // 3️⃣ Validate superCategory IDs (if provided)
        let validatedSuperCategories;
        if (superCategory) {
            const superCatIds = Array.isArray(superCategory) ? superCategory : [superCategory];
            for (const superCatId of superCatIds) {
                const exists = await SuperCategory.findById(superCatId);
                if (!exists) {
                    throw new ErrorResponse(`Super category with ID ${superCatId} not found`, StatusCodes.NOT_FOUND);
                }
            }
            validatedSuperCategories = superCatIds;
        }

        // 4️⃣ Update only the provided fields
        if (name !== undefined) serviceCategory.name = name;
        if (slug !== undefined) serviceCategory.slug = slug;
        if (description !== undefined) serviceCategory.description = description;
        if (displayOrder !== undefined) serviceCategory.displayOrder = displayOrder;
        // Support both legacy `isActive` and newer `status.isActive`
        if (status !== undefined) {
            serviceCategory.isActive = status;
            serviceCategory.set('status.isActive', status, { strict: false });
        }
        if (icon !== undefined) serviceCategory.icon = icon;
        if (validatedSuperCategories) serviceCategory.superCategory = validatedSuperCategories;

        serviceCategory.updatedAt = Date.now();

        // 5️⃣ Save changes
        await serviceCategory.save();

        return res.status(StatusCodes.OK).json({
            success: true,
            message: 'Service category updated successfully',
            data: serviceCategory
        });

    } catch (error) {
        next(error);
    }
    }

    async deleteServiceCategory(req, res, next) {
        try {
            const { id } = req.params;

            const serviceCategory = await ServiceCategory.findById(id);
            if (!serviceCategory) {
                throw new ErrorResponse('Service category not found', StatusCodes.NOT_FOUND);
            }

            // Soft-delete (deactivate)
            serviceCategory.isActive = false;
            serviceCategory.set('status.isActive', false, { strict: false });
            serviceCategory.updatedAt = Date.now();
            await serviceCategory.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Service category deleted (deactivated) successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    async updateSubCategory(req, res, next) {
        try {
            const { id } = req.params;
            const { name, slug, serviceCategory, icon, description, displayOrder, status } = req.body;

            const subCategory = await SubCategory.findById(id);
            if (!subCategory) {
                throw new ErrorResponse('Sub category not found', StatusCodes.NOT_FOUND);
            }

            if (slug && slug !== subCategory.slug) {
                const existing = await SubCategory.findOne({ slug });
                if (existing) {
                    throw new ErrorResponse('Sub category with this slug already exists', StatusCodes.CONFLICT);
                }
            }

            if (serviceCategory) {
                const exists = await ServiceCategory.findById(serviceCategory);
                if (!exists) {
                    throw new ErrorResponse('Service category not found', StatusCodes.NOT_FOUND);
                }
            }

            if (name !== undefined) subCategory.name = name;
            if (slug !== undefined) subCategory.slug = slug;
            if (description !== undefined) subCategory.description = description;
            if (displayOrder !== undefined) subCategory.displayOrder = displayOrder;
            if (icon !== undefined) subCategory.icon = icon;
            if (serviceCategory !== undefined) subCategory.serviceCategory = serviceCategory;

            if (status !== undefined) {
                subCategory.isActive = status;
                subCategory.set('status.isActive', status, { strict: false });
            }

            subCategory.updatedAt = Date.now();
            await subCategory.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Sub category updated successfully',
                data: subCategory
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteSubCategory(req, res, next) {
        try {
            const { id } = req.params;

            const subCategory = await SubCategory.findById(id);
            if (!subCategory) {
                throw new ErrorResponse('Sub category not found', StatusCodes.NOT_FOUND);
            }

            // Soft-delete (deactivate)
            subCategory.isActive = false;
            subCategory.set('status.isActive', false, { strict: false });
            subCategory.updatedAt = Date.now();
            await subCategory.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Sub category deleted (deactivated) successfully'
            });
        } catch (error) {
            next(error);
        }
    }


}

module.exports = new CategoryController();
