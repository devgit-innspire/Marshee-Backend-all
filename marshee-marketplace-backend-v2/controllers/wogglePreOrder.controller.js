const { StatusCodes } = require('http-status-codes');
const WogglePreOrder = require('../models/wogglePreOrder.model');
const ErrorResponse = require('../utils/errorResponse');
const { WOGGLE_PRE_ORDER_AMOUNT } = require('../config/preOrderPricing');

/**
 * Create a new Woggle pre-order
 */
exports.createWogglePreOrder = async (req, res, next) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      address, 
      amount = 1
    } = req.body;

    console.log("Woggle pre-order request body:", req.body);

    // Basic validation for required fields
    if (!name || !email || !phone || !address) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Name, email, phone, and address are required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Validate phone number (10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^\d{10}$/.test(phoneDigits)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Phone number must be exactly 10 digits'
      });
    }

    // Price is server-derived. This endpoint is public, so honouring a client-supplied
    // `amount` would let anyone set their own pre-order price.
    const amountNum = WOGGLE_PRE_ORDER_AMOUNT;
    if (amount !== undefined && Number(amount) !== amountNum) {
      console.warn('[Woggle] Ignoring client-supplied amount', { clientAmount: amount, serverAmount: amountNum });
    }

    // Create pre-order
    const preOrderData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneDigits,
      address: address.trim(),
      amount: amountNum,
      status: 'new'
    };

    const wogglePreOrder = await WogglePreOrder.create(preOrderData);

    console.log('Woggle pre-order created successfully:', wogglePreOrder._id);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Pre-order created successfully',
      preOrderId: wogglePreOrder._id.toString(),
      amount: amountNum,
      data: wogglePreOrder
    });
  } catch (error) {
    console.error('Woggle pre-order creation error:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    if (error.code === 11000) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Duplicate entry. Please check your information.'
      });
    }

    next(error);
  }
};

/**
 * Get all Woggle pre-orders (with pagination and filtering)
 */
exports.getAllWogglePreOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.email) {
      filter.email = req.query.email.toLowerCase().trim();
    }

    if (req.query.phone) {
      filter.phone = req.query.phone.replace(/\D/g, '');
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { address: searchRegex }
      ];
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    // Get total count for pagination
    const total = await WogglePreOrder.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    // Find pre-orders with payment details embedded
    const preOrders = await WogglePreOrder.find(filter)
      .select('-__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        preOrders,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching Woggle pre-orders:', error);
    next(error);
  }
};

/**
 * Get Woggle pre-order by ID
 */
exports.getWogglePreOrderById = async (req, res, next) => {
  try {
    const preOrder = await WogglePreOrder.findById(req.params.id)
      .select('-__v');

    if (!preOrder) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Pre-order not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: preOrder
    });
  } catch (error) {
    console.error('Error fetching Woggle pre-order:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid pre-order ID'
      });
    }

    next(error);
  }
};

/**
 * Update Woggle pre-order by ID
 */
exports.updateWogglePreOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate email format if email is being updated
    if (updateData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Please provide a valid email address'
        });
      }
      updateData.email = updateData.email.trim().toLowerCase();
    }

    // Validate phone if being updated
    if (updateData.phone) {
      const phoneDigits = updateData.phone.replace(/\D/g, '');
      if (!/^\d{10}$/.test(phoneDigits)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Phone number must be exactly 10 digits'
        });
      }
      updateData.phone = phoneDigits;
    }

    // Trim string fields
    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.address) updateData.address = updateData.address.trim();
    if (updateData.notes) updateData.notes = updateData.notes.trim();

    const preOrder = await WogglePreOrder.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-__v');

    if (!preOrder) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Pre-order not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Pre-order updated successfully',
      data: preOrder
    });
  } catch (error) {
    console.error('Error updating Woggle pre-order:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid pre-order ID'
      });
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    next(error);
  }
};

/**
 * Delete Woggle pre-order by ID
 */
exports.deleteWogglePreOrder = async (req, res, next) => {
  try {
    const preOrder = await WogglePreOrder.findByIdAndDelete(req.params.id);

    if (!preOrder) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Pre-order not found'
      });
    }

    // Payment details are embedded, so no need to delete separately

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Pre-order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting Woggle pre-order:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid pre-order ID'
      });
    }

    next(error);
  }
};

/**
 * Get Woggle pre-order statistics
 */
exports.getWogglePreOrderStats = async (req, res, next) => {
  try {
    // Get total pre-orders
    const totalPreOrders = await WogglePreOrder.countDocuments();
    
    // Get completed pre-orders (pre-orders with completed payment)
    const completedPreOrders = await WogglePreOrder.countDocuments({
      paymentStatus: 'completed'
    });

    // Calculate completed percentage
    const completedPercentage = totalPreOrders > 0 
      ? ((completedPreOrders / totalPreOrders) * 100).toFixed(2)
      : 0;

    // Get pre-order status breakdown
    const statusStats = await WogglePreOrder.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get payment status breakdown
    const paymentStatusStats = await WogglePreOrder.aggregate([
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get recent pre-orders (last 24 hours)
    const recentPreOrders = await WogglePreOrder.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Get recent completed pre-orders (last 24 hours)
    const recentCompletedPreOrders = await WogglePreOrder.countDocuments({
      paymentStatus: 'completed',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Calculate total revenue from completed payments
    const revenueStats = await WogglePreOrder.aggregate([
      {
        $match: { paymentStatus: 'completed' }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          averageOrderValue: { $avg: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const revenueData = revenueStats[0] || {
      totalRevenue: 0,
      averageOrderValue: 0,
      count: 0
    };

    // Get pending and failed pre-orders
    const pendingPreOrders = await WogglePreOrder.countDocuments({
      paymentStatus: 'pending'
    });

    const failedPreOrders = await WogglePreOrder.countDocuments({
      paymentStatus: 'failed'
    });

    // Format status breakdown
    const formattedStatusStats = statusStats.map(stat => ({
      status: stat._id,
      count: stat.count,
      percentage: totalPreOrders > 0 ? ((stat.count / totalPreOrders) * 100).toFixed(2) : 0
    }));

    // Format payment status breakdown
    const formattedPaymentStats = paymentStatusStats.map(stat => ({
      status: stat._id,
      count: stat.count,
      totalAmount: stat.totalAmount || 0,
      percentage: totalPreOrders > 0 ? ((stat.count / totalPreOrders) * 100).toFixed(2) : 0
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        overview: {
          totalPreOrders,
          completedPreOrders,
          completedPercentage: parseFloat(completedPercentage),
          pendingPreOrders,
          failedPreOrders,
          recentPreOrders,
          recentCompletedPreOrders
        },
        revenue: {
          totalRevenue: revenueData.totalRevenue || 0,
          averageOrderValue: revenueData.averageOrderValue ? parseFloat(revenueData.averageOrderValue.toFixed(2)) : 0,
          totalCompletedOrders: revenueData.count || 0
        },
        statusBreakdown: formattedStatusStats,
        paymentStatusBreakdown: formattedPaymentStats
      }
    });
  } catch (error) {
    console.error('Error fetching Woggle pre-order stats:', error);
    next(error);
  }
};
