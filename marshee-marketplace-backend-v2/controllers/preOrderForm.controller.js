const { StatusCodes } = require('http-status-codes');
const { PreOrder, PreOrderPayment } = require('../models/preOrderForm.model');
const { PRE_ORDER_AMOUNT } = require('../config/preOrderPricing');
const Coupon = require('../models/coupon.model');
const ErrorResponse = require('../utils/errorResponse');

/**
 * Create a new pre-order
 */
exports.createPreOrder = async (req, res, next) => {
  try {

    const { 
      name, 
      email, 
      phone, 
      address, 
      couponCode, 
      amount = 99, 
      addedBy,
      interestedInAlphaTesting,
      notes,
      // Pet fields (optional)
      pet
    } = req.body;
    console.log("Pet data received:", pet, "Type:", typeof pet);

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

    // Price is server-derived. This endpoint is public, so honouring a client-supplied
    // `amount` would let anyone set their own pre-order price.
    const originalAmount = PRE_ORDER_AMOUNT;
    let finalAmount = originalAmount;
    let discountAmount = 0;
    let couponData = null;

    // Validate and apply coupon if provided
    if (couponCode) {
      try {
        const coupon = await Coupon.findOne({ 
          code: couponCode.toUpperCase().trim(),
          isActive: true
        });

        if (!coupon) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            error: 'Invalid coupon code'
          });
        }

        // Check if coupon is valid (not expired, within usage limits)
        if (!coupon.isValid) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            error: 'Coupon is expired or inactive'
          });
        }

        // Check if coupon has reached max usage limit
        if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            error: 'Coupon has reached maximum usage limit'
          });
        }

        // Check if user can use coupon (minimum order amount)
        if (!coupon.canUserUse(null, originalAmount)) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            error: `Coupon requires minimum order amount of ₹${coupon.minimumOrderAmount}`
          });
        }

        // Calculate discount
        discountAmount = coupon.calculateDiscount(originalAmount);
        finalAmount = Math.max(0, originalAmount - discountAmount);

        // Store coupon data
        couponData = {
          code: coupon.code,
          couponId: coupon._id,
          discountAmount: discountAmount,
          originalAmount: originalAmount,
          finalAmount: finalAmount
        };

        console.log(`Coupon applied: ${coupon.code}, Discount: ₹${discountAmount}, Final Amount: ₹${finalAmount}`);
      } catch (couponError) {
        console.error('Coupon validation error:', couponError);
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: couponError.message || 'Error validating coupon code'
        });
      }
    }

    // Create pre-order with coupon information
    const preOrderData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      address: address.trim(),
      status: 'new'
    };

    // Add addedBy field if provided
    if (addedBy) {
      preOrderData.addedBy = addedBy.trim();
    }

    // Add notes field if provided
    if (notes !== undefined && notes !== null) {
      preOrderData.notes = typeof notes === 'string' ? notes.trim() : String(notes).trim();
    }

    // Handle interestedInAlphaTesting checkbox field
    // Checkboxes can send "true", "false", true, false, or be undefined
    if (interestedInAlphaTesting !== undefined && interestedInAlphaTesting !== null) {
      // Convert string "true"/"false" to boolean, or use boolean value directly
      if (typeof interestedInAlphaTesting === 'string') {
        preOrderData.interestedInAlphaTesting = interestedInAlphaTesting.toLowerCase() === 'true';
      } else {
        preOrderData.interestedInAlphaTesting = Boolean(interestedInAlphaTesting);
      }
    } else {
      // Default to false if not provided
      preOrderData.interestedInAlphaTesting = false;
    }

    // Add coupon data if available
    if (couponData) {
      preOrderData.coupon = couponData;
    }

    // Add pet information if provided
    // Handle pet data - could be object or JSON string
    let petObject = pet;
    if (pet && typeof pet === 'string') {
      try {
        petObject = JSON.parse(pet);
        console.log('Parsed pet data from string:', petObject);
      } catch (e) {
        console.error('Failed to parse pet data as JSON:', e);
        petObject = null;
      }
    }
    
    if (petObject && typeof petObject === 'object' && !Array.isArray(petObject)) {
      const petData = {};
      
      if (petObject.photo && petObject.photo.trim()) {
        petData.photo = petObject.photo.trim();
      }
      if (petObject.name && petObject.name.trim()) {
        petData.name = petObject.name.trim();
      }
      if (petObject.breed && petObject.breed.trim()) {
        petData.breed = petObject.breed.trim();
      }
      if (petObject.bloodGroup && petObject.bloodGroup.trim()) {
        petData.bloodGroup = petObject.bloodGroup.trim().toUpperCase();
      }
      if (petObject.gender) {
        // Validate gender enum
        const validGenders = ['Male', 'Female'];
        const genderValue = typeof petObject.gender === 'string' ? petObject.gender.trim() : petObject.gender;
        if (validGenders.includes(genderValue)) {
          petData.gender = genderValue;
        }
      }
      
      // Validate and parse birthdate
      if (petObject.birthdate !== undefined && petObject.birthdate !== null && petObject.birthdate !== '') {
        const birthdateValue = new Date(petObject.birthdate);
        if (!isNaN(birthdateValue.getTime())) {
          // Check if birthdate is not in the future
          if (birthdateValue <= new Date()) {
            petData.birthdate = birthdateValue;
          } else {
            console.warn('Birthdate cannot be in the future:', petObject.birthdate);
          }
        } else {
          console.warn('Invalid birthdate format:', petObject.birthdate);
        }
      }
      
      // Validate and parse numeric fields
      if (petObject.weight !== undefined && petObject.weight !== null && petObject.weight !== '') {
        const weightNum = Number(petObject.weight);
        if (!isNaN(weightNum) && weightNum >= 0) {
          petData.weight = weightNum;
        }
      }
      
      // Only add pet object if at least one field is provided
      if (Object.keys(petData).length > 0) {
        preOrderData.pet = petData;
        console.log('Pet data to be saved:', JSON.stringify(petData, null, 2));
      } else {
        console.log('Pet object provided but no valid fields found:', petObject);
      }
    } else if (pet) {
      console.log('Pet data is not a valid object:', typeof petObject, petObject);
    }

    console.log('Pre-order data before save:', JSON.stringify(preOrderData, null, 2));
    
    // Create the pre-order
    const preOrder = await PreOrder.create(preOrderData);
    
    // Verify pet data was saved
    const savedPreOrder = await PreOrder.findById(preOrder._id);
    console.log('Pre-order created with ID:', preOrder._id);
    console.log('Pet data in saved document:', savedPreOrder.pet ? JSON.stringify(savedPreOrder.pet, null, 2) : 'No pet data found');
    
    if (preOrderData.pet && !savedPreOrder.pet) {
      console.error('WARNING: Pet data was in preOrderData but not saved to database!');
      console.error('Attempted pet data:', JSON.stringify(preOrderData.pet, null, 2));
    }

    console.log('Pre-order created successfully:', preOrder._id);

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Pre-order created successfully',
      preOrderId: preOrder._id.toString(),
      preOrder: {
        _id: preOrder._id,
        name: preOrder.name,
        email: preOrder.email,
        phone: preOrder.phone,
        address: preOrder.address,
        pet: savedPreOrder.pet || null,
        coupon: preOrderData.coupon || null,
        finalAmount: finalAmount,
        status: preOrder.status,
        createdAt: preOrder.createdAt
      }
    });
  } catch (error) {
    console.error('Pre-order creation error:', error);

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
 * Get all pre-orders (with pagination and filtering)
 */
exports.getAllPreOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.email) {
      filter.email = req.query.email.toLowerCase().trim();
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
        { address: searchRegex },
        { addedBy: searchRegex }
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

    // Get collection name dynamically for lookup (fallback to standard naming convention)
    const paymentCollectionName = PreOrderPayment.collection?.name || 'preorderpayments';

    // Use aggregation to join payment data
    const aggregationPipeline = [
      // Match pre-orders based on filter
      { $match: filter },
      
      // Lookup payment information
      {
        $lookup: {
          from: paymentCollectionName,
          localField: '_id',
          foreignField: 'preOrder',
          as: 'payments'
        }
      },
      
      // Get the latest payment (most recent)
      {
        $addFields: {
          payment: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: {
                $arrayElemAt: [
                  {
                    $sortArray: {
                      input: '$payments',
                      sortBy: { createdAt: -1 }
                    }
                  },
                  0
                ]
              },
              else: null
            }
          }
        }
      },
      
      // Add payment amount and status fields for easier access
      {
        $addFields: {
          paymentAmount: { $ifNull: ['$payment.amount', null] },
          paymentStatus: { $ifNull: ['$payment.status', null] },
          paymentCurrency: { $ifNull: ['$payment.currency', null] },
          paymentId: { $ifNull: ['$payment._id', null] }
        }
      },
      
      // Remove the payments array (we only need the latest payment)
      {
        $project: {
          payments: 0,
          __v: 0
        }
      },
      
      // Sort by creation date
      { $sort: { createdAt: -1 } },
      
      // Pagination
      { $skip: skip },
      { $limit: limit }
    ];

    // Get total count for pagination
    const total = await PreOrder.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    // Execute aggregation
    const preOrders = await PreOrder.aggregate(aggregationPipeline);

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
    console.error('Error fetching pre-orders:', error);
    next(error);
  }
};

/**
 * Get pre-order by ID
 */
exports.getPreOrderById = async (req, res, next) => {
  try {
    const preOrder = await PreOrder.findById(req.params.id).select('-__v');

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
    console.error('Error fetching pre-order:', error);
    
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
 * Update pre-order by ID
 */
exports.updatePreOrder = async (req, res, next) => {
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

    // Trim string fields
    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.phone) updateData.phone = updateData.phone.trim();
    if (updateData.address) updateData.address = updateData.address.trim();
    if (updateData.notes) updateData.notes = updateData.notes.trim();
    if (updateData.addedBy) updateData.addedBy = updateData.addedBy.trim();

    // Handle interestedInAlphaTesting checkbox field
    if (updateData.interestedInAlphaTesting !== undefined && updateData.interestedInAlphaTesting !== null) {
      // Convert string "true"/"false" to boolean, or use boolean value directly
      if (typeof updateData.interestedInAlphaTesting === 'string') {
        updateData.interestedInAlphaTesting = updateData.interestedInAlphaTesting.toLowerCase() === 'true';
      } else {
        updateData.interestedInAlphaTesting = Boolean(updateData.interestedInAlphaTesting);
      }
    }

    const preOrder = await PreOrder.findByIdAndUpdate(
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
    console.error('Error updating pre-order:', error);
    
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
 * Delete pre-order by ID
 */
exports.deletePreOrder = async (req, res, next) => {
  try {
    const preOrder = await PreOrder.findByIdAndDelete(req.params.id);

    if (!preOrder) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Pre-order not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Pre-order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting pre-order:', error);
    
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
 * Get comprehensive pre-order statistics
 */
exports.getPreOrderStats = async (req, res, next) => {
  try {
    // Get total pre-orders
    const totalPreOrders = await PreOrder.countDocuments();
    
    // Get completed pre-orders (pre-orders with completed payment)
    const completedPreOrders = await PreOrderPayment.countDocuments({
      status: 'completed'
    });

    // Calculate completed percentage
    const completedPercentage = totalPreOrders > 0 
      ? ((completedPreOrders / totalPreOrders) * 100).toFixed(2)
      : 0;

    // Get pre-order status breakdown
    const statusStats = await PreOrder.aggregate([
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
    const paymentStatusStats = await PreOrderPayment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get recent pre-orders (last 24 hours)
    const recentPreOrders = await PreOrder.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Get recent completed pre-orders (last 24 hours)
    const recentCompletedPreOrders = await PreOrderPayment.countDocuments({
      status: 'completed',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Get pre-orders by date range (last 7 days, 30 days)
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const preOrdersLast7Days = await PreOrder.countDocuments({
      createdAt: { $gte: last7Days }
    });

    const preOrdersLast30Days = await PreOrder.countDocuments({
      createdAt: { $gte: last30Days }
    });

    const completedLast7Days = await PreOrderPayment.countDocuments({
      status: 'completed',
      createdAt: { $gte: last7Days }
    });

    const completedLast30Days = await PreOrderPayment.countDocuments({
      status: 'completed',
      createdAt: { $gte: last30Days }
    });

    // Calculate total revenue from completed payments
    const revenueStats = await PreOrderPayment.aggregate([
      {
        $match: { status: 'completed' }
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
    const pendingPreOrders = await PreOrderPayment.countDocuments({
      status: 'pending'
    });

    const failedPreOrders = await PreOrderPayment.countDocuments({
      status: 'failed'
    });

    // Get coupon usage stats
    const couponUsageStats = await PreOrder.aggregate([
      {
        $match: { 'coupon.code': { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: '$coupon.code',
          count: { $sum: 1 },
          totalDiscount: { $sum: '$coupon.discountAmount' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Format status breakdown for better readability
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
        completionRate: {
          total: totalPreOrders,
          completed: completedPreOrders,
          percentage: parseFloat(completedPercentage),
          pending: pendingPreOrders,
          failed: failedPreOrders
        },
        timeBasedStats: {
          last24Hours: {
            total: recentPreOrders,
            completed: recentCompletedPreOrders
          },
          last7Days: {
            total: preOrdersLast7Days,
            completed: completedLast7Days,
            completionRate: preOrdersLast7Days > 0 
              ? ((completedLast7Days / preOrdersLast7Days) * 100).toFixed(2)
              : 0
          },
          last30Days: {
            total: preOrdersLast30Days,
            completed: completedLast30Days,
            completionRate: preOrdersLast30Days > 0
              ? ((completedLast30Days / preOrdersLast30Days) * 100).toFixed(2)
              : 0
          }
        },
        revenue: {
          totalRevenue: revenueData.totalRevenue || 0,
          averageOrderValue: revenueData.averageOrderValue ? parseFloat(revenueData.averageOrderValue.toFixed(2)) : 0,
          totalCompletedOrders: revenueData.count || 0
        },
        statusBreakdown: formattedStatusStats,
        paymentStatusBreakdown: formattedPaymentStats,
        topCoupons: couponUsageStats.map(coupon => ({
          code: coupon._id,
          usageCount: coupon.count,
          totalDiscount: coupon.totalDiscount || 0
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching pre-order stats:', error);
    next(error);
  }
};

