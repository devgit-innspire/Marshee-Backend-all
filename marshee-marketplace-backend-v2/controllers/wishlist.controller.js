const Wishlist = require('../models/wishlist.model');
const Product = require('../models/product.model');
const Cart = require('../models/cart.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');

class WishlistController {
    async getWishlist(req, res, next) {
        try {
            const userId = req.user.id;

            let wishlist = await Wishlist.findOne({ user: userId })
                .populate({
                    path: 'items.product',
                    select: 'name sku description defaultMedia pricing inventory'
                })
                .populate({
                    path: 'items.variant',
                    select: 'name attributes price media'
                });

            if (!wishlist) {
                // Create new wishlist if doesn't exist
                wishlist = await Wishlist.create({ user: userId });
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async addToWishlist(req, res, next) {
        try {
            const userId = req.user.id;
            const { productId, variantId, notes, priority } = req.body;

            if (!productId) {
                throw new ErrorResponse('Product ID is required', StatusCodes.BAD_REQUEST);
            }

            // Verify product exists
            const product = await Product.findById(productId);
            if (!product) {
                throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);
            }

            // Get or create wishlist
            let wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                wishlist = await Wishlist.create({ user: userId });
            }

            // Add item to wishlist
            wishlist.addItem(productId, variantId, notes, priority);
            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Item added to wishlist successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async removeFromWishlist(req, res, next) {
        try {
            const userId = req.user.id;
            const { productId, variantId } = req.body;

            if (!productId) {
                throw new ErrorResponse('Product ID is required', StatusCodes.BAD_REQUEST);
            }

            const wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
            }

            wishlist.removeItem(productId, variantId);
            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Item removed from wishlist successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async moveToCart(req, res, next) {
    try {
        const userId = req.user.id;
        const { productId, variantId, quantity = 1 } = req.body;

        console.log(productId, variantId, quantity);
        console.log(userId);

        if (!productId) {
            throw new ErrorResponse('Product ID is required', StatusCodes.BAD_REQUEST);
        }

        if (quantity < 1) {
            throw new ErrorResponse('Quantity must be at least 1', StatusCodes.BAD_REQUEST);
        }

        // Get wishlist
        const wishlist = await Wishlist.findOne({ user: userId });
        if (!wishlist) {
            throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
        }

        // Find the item in wishlist
        const wishlistItem = wishlist.items.find(item => {
            const productMatch = item.product.toString() === productId.toString();
            const variantMatch = variantId ? 
                item.variant?.toString() === variantId.toString() : 
                !item.variant;
            return productMatch && variantMatch;
        });

        if (!wishlistItem) {
            throw new ErrorResponse('Item not found in wishlist', StatusCodes.NOT_FOUND);
        }

        // Get product with variants
        const product = await Product.findById(productId).lean();
        if (!product) {
            throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);
        }

        // Determine price using variant pricing first (product-level pricing may not exist)
        let price = 0;
        let originalPrice = 0;
        let availableStock = 0;

        const variant = product.variants?.find(v => v._id.toString() === variantId?.toString());
        if (variant) {
            price = Number(variant.price?.listPrice) || 0;
            originalPrice = Number(variant.price?.mrp) || price;
            availableStock = Number(variant.stock?.quantity) || 0;
        } else if (variantId) {
            throw new ErrorResponse('Selected variant not found', StatusCodes.NOT_FOUND);
        } else {
            // Stock is tracked per-variant. Variant selection is required.
            throw new ErrorResponse('Please select a variant for this product', StatusCodes.BAD_REQUEST);
        }

        if (availableStock < quantity) {
            throw new ErrorResponse('Insufficient stock available', StatusCodes.BAD_REQUEST);
        }

        // Get or create cart
        let cart = await Cart.findOne({ user: userId });
        if (!cart) {
            cart = await Cart.create({ user: userId });
        }

        // If item exists, increment quantity; otherwise add new with computed pricing
        const existingCartItem = cart.items.find(item => 
            item.product.toString() === productId.toString() && 
            (!variantId || item.variant?.toString() === variantId?.toString())
        );

        if (existingCartItem) {
            existingCartItem.quantity += quantity;
        } else {
            // Cart addItem requires variantId, but wishlist might not have variants
            if (!variantId && variant) {
                // Use the first variant if no specific variant was selected
                variantId = variant._id;
            }
            
            if (variantId) {
                cart.addItem(productId, variantId, quantity, price, originalPrice);
            } else {
                throw new ErrorResponse('Cannot add item to cart: variant is required', StatusCodes.BAD_REQUEST);
            }
        }

        // Remove from wishlist atomically with cart add
        wishlist.removeItem(productId, variantId);

        await Promise.all([cart.save(), wishlist.save()]);

        const populatedCart = await Cart.findById(cart._id)
            .populate({ path: 'items.product', select: 'name sku description defaultMedia inventory status' })
            .populate({ path: 'items.variant', select: 'name attributes price media stock' });

        return res.status(StatusCodes.OK).json({
            success: true,
            message: 'Item moved to cart successfully',
            data: {
                movedItem: wishlistItem,
                cart: populatedCart,
                wishlist: wishlist
            }
        });

    } catch (error) {
        next(error);
    }
   }

    async updateWishlistItem(req, res, next) {
        try {
            const userId = req.user.id;
            const { productId, variantId, notes, priority } = req.body;

            if (!productId) {
                throw new ErrorResponse('Product ID is required', StatusCodes.BAD_REQUEST);
            }

            const wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
            }

            const item = wishlist.items.find(item => {
                const productMatch = item.product.toString() === productId.toString();
                const variantMatch = variantId ? 
                    item.variant?.toString() === variantId.toString() : 
                    !item.variant;
                return productMatch && variantMatch;
            });

            if (!item) {
                throw new ErrorResponse('Item not found in wishlist', StatusCodes.NOT_FOUND);
            }

            if (notes !== undefined) item.notes = notes;
            if (priority !== undefined) item.priority = priority;

            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Wishlist item updated successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async shareWishlist(req, res, next) {
        try {
            const userId = req.user.id;
            const { email, accessLevel } = req.body;

            if (!email) {
                throw new ErrorResponse('Email is required', StatusCodes.BAD_REQUEST);
            }

            const wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
            }

            wishlist.shareWith(email, accessLevel || 'view');
            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Wishlist shared successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async removeShare(req, res, next) {
        try {
            const userId = req.user.id;
            const { email } = req.body;

            if (!email) {
                throw new ErrorResponse('Email is required', StatusCodes.BAD_REQUEST);
            }

            const wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
            }

            wishlist.removeShare(email);
            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Share access removed successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async getSharedWishlist(req, res, next) {
        try {
            const { token } = req.params;

            const wishlist = await Wishlist.findOne({ shareToken: token })
                .populate({
                    path: 'items.product',
                    select: 'name sku description defaultMedia pricing inventory'
                })
                .populate({
                    path: 'items.variant',
                    select: 'name attributes price media'
                });

            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found or invalid share token', StatusCodes.NOT_FOUND);
            }

            return res.status(StatusCodes.OK).json({
                success: true,
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }

    async updateWishlistSettings(req, res, next) {
        try {
            const userId = req.user.id;
            const { name, description, isPublic, allowGifts } = req.body;

            const wishlist = await Wishlist.findOne({ user: userId });
            if (!wishlist) {
                throw new ErrorResponse('Wishlist not found', StatusCodes.NOT_FOUND);
            }

            if (name !== undefined) wishlist.name = name;
            if (description !== undefined) wishlist.description = description;
            if (isPublic !== undefined) wishlist.isPublic = isPublic;
            if (allowGifts !== undefined) wishlist.allowGifts = allowGifts;

            await wishlist.save();

            return res.status(StatusCodes.OK).json({
                success: true,
                message: 'Wishlist settings updated successfully',
                data: wishlist
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new WishlistController();
