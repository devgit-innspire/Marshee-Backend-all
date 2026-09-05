const { body, validationResult } = require('express-validator');
const ErrorResponse = require('../utils/errorResponse');
const { StatusCodes } = require('http-status-codes');
const Product = require('../models/product.model');
const mongoose = require('mongoose');

const validateProduct = async (req, res, next) => {
    try {
        // Validate required fields first
        await Promise.all([
            body('name')
                .trim()
                .notEmpty()
                .withMessage('Product name is required')
                .isLength({ max: 256 })
                .withMessage('Product name cannot exceed 256 characters')
                .run(req),

            body('sku')
                .trim()
                .notEmpty()
                .withMessage('SKU is required')
                .run(req),

            body('hsnCode')
                .trim()
                .notEmpty()
                .withMessage('HSN Code is required')
                .run(req),

            body('ingredients')
                .trim()
                .notEmpty()
                .withMessage('Ingredients are required')
                .run(req),

            body('manufacturingDetails.manufacturer')
                .trim()
                .notEmpty()
                .withMessage('Manufacturer is required')
                .run(req),

            body('manufacturingDetails.countryOfOrigin')
                .trim()
                .notEmpty()
                .withMessage('Country of origin is required')
                .run(req),

            body('manufacturingDetails.gstin')
                .trim()
                .notEmpty()
                .withMessage('GSTIN is required')
                .run(req),

            body('manufacturingDetails.dispatch.city')
                .trim()
                .notEmpty()
                .withMessage('Dispatch city is required')
                .run(req),

            body('manufacturingDetails.dispatch.state')
                .trim()
                .notEmpty()
                .withMessage('Dispatch state is required')
                .run(req),

            body('manufacturingDetails.dispatch.pinCode')
                .trim()
                .notEmpty()
                .withMessage('Dispatch pin code is required')
                .run(req),

            body('category.superCategory')
                .notEmpty()
                .withMessage('Super category is required')
                .custom((value) => {
                    // Handle both single ID and array of IDs
                    if (Array.isArray(value)) {
                        if (value.length === 0) {
                            throw new Error('At least one super category is required');
                        }
                        // Validate that all items are valid ObjectId strings
                        const mongoose = require('mongoose');
                        return value.every(id => mongoose.Types.ObjectId.isValid(id));
                    } else {
                        // Single ID validation
                        const mongoose = require('mongoose');
                        return mongoose.Types.ObjectId.isValid(value);
                    }
                })
                .withMessage('Invalid super category ID(s)')
                .run(req),

            body('category.serviceCategory')
                .notEmpty()
                .withMessage('Service category is required')
                .run(req),

            body('category.subCategory')
                .notEmpty()
                .withMessage('Sub category is required')
                .run(req),

            body('brand')
                .notEmpty()
                .withMessage('Brand is required')
                .run(req),

            body('partner')
                .notEmpty()
                .withMessage('Partner is required')
                .run(req),

            body('pricing.basePrice')
                .notEmpty()
                .withMessage('Base price is required')
                .isFloat({ min: 0 })
                .withMessage('Price must be a positive number')
                .toFloat()
                .run(req),

            body('inventory.sku')
                .trim()
                .notEmpty()
                .withMessage('Inventory SKU is required')
                .run(req),

            // Stock is tracked per-variant. Do not require (or validate) aggregatedStock.total.
            // Variants should carry their own stock.quantity values.
        ]);

        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST);
        }

        const productData = req.body;

        // Generate productId and slug if not provided
        if (!productData.productId) {
            productData.productId = `PRD${Date.now()}${Math.floor(Math.random() * 1000)}`;
        }
        
        if (!productData.slug) {
            const slugify = require('slugify');
            productData.slug = slugify(productData.name, { lower: true });
        }

        // Ensure ingredients is a string, not an array
        if (Array.isArray(productData.ingredients)) {
            productData.ingredients = productData.ingredients.join(', ');
        }

        // Handle description structure
        if (productData.description && typeof productData.description === 'object') {
            // Keep as is if it's already structured
        } else if (productData.description && typeof productData.description === 'string') {
            productData.description = {
                full: productData.description,
                short: productData.description.substring(0, 100) + '...'
            };
        }

        // Handle pricing structure
        if (productData.pricing && typeof productData.pricing === 'object') {
            // Keep as is if it's already structured
        } else {
            productData.pricing = {
                basePrice: Number(productData.basePrice || 0),
                currency: productData.currency || 'INR',
                tax: {
                    rate: productData.taxRate ? Number(productData.taxRate) : null,
                    inclusive: Boolean(productData.taxInclusive)
                }
            };
        }

        // Handle inventory structure
        if (productData.inventory && typeof productData.inventory === 'object') {
            // Keep as is if it's already structured
        } else {
            productData.inventory = {
                sku: productData.sku,
                gtin: productData.gtin,
                aggregatedStock: {
                    total: Number(productData.totalStock || 0),
                    reserved: 0
                }
            };
        }

        // Handle petDetails structure - ensure targetPet is set
        if (productData.petDetails && typeof productData.petDetails === 'object') {
            // Ensure targetPet is set
            if (!productData.petDetails.targetPet) {
                productData.petDetails.targetPet = 'Dog'; // Default value
            }
        } else {
            productData.petDetails = {
                targetPet: productData.petType || 'Dog',
                ageSuitability: {
                    lifeStages: productData.lifeStages || []
                },
                weightSuitability: {
                    breedSizes: productData.breedSizes || []
                },
                healthBenefits: productData.healthBenefits || []
            };
        }

        // Update the request body with structured data
        req.body = productData;

        next();
    } catch (error) {
        next(new ErrorResponse(error.message || 'Validation failed', StatusCodes.BAD_REQUEST));
    }
};

module.exports = {
    validateProduct,
    // Cart validators
    validateCartAdd: [
        body('productId')
            .notEmpty().withMessage('Product ID is required')
            .custom((val) => mongoose.Types.ObjectId.isValid(val)).withMessage('Invalid product ID'),
        body('variantId')
            .notEmpty().withMessage('Variant ID is required')
            .custom((val) => typeof val === 'string' && val.length > 0).withMessage('Invalid variant ID'),
        body('quantity')
            .notEmpty().withMessage('Quantity is required')
            .isInt({ min: 1 }).withMessage('Quantity must be at least 1')
            .toInt(),
        (req, res, next) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST));
            }
            next();
        }
    ],
    validateCartUpdate: [
        body('productId')
            .notEmpty().withMessage('Product ID is required')
            .custom((val) => mongoose.Types.ObjectId.isValid(val)).withMessage('Invalid product ID'),
        body('variantId')
            .notEmpty().withMessage('Variant ID is required')
            .custom((val) => typeof val === 'string' && val.length > 0).withMessage('Invalid variant ID'),
        body('quantity')
            .notEmpty().withMessage('Quantity is required')
            .isInt({ min: 1 }).withMessage('Quantity must be at least 1')
            .toInt(),
        (req, res, next) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST));
            }
            next();
        }
    ],
    validateCartRemove: [
        body('productId')
            .notEmpty().withMessage('Product ID is required')
            .custom((val) => mongoose.Types.ObjectId.isValid(val)).withMessage('Invalid product ID'),
        body('variantId')
            .notEmpty().withMessage('Variant ID is required')
            .custom((val) => typeof val === 'string' && val.length > 0).withMessage('Invalid variant ID'),
        (req, res, next) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST));
            }
            next();
        }
    ],
    validateCartApplyCoupon: [
        body('couponCode')
            .trim()
            .notEmpty().withMessage('Coupon code is required'),
        (req, res, next) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST));
            }
            next();
        }
    ],
    validateCartCheckoutPreferences: [
        body('deliveryInstructions')
            .optional()
            .isString()
            .withMessage('deliveryInstructions must be a string')
            .isLength({ max: 2000 })
            .withMessage('deliveryInstructions must be at most 2000 characters'),
        body('paymentMethod').optional(),
        (req, res, next) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(new ErrorResponse('Validation failed', StatusCodes.BAD_REQUEST));
            }
            const hasInstructions = Object.prototype.hasOwnProperty.call(req.body, 'deliveryInstructions');
            const hasPayment = Object.prototype.hasOwnProperty.call(req.body, 'paymentMethod');
            if (!hasInstructions && !hasPayment) {
                return next(new ErrorResponse('Provide deliveryInstructions and/or paymentMethod', StatusCodes.BAD_REQUEST));
            }
            const pm = req.body.paymentMethod;
            if (hasPayment && pm !== null && pm !== undefined && pm !== '') {
                const allowed = ['cod', 'online', 'wallet', 'upi'];
                if (!allowed.includes(pm)) {
                    return next(new ErrorResponse('paymentMethod must be one of: cod, online, wallet, upi', StatusCodes.BAD_REQUEST));
                }
            }
            next();
        }
    ]
};
