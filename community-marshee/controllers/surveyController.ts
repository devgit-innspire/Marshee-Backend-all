import { Request, Response } from 'express';
import { Survey, ISurvey } from '../models/SurveyForm';
import { AuthRequest } from '../middlewares/auth';
import User from '../models/User';

interface TypedRequest<T> extends Request {
  body: T;
}

/** Only users with role "admin" can list/view/delete surveys. */
const checkAdmin = async (userId: string): Promise<boolean> => {
  const user = await User.findById(userId);
  return user?.role === 'admin';
};

/**
 * Submit a new survey
 */
export const submitSurvey = async (
  req: TypedRequest<ISurvey>,
  res: Response
): Promise<void> => {
  try {
    const surveyData: ISurvey = req.body;

    console.log('Received survey data:', surveyData);
    
    // Basic validation for required fields
    if (!surveyData.firstName || !surveyData.email || !surveyData.phone) {
      res.status(400).json({
        success: false,
        error: 'First name, email, and phone are required fields'
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(surveyData.email)) {
      res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
      return;
    }

    // Create survey with all provided data
    const survey = new Survey(surveyData);
    console.log('Saving survey to database:', survey);
    await survey.save();

    res.status(201).json({
      success: true,
      message: 'Survey submitted successfully',
      data: {
        surveyId: survey._id,
        submittedAt: survey.submittedAt,
        email: survey.email
      }
    });
  } catch (error: any) {
    console.error('Survey submission error:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Get all surveys (with pagination and filtering). Admin only.
 */
export const getAllSurveys = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId || !(await checkAdmin(currentUserId))) {
      res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.',
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter: any = {};
    
    if (req.query.email) {
      filter.email = req.query.email;
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
        filter.submittedAt.$gte = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        filter.submittedAt.$lte = new Date(req.query.endDate as string);
      }
    }

    const surveys = await Survey.find(filter)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    const total = await Survey.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
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
  } catch (error: any) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch surveys'
    });
  }
};

/**
 * Get survey by ID. Admin only.
 */
export const getSurveyById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId || !(await checkAdmin(currentUserId))) {
      res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.',
      });
      return;
    }

    const survey = await Survey.findById(req.params.id).select('-__v');

    if (!survey) {
      res.status(404).json({
        success: false,
        error: 'Survey not found'
      });
      return;
    }

    res.json({
      success: true,
      data: survey
    });
  } catch (error: any) {
    console.error('Error fetching survey:', error);
    
    if (error.name === 'CastError') {
      res.status(400).json({
        success: false,
        error: 'Invalid survey ID'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch survey'
    });
  }
};

/**
 * Get survey analytics and statistics. Admin only.
 */
export const getSurveyAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId || !(await checkAdmin(currentUserId))) {
      res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.',
      });
      return;
    }

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

    res.json({
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
  } catch (error: any) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
};

/**
 * Update survey by ID
 */
export const updateSurvey = async (req: Request, res: Response): Promise<void> => {
  try {
    const survey = await Survey.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).select('-__v');

    if (!survey) {
      res.status(404).json({
        success: false,
        error: 'Survey not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Survey updated successfully',
      data: survey
    });
  } catch (error: any) {
    console.error('Error updating survey:', error);
    
    if (error.name === 'CastError') {
      res.status(400).json({
        success: false,
        error: 'Invalid survey ID'
      });
      return;
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update survey'
    });
  }
};

/**
 * Delete survey by ID. Admin only.
 */
export const deleteSurvey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId || !(await checkAdmin(currentUserId))) {
      res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.',
      });
      return;
    }

    const survey = await Survey.findByIdAndDelete(req.params.id);

    if (!survey) {
      res.status(404).json({
        success: false,
        error: 'Survey not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Survey deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting survey:', error);
    
    if (error.name === 'CastError') {
      res.status(400).json({
        success: false,
        error: 'Invalid survey ID'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete survey'
    });
  }
};