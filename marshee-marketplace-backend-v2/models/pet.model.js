const mongoose = require('mongoose');

const petSchema = new mongoose.Schema({
  // Basic Information (from frontend form)
  name: {
    type: String,
    required: [true, 'Please add a pet name'],
    trim: true,
  },
  birthday: {
    type: String, // Changed to String to match frontend DD/MM/YYYY format
    trim: true,
  },
  gender: {
    type: String,
    enum: ['Male', 'Female'],
    required: [true, 'Gender is required'],
  },
  imageUrl: {
    type: String,
  },
  breed: {
    type: String,
    trim: true,
  },
  
  // Health & Medical (from frontend form)
  weight: {
    type: Number,
    min: [0, 'Weight cannot be negative']
  },
  healthConditions: {
    type: String,
    trim: true,
    maxlength: [500, 'Health conditions cannot be more than 500 characters']
  },
  allergies: { // Changed from known_allergies to match frontend
    type: String,
    trim: true,
    maxlength: [500, 'Allergies description cannot be more than 500 characters']
  },

  // Additional fields for future use
  type: {
    type: String,
    enum: ['Dog', 'Cat', 'Bird', 'Rabbit', 'Other'],
    default: 'Dog' // Since your app is dog-focused
  },
  ageGroup: {
    type: String,
    enum: ['Puppy', 'Adult', 'Senior'],
  },
  height: Number,
  
  // Medical Records (for future features)
  vaccinationRecords: [{
    name: String,
    date: Date,
    nextDue: Date
  }],
  dewormingRecords: [{
    name: String,
    date: Date,
    nextDue: Date
  }],
  microchipped: {
    type: Boolean,
    default: false
  },
  neutered: {
    type: Boolean,
    default: false
  },
  pastIllnesses: [String],
  currentMedications: [String],
  vetVisits: [{
    date: Date,
    reason: String,
    outcome: String
  }],

  // Nutrition & Lifestyle (for future features)
  dietType: {
    type: String,
    enum: ['Dry', 'Wet', 'Raw', 'Mixed']
  },
  feedingFrequency: Number,
  favoriteFoodBrands: [String],
  exerciseLevel: {
    type: String,
    enum: ['Low', 'Medium', 'High']
  },
  dailyActivityHours: Number,
  trainingLevel: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced']
  },

  // Breed & Genetics (for future features)
  color: String,
  coatPattern: String,
  furLength: {
    type: String,
    enum: ['Short', 'Medium', 'Long']
  },
  eyeColor: String,
  purebred: {
    type: Boolean,
    default: false
  },
  parentBreeds: [String],

  // Behavior & Environment (for future features)
  temperament: {
    type: String,
    enum: ['Calm', 'Playful', 'Aggressive', 'Shy', 'Friendly']
  },
  socializationLevel: {
    type: String,
    enum: ['Low', 'Medium', 'High']
  },
  livingEnvironment: {
    type: String,
    enum: ['Apartment', 'House', 'Farm']
  },
  favoriteActivities: [String],
  trainingNeeds: String,

  // Location & Climate (for future features)
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  climateTolerance: {
    type: String,
    enum: ['Hot', 'Cold', 'All']
  },

  // User Relations
  firebaseUID: {
    type: String,
    required: [true, 'Firebase UID is required'],
    ref: 'User'
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  coOwners: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    validate: {
      validator: function(arr) {
        return !arr || arr.length <= 5;
      },
      message: 'A pet can have at most 5 co-owners'
    },
    default: []
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
petSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for pet age calculation
petSchema.virtual('age').get(function() {
  if (!this.birthday) return null;
  
  // Parse DD/MM/YYYY format
  const [day, month, year] = this.birthday.split('/');
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
});

// Ensure virtual fields are serialized
petSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Pet', petSchema);
