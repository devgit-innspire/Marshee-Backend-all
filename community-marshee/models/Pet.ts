import mongoose, { Document, Model, Schema } from "mongoose";

type PetGender = "Male" | "Female";
type PetType = "Dog" | "Cat" | "Bird" | "Rabbit" | "Other";
type PetAgeGroup = "Puppy" | "Adult" | "Senior";
type DietType = "Dry" | "Wet" | "Raw" | "Mixed";
type ExerciseLevel = "Low" | "Medium" | "High";
type TrainingLevel = "Beginner" | "Intermediate" | "Advanced";
type FurLength = "Short" | "Medium" | "Long";
type Temperament = "Calm" | "Playful" | "Aggressive" | "Shy" | "Friendly";
type SocializationLevel = "Low" | "Medium" | "High";
type LivingEnvironment = "Apartment" | "House" | "Farm";
type ClimateTolerance = "Hot" | "Cold" | "All";

interface IMedicalRecord {
  name?: string;
  date?: Date;
  nextDue?: Date;
}

interface IVetVisit {
  date?: Date;
  reason?: string;
  outcome?: string;
}

interface ILocation {
  type?: "Point";
  coordinates?: number[];
}

export interface IPet extends Document {
  name: string;
  birthday?: string;
  gender: PetGender;
  imageUrl?: string;
  breed?: string;
  weight?: number;
  healthConditions?: string;
  allergies?: string;
  type: PetType;
  ageGroup?: PetAgeGroup;
  height?: number;
  vaccinationRecords: IMedicalRecord[];
  dewormingRecords: IMedicalRecord[];
  microchipped: boolean;
  neutered: boolean;
  pastIllnesses: string[];
  currentMedications: string[];
  vetVisits: IVetVisit[];
  dietType?: DietType;
  feedingFrequency?: number;
  favoriteFoodBrands: string[];
  exerciseLevel?: ExerciseLevel;
  dailyActivityHours?: number;
  trainingLevel?: TrainingLevel;
  color?: string;
  coatPattern?: string;
  furLength?: FurLength;
  eyeColor?: string;
  purebred: boolean;
  parentBreeds: string[];
  temperament?: Temperament;
  socializationLevel?: SocializationLevel;
  livingEnvironment?: LivingEnvironment;
  favoriteActivities: string[];
  trainingNeeds?: string;
  location?: ILocation;
  climateTolerance?: ClimateTolerance;
  firebaseUID: string;
  owner?: mongoose.Types.ObjectId;
  coOwners: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const petSchema: Schema<IPet> = new Schema<IPet>({
  // Basic Information (from frontend form)
  name: {
    type: String,
    required: [true, "Please add a pet name"],
    trim: true,
  },
  birthday: {
    type: String, // Keep string to match frontend DD/MM/YYYY format
    trim: true,
  },
  gender: {
    type: String,
    enum: ["Male", "Female"],
    required: [true, "Gender is required"],
  },
  imageUrl: {
    type: String,
  },
  breed: {
    type: String,
    trim: true,
  },

  // Health & Medical
  weight: {
    type: Number,
    min: [0, "Weight cannot be negative"],
  },
  healthConditions: {
    type: String,
    trim: true,
    maxlength: [500, "Health conditions cannot be more than 500 characters"],
  },
  allergies: {
    type: String,
    trim: true,
    maxlength: [500, "Allergies description cannot be more than 500 characters"],
  },

  // Additional fields
  type: {
    type: String,
    enum: ["Dog", "Cat", "Bird", "Rabbit", "Other"],
    default: "Dog",
  },
  ageGroup: {
    type: String,
    enum: ["Puppy", "Adult", "Senior"],
  },
  height: Number,

  // Medical Records
  vaccinationRecords: [
    {
      name: String,
      date: Date,
      nextDue: Date,
    },
  ],
  dewormingRecords: [
    {
      name: String,
      date: Date,
      nextDue: Date,
    },
  ],
  microchipped: {
    type: Boolean,
    default: false,
  },
  neutered: {
    type: Boolean,
    default: false,
  },
  pastIllnesses: [String],
  currentMedications: [String],
  vetVisits: [
    {
      date: Date,
      reason: String,
      outcome: String,
    },
  ],

  // Nutrition & Lifestyle
  dietType: {
    type: String,
    enum: ["Dry", "Wet", "Raw", "Mixed"],
  },
  feedingFrequency: Number,
  favoriteFoodBrands: [String],
  exerciseLevel: {
    type: String,
    enum: ["Low", "Medium", "High"],
  },
  dailyActivityHours: Number,
  trainingLevel: {
    type: String,
    enum: ["Beginner", "Intermediate", "Advanced"],
  },

  // Breed & Genetics
  color: String,
  coatPattern: String,
  furLength: {
    type: String,
    enum: ["Short", "Medium", "Long"],
  },
  eyeColor: String,
  purebred: {
    type: Boolean,
    default: false,
  },
  parentBreeds: [String],

  // Behavior & Environment
  temperament: {
    type: String,
    enum: ["Calm", "Playful", "Aggressive", "Shy", "Friendly"],
  },
  socializationLevel: {
    type: String,
    enum: ["Low", "Medium", "High"],
  },
  livingEnvironment: {
    type: String,
    enum: ["Apartment", "House", "Farm"],
  },
  favoriteActivities: [String],
  trainingNeeds: String,

  // Location & Climate
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: "2dsphere",
    },
  },
  climateTolerance: {
    type: String,
    enum: ["Hot", "Cold", "All"],
  },

  // User Relations
  firebaseUID: {
    type: String,
    required: [true, "Firebase UID is required"],
    ref: "User",
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  coOwners: {
    type: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    validate: {
      validator: function (arr: mongoose.Types.ObjectId[]) {
        return !arr || arr.length <= 5;
      },
      message: "A pet can have at most 5 co-owners",
    },
    default: [],
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
petSchema.pre<IPet>("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for pet age calculation
petSchema.virtual("age").get(function (this: IPet) {
  if (!this.birthday) return null;

  const [day, month, year] = this.birthday.split("/");
  if (!day || !month || !year) return null;

  const birthDate = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
});

petSchema.set("toJSON", { virtuals: true });

const Pet: Model<IPet> = mongoose.models.Pet || mongoose.model<IPet>("Pet", petSchema);

export default Pet;
