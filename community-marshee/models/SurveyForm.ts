import mongoose, { Schema, Document } from 'mongoose';
import { surveyConnection } from '../config/surveyDB';

export interface ISurvey {
  // Personal Information
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  cityCountry?: string;

  // Pet Information
  petTypes?: string[];
  numberOfPets?: number;

  // Personal Statements
  personalStatements?: string[];
  petStatements?: string[];

  // Walking Habits
  walkFrequency?: string;
  walkReasons?: string[];
  walkDoneBy?: string;

  // Pet Concerns & Health
  topConcerns?: string[];
  isMicrochipped?: string;
  oldestPetAgeMonths?: number;
  activityLevelImportance?: string;
  wearsCollar?: string;

  // Device Information
  mobileDevice?: string;
  usesActivityDevice?: string;
  whichDevice?: string;
  interestInDevice?: string;

  // Device Features
  desiredFeatures?: string[];

  // Pricing
  prohibitivelyExpensivePrice?: number;
  greatBuyPrice?: number;
  stealPrice?: number;

  // Pain Points
  painPoints?: string[];

  // Blood Group Knowledge
  knowsBloodGroup?: string;

  // Blood Donation Opinions
  bloodDonationOpinions?: string[];

  // Beta Testing
  enrollBetaTesting?: string;

  // Additional Comments
  additionalComments?: string;

  // Timestamp
  submittedAt: Date;
}

export interface ISurveyDocument extends ISurvey, Document {}

const surveySchema = new Schema<ISurveyDocument>({
  // Personal Information
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    trim: true
  },
  cityCountry: {
    type: String,
    trim: true,
    default: ''
  },

  // Pet Information
  petTypes: {
    type: [String],
    default: []
  },
  numberOfPets: {
    type: Number,
    default: 0
  },

  // Personal Statements
  personalStatements: {
    type: [String],
    default: []
  },

  // Pet Statements
  petStatements: {
    type: [String],
    default: []
  },

  // Walking Habits
  walkFrequency: {
    type: String,
    default: ''
  },
  walkReasons: {
    type: [String],
    default: []
  },
  walkDoneBy: {
    type: String,
    default: ''
  },

  // Pet Concerns & Health
  topConcerns: {
    type: [String],
    default: []
  },
  isMicrochipped: {
    type: String,
    default: ''
  },
  oldestPetAgeMonths: {
    type: Number,
    default: 0
  },
  activityLevelImportance: {
    type: String,
    default: ''
  },
  wearsCollar: {
    type: String,
    default: ''
  },

  // Device Information
  mobileDevice: {
    type: String,
    default: ''
  },
  usesActivityDevice: {
    type: String,
    default: ''
  },
  whichDevice: {
    type: String,
    default: ''
  },
  interestInDevice: {
    type: String,
    default: ''
  },

  // Device Features
  desiredFeatures: {
    type: [String],
    default: []
  },

  // Pricing
  prohibitivelyExpensivePrice: {
    type: Number,
    default: 0
  },
  greatBuyPrice: {
    type: Number,
    default: 0
  },
  stealPrice: {
    type: Number,
    default: 0
  },

  // Pain Points
  painPoints: {
    type: [String],
    default: []
  },

  // Blood Group Knowledge
  knowsBloodGroup: {
    type: String,
    default: ''
  },

  // Blood Donation Opinions
  bloodDonationOpinions: {
    type: [String],
    default: []
  },

  // Beta Testing
  enrollBetaTesting: {
    type: String,
    default: ''
  },

  // Additional Comments
  additionalComments: {
    type: String,
    default: ''
  },

  // Timestamp
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, {
  // Include this to ensure we get virtuals when converting to JSON
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better query performance
surveySchema.index({ email: 1, submittedAt: -1 });
surveySchema.index({ submittedAt: -1 });

// Virtual for formatted submission date
surveySchema.virtual('submittedDate').get(function() {
  return this.submittedAt.toLocaleDateString();
});

// Virtual for formatted submission time
surveySchema.virtual('submittedTime').get(function() {
  return this.submittedAt.toLocaleTimeString();
});

// export const Survey = surveyConnection.model<ISurveyDocument>('Survey', surveySchema);


export const Survey = surveyConnection.model<ISurveyDocument>(
  'Survey',
  surveySchema
);