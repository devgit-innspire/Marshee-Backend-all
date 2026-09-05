const Address = require('../models/address.model');


// Create Address - Fix the existing checks
exports.createAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { addressType, billingAddress, shippingAddress, isDefaultBilling, isDefaultShipping } = req.body;

    console.log('Request Body:', req.body);

    // Validate that at least one address is provided
    if (!billingAddress && !shippingAddress) {
      return res.status(400).json({ 
        success: false,
        message: 'At least one address (billingAddress or shippingAddress) is required' 
      });
    }

    // Email is no longer part of Address; use User.email when needed elsewhere

    // REMOVE or MODIFY these restrictive checks:
    // Allow multiple addresses of same type, just handle defaults properly
    
    // If setting as default billing, remove default from others
    if (isDefaultBilling && billingAddress) {
      await Address.updateMany(
        { user: userId, 'billingAddress': { $exists: true, $ne: null } },
        { $set: { isDefaultBilling: false } }
      );
    }

    // If setting as default shipping, remove default from others
    if (isDefaultShipping && shippingAddress) {
      await Address.updateMany(
        { user: userId, 'shippingAddress': { $exists: true, $ne: null } },
        { $set: { isDefaultShipping: false } }
      );
    }

    // Prepare address data
    const addressData = {
      user: userId,
      addressType: addressType || 'home',
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      isDefaultBilling: isDefaultBilling || false,
      isDefaultShipping: isDefaultShipping || false
    };

    // Validate billing address structure if provided
    if (billingAddress && Object.keys(billingAddress).length > 0) {
      const requiredFields = ['street', 'city', 'state', 'postalCode', 'country'];
      const missingFields = requiredFields.filter(field => !billingAddress[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Billing address is missing required fields: ${missingFields.join(', ')}`,
          missingFields
        });
      }
    }

    // Validate shipping address structure if provided
    if (shippingAddress && Object.keys(shippingAddress).length > 0) {
      const requiredFields = ['street', 'city', 'state', 'postalCode', 'country'];
      const missingFields = requiredFields.filter(field => !shippingAddress[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Shipping address is missing required fields: ${missingFields.join(', ')}`,
          missingFields
        });
      }
    }

    // Create and save address
    const address = new Address(addressData);
    await address.save();
    
    // Populate user info in response
    await address.populate('user', 'name email');
    
    res.status(201).json({
      success: true,
      message: 'Address created successfully',
      data: address
    });
    
  } catch (err) {
    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => ({
        field: error.path,
        message: error.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }
    
    next(err);
  }
};

/**
 * Get all address documents for the authenticated user (shipping + billing rows).
 * Excludes soft-deleted entries. Scoped by JWT — ignores query `user`.
 */
exports.getMyAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 50, addressType } = req.query;

    const filter = {
      user: userId,
      isDeleted: { $ne: true },
    };
    if (addressType) {
      filter.addressType = addressType;
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
    const skip = (pageNum - 1) * take;

    const [addresses, total] = await Promise.all([
      Address.find(filter)
        .populate('user', 'name email')
        .limit(take)
        .skip(skip)
        .sort({ createdAt: -1 }),
      Address.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: addresses,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / take) || 1,
        total,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get All Addresses
exports.getAllAddresses = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, addressType, user } = req.query;
    
    // Build filter object
    const filter = {};
    if (addressType) filter.addressType = addressType;
    if (user) filter.user = user;
    
    const addresses = await Address.find(filter)
      .populate('user', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await Address.countDocuments(filter);
    
    res.json({
      success: true,
      data: addresses,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (err) {
    next(err);
  }
};

// Get User's Billing Address
exports.getBillingAddress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const billingAddress = await Address.findOne({ 
      user: userId,
      'billingAddress': { $exists: true, $ne: null }
    }).populate('user', 'name email');
    
    if (!billingAddress) {
      return res.status(404).json({ 
        success: false,
        message: 'Billing address not found' 
      });
    }
    
    res.json({
      success: true,
      data: billingAddress
    });
  } catch (err) {
    next(err);
  }
};

// Get User's Shipping Addresses
exports.getShippingAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    
    const shippingAddresses = await Address.find({ 
      user: userId,
      'shippingAddress': { $exists: true, $ne: null }
    })
    .populate('user', 'name email')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .sort({ createdAt: -1 });
    
    const total = await Address.countDocuments({ 
      user: userId,
      'shippingAddress': { $exists: true, $ne: null }
    });
    
    res.json({
      success: true,
      data: shippingAddresses,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (err) {
    next(err);
  }
};

// Get Address by ID
exports.getAddressById = async (req, res, next) => {
  try {
    const address = await Address.findById(req.params.id)
      .populate('user', 'name email phone');
    
    if (!address) {
      return res.status(404).json({ 
        success: false,
        message: 'Address not found' 
      });
    }
    
    res.json({
      success: true,
      data: address
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid address ID'
      });
    }
    next(err);
  }
};

// Update Address
exports.updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find address first to check ownership
    const existingAddress = await Address.findById(id);
    
    if (!existingAddress) {
      return res.status(404).json({ 
        success: false,
        message: 'Address not found' 
      });
    }
    
    // Check if user owns this address
    if (existingAddress.user.toString() !== userId) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to update this address' 
      });
    }
    
    // Prevent changing address type to one that already exists (for non-billing)
    if (req.body.addressType && req.body.addressType !== existingAddress.addressType) {
      if (existingAddress.billingAddress && Object.keys(existingAddress.billingAddress).length > 0) {
        return res.status(400).json({ 
          success: false,
          message: 'Cannot change type of billing address' 
        });
      }
      
      const duplicateAddress = await Address.findOne({ 
        user: userId, 
        addressType: req.body.addressType 
      });
      
      if (duplicateAddress) {
        return res.status(400).json({ 
          success: false,
          message: `You already have a ${req.body.addressType} address` 
        });
      }
    }
    
    
    const address = await Address.findByIdAndUpdate(
      id, 
      req.body, 
      { 
        new: true, 
        runValidators: true 
      }
    ).populate('user', 'name email');
    
    res.json({
      success: true,
      message: 'Address updated successfully',
      data: address
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(error => ({
        field: error.path,
        message: error.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }
    next(err);
  }
};

// Set Default Shipping Address
exports.setDefaultShippingAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find address and check ownership
    const address = await Address.findOne({ 
      _id: id, 
      user: userId,
      'shippingAddress': { $exists: true, $ne: null }
    });
    
    if (!address) {
      return res.status(404).json({ 
        success: false,
        message: 'Shipping address not found or you are not authorized' 
      });
    }
    
    // Remove default from all other shipping addresses by setting false
    await Address.updateMany(
      { 
        user: userId, 
        _id: { $ne: id },
        'shippingAddress': { $exists: true, $ne: null }
      },
      { $set: { isDefaultShipping: false } }
    );
    
    // Set this address as default
    address.isDefaultShipping = true;
    await address.save();
    
    res.json({
      success: true,
      message: 'Default shipping address set successfully',
      data: address
    });
  } catch (err) {
    next(err);
  }
};

// Set Default Billing Address
exports.setDefaultBillingAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const address = await Address.findOne({ 
      _id: id, 
      user: userId,
      'billingAddress': { $exists: true, $ne: null }
    });
    
    if (!address) {
      return res.status(404).json({ 
        success: false,
        message: 'Billing address not found or you are not authorized' 
      });
    }

    await Address.updateMany(
      { 
        user: userId, 
        _id: { $ne: id },
        'billingAddress': { $exists: true, $ne: null }
      },
      { $set: { isDefaultBilling: false } }
    );

    address.isDefaultBilling = true;
    await address.save();

    res.json({
      success: true,
      message: 'Default billing address set successfully',
      data: address
    });
  } catch (err) {
    next(err);
  }
};

// Soft Delete Address
exports.softDeleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const address = await Address.findById(id);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    if (address.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this address' });
    }

    address.isDeleted = true;
    address.deletedAt = new Date();
    address.isDefaultBilling = false;
    address.isDefaultShipping = false;
    await address.save();

    res.json({ success: true, message: 'Address deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid address ID' });
    }
    next(err);
  }
};
// Delete Address
exports.deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find address first to check ownership
    const address = await Address.findById(id);
    
    if (!address) {
      return res.status(404).json({ 
        success: false,
        message: 'Address not found' 
      });
    }
    
    // Check if user owns this address
    if (address.user.toString() !== userId) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to delete this address' 
      });
    }

    
    await Address.findByIdAndDelete(id);
    
    res.json({ 
      success: true,
      message: 'Address deleted successfully' 
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid address ID'
      });
    }
    next(err);
  }
};