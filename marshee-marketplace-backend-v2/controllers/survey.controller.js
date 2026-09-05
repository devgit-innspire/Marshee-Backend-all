const { StatusCodes } = require('http-status-codes');
const Survey = require('../models/survey.model');

/**
 * Submit a new survey
 */
exports.submitSurvey = async (req, res, next) => {
  try {
    const surveyData = req.body;

    console.log('Received survey data:', surveyData);
    
    // Basic validation for required fields
    if (!surveyData.firstName || !surveyData.email || !surveyData.phone) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'First name, email, and phone are required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(surveyData.email)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Create survey with all provided data
    const survey = await Survey.create({
      ...surveyData,
      submittedAt: new Date()
    });

    console.log('Survey saved successfully:', survey._id);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Survey submitted successfully',
      data: {
        surveyId: survey._id,
        submittedAt: survey.submittedAt,
        email: survey.email
      }
    });
  } catch (error) {
    console.error('Survey submission error:', error);

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
 * Get all surveys (with pagination and filtering)
 */
exports.getAllSurveys = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.email) {
      filter.email = req.query.email.toLowerCase().trim();
    }

    if (req.query.petType) {
      filter.petTypes = { $in: [req.query.petType] };
    }

    if (req.query.enrollBetaTesting) {
      filter.enrollBetaTesting = req.query.enrollBetaTesting;
    }

    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.submittedAt = {};
      if (req.query.startDate) {
        filter.submittedAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.submittedAt.$lte = new Date(req.query.endDate);
      }
    }

    const surveys = await Survey.find(filter)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await Survey.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        surveys,
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
    console.error('Error fetching surveys:', error);
    next(error);
  }
};

/**
 * Get survey by ID
 */
exports.getSurveyById = async (req, res, next) => {
  try {
    const survey = await Survey.findById(req.params.id).select('-__v');

    if (!survey) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Survey not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: survey
    });
  } catch (error) {
    console.error('Error fetching survey:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid survey ID'
      });
    }

    next(error);
  }
};

/**
 * Get survey analytics and statistics
 */
exports.getSurveyAnalytics = async (req, res, next) => {
  try {
    // Total surveys count
    const totalSurveys = await Survey.countDocuments();
    
    // Recent submissions (last 24 hours)
    const recentSubmissions = await Survey.countDocuments({
      submittedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    // Device interest statistics
    const deviceInterestStats = await Survey.aggregate([
      {
        $match: { interestInDevice: { $ne: '' } }
      },
      {
        $group: {
          _id: '$interestInDevice',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Most desired features
    const featureStats = await Survey.aggregate([
      { $unwind: '$desiredFeatures' },
      {
        $match: { desiredFeatures: { $ne: '' } }
      },
      {
        $group: {
          _id: '$desiredFeatures',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Pet types distribution
    const petTypeStats = await Survey.aggregate([
      { $unwind: '$petTypes' },
      {
        $match: { petTypes: { $ne: '' } }
      },
      {
        $group: {
          _id: '$petTypes',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Beta testing enrollment rate
    const betaTestingStats = await Survey.aggregate([
      {
        $match: { enrollBetaTesting: { $ne: '' } }
      },
      {
        $group: {
          _id: '$enrollBetaTesting',
          count: { $sum: 1 }
        }
      }
    ]);

    // Activity level importance distribution
    const activityImportanceStats = await Survey.aggregate([
      {
        $match: { activityLevelImportance: { $ne: '' } }
      },
      {
        $group: {
          _id: '$activityLevelImportance',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Average pricing perceptions
    const pricingStats = await Survey.aggregate([
      {
        $match: {
          prohibitivelyExpensivePrice: { $gt: 0 },
          greatBuyPrice: { $gt: 0 },
          stealPrice: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          avgProhibitivelyExpensive: { $avg: '$prohibitivelyExpensivePrice' },
          avgGreatBuy: { $avg: '$greatBuyPrice' },
          avgSteal: { $avg: '$stealPrice' },
          minProhibitivelyExpensive: { $min: '$prohibitivelyExpensivePrice' },
          maxProhibitivelyExpensive: { $max: '$prohibitivelyExpensivePrice' },
          minGreatBuy: { $min: '$greatBuyPrice' },
          maxGreatBuy: { $max: '$greatBuyPrice' }
        }
      }
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        overview: {
          totalSurveys,
          recentSubmissions
        },
        deviceInterest: deviceInterestStats,
        desiredFeatures: featureStats,
        petTypes: petTypeStats,
        betaTesting: betaTestingStats,
        activityImportance: activityImportanceStats,
        pricing: pricingStats[0] || {}
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    next(error);
  }
};

/**
 * Get surveys by email
 */
exports.getSurveysByEmail = async (req, res, next) => {
  try {
    const { email } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const surveys = await Survey.find({ email: email.toLowerCase() })
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await Survey.countDocuments({ email: email.toLowerCase() });
    const totalPages = Math.ceil(total / limit);

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        surveys,
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
    console.error('Error fetching surveys by email:', error);
    next(error);
  }
};

/**
 * Update survey by ID
 */
exports.updateSurvey = async (req, res, next) => {
  try {
    const survey = await Survey.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).select('-__v');

    if (!survey) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Survey not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Survey updated successfully',
      data: survey
    });
  } catch (error) {
    console.error('Error updating survey:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid survey ID'
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
 * Delete survey by ID
 */
exports.deleteSurvey = async (req, res, next) => {
  try {
    const survey = await Survey.findByIdAndDelete(req.params.id);

    if (!survey) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Survey not found'
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Survey deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting survey:', error);
    
    if (error.name === 'CastError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid survey ID'
      });
    }

    next(error);
  }
};
