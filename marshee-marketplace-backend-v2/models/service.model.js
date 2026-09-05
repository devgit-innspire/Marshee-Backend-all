const mongoose = require("mongoose");
const { Schema, model } = mongoose;

/**
 * Canonical serviceType values used across the app.
 * Keep this list in sync with your frontend + validation.
 */
const SERVICE_TYPES = [
  "stem-cell", "relocation", "genetic-testing", "insurance",
  "training", "boarding", "walking", "pet-nutritionist", "pet-communicator", "pet-cake", "other"
];

/* -------------------------
   Reusable sub-schemas
   ------------------------- */
const PartnerSchema = new Schema({
  name: { type: String, required: true },
  partnerId: { type: Schema.Types.ObjectId, ref: "Partner" }, // optional reference
  website: { type: String },
  phone: { type: String },
  email: { type: String }
}, { _id: false });

const PricingSchema = new Schema({
  mrp: { type: Number, required: true, min: 0 },          // maximum retail price
  listPrice: { type: Number, required: true, min: 0 },    // selling price
  currency: { type: String, default: "INR" },
  billingUnit: { type: String, enum: ["per-session","per-day","per-month","one-time", "per-year", "per-10-sessions"], default: "one-time" },
  cleaningFee: { type: Number, default: 0 },
  extraPerAdditional: { type: Number, default: 0 }        // e.g., extra dog fee
}, { _id: false });

const LocationSchema = new Schema({
  addressLine1: { type: String },
  addressLine2: { type: String },
  city: { type: String, index: true },
  state: { type: String },
  postalCode: { type: String, index: true },
  country: { type: String, default: "India" },
  // GeoJSON point: [lng, lat]
  // location: {
  //   type: { type: String, enum: ["Point"], default: "Point" },
  //   coordinates: {
  //     type: [Number],
  //     validate: {
  //       validator: v => Array.isArray(v) ? v.length === 2 : false,
  //       message: "location.coordinates must be [lng, lat]"
  //     }
  //   }
  // }
}, { _id: false });

const ExtraSchema = new Schema({
  code: { type: String },
  name: { type: String },
  description: { type: String },
  price: { type: Number, min: 0 }
}, { _id: false });

const RelocationFareRulePricingSchema = new Schema({
  mrp: { type: Number, required: true, min: 0 },
  listPrice: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "INR" },
  billingUnit: { type: String, default: "one-time" }
}, { _id: false });

const RelocationFareRuleSchema = new Schema({
  code: { type: String, trim: true, lowercase: true },
  fromCity: { type: String, trim: true, lowercase: true }, // exact city match when provided
  toCity: { type: String, trim: true, lowercase: true },   // exact city match when provided
  routeKey: { type: String, trim: true, lowercase: true }, // optional "delhi->mumbai"
  travelMode: { type: String, enum: ["road", "train", "air", "multimodal"] },
  petType: { type: String, enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"] },
  minDistanceKm: { type: Number, min: 0 },
  maxDistanceKm: { type: Number, min: 0 },
  pricing: { type: RelocationFareRulePricingSchema, required: true },
  perAdditionalPetCharge: { type: Number, min: 0, default: 0 },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  notes: { type: String, trim: true }
}, { _id: false });

/* -------------------------
   Service-type specific subdocuments (optional)
   ------------------------- */
// Medical / Stem-cell
const MedicalSchema = new Schema({
  partnerName: String,
  clinicAddress: String,
  proceduresOffered: [String],
  requiresConsultation: { type: Boolean, default: true },
  minAgeMonths: Number,
  maxAgeYears: Number,
  notes: String
}, { _id: false });

// Relocation / Logistics
const RelocationSchema = new Schema({
  partnerName: { type: String, trim: true }, // legacy optional
  // Relocation is handled as an on-demand workflow.
  // Final amount is manually shared after reviewing pickup/drop details.
  pricingMode: {
    type: String,
    enum: ["on-demand", "dynamic"],
    default: "on-demand"
  },
  maxDistanceKm: { type: Number, min: 0 },
  serviceAreaType: {
    type: String,
    enum: ["local", "intercity", "international", "all"],
    default: "intercity"
  },
  supportedTravelModes: [{
    type: String,
    enum: ["road", "train", "air", "multimodal"]
  }],
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  pickupIncluded: { type: Boolean, default: true },
  dropoffIncluded: { type: Boolean, default: true },
  homePickupAvailable: { type: Boolean, default: true },
  homeDropoffAvailable: { type: Boolean, default: true },
  insuranceIncluded: { type: Boolean, default: false },
  documentationAssistance: { type: Boolean, default: false },
  crateSupportAvailable: { type: Boolean, default: false },
  vetClearanceSupport: { type: Boolean, default: false },
  liveTrackingAvailable: { type: Boolean, default: false },
  maxPetsPerBooking: { type: Number, min: 1, default: 1 },
  minLeadTimeHours: { type: Number, min: 0, default: 24 },
  extraCharges: { type: Number, default: 0 },
  // Optional legacy fields retained for backward compatibility.
  // Ignored when pricingMode = "on-demand".
  fareRules: [RelocationFareRuleSchema],
  fareConfig: {
    enableDynamicFare: { type: Boolean, default: false },
    chargePerAdditionalPet: { type: Number, min: 0, default: 0 },
    // Distance-based dynamic pricing fallback, used when no rule matches.
    // Final fare = baseFare + distanceKm * perKmRate[travelMode]
    baseFare: { type: Number, min: 0, default: 0 },
    perKmRate: {
      road: { type: Number, min: 0, default: 0 },
      train: { type: Number, min: 0, default: 0 },
      air: { type: Number, min: 0, default: 0 },
      multimodal: { type: Number, min: 0, default: 0 }
    },
    minFare: { type: Number, min: 0, default: 0 }
  },
  intakeForm: {
    petId: { type: Boolean, default: true },
    customPetDetails: { type: Boolean, default: true },
    fromCity: { type: Boolean, default: false },
    toCity: { type: Boolean, default: false },
    pickupDate: { type: Boolean, default: true },
    travelMode: { type: Boolean, default: true },
    documents: { type: Boolean, default: true },
    notes: { type: Boolean, default: true }
  }
}, { _id: false });

// Genetic / DNA testing
const GeneticSchema = new Schema({
  labName: { type: String, trim: true },
  testPanel: [{ type: String, trim: true }], // legacy flat list support
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  homeCollectionAvailable: { type: Boolean, default: false },
  turnaroundDays: { type: Number, min: 1 },
  requiresVetSample: { type: Boolean, default: false },
  reportDeliveryModes: [{
    type: String,
    enum: ["pdf", "email", "app", "printed"]
  }],
  consultationIncluded: { type: Boolean, default: false },
  labAccreditations: [{ type: String, trim: true }],
  intakeForm: {
    petId: { type: Boolean, default: true },
    customPetDetails: { type: Boolean, default: true },
    reportDeliveryMode: { type: Boolean, default: true },
    medicalHistory: { type: Boolean, default: true },
    notes: { type: Boolean, default: true }
  }
}, { _id: false });

// Insurance
// Note: this schema only models fields that MUST live on the server
// (core policy metadata, plan catalog, coverage/eligibility rules,
// vaccination gating, claim steps). Marketing text (faq, tips, whyChoose,
// benefits list, claim notification windows, stats copy) is intentionally
// omitted – those are rendered on the frontend from static config/CMS.
const InsurancePlanSchema = new Schema({
  code: { type: String, trim: true, lowercase: true }, // e.g. "comprehensive", "make-your-own", "third-party"
  name: { type: String, trim: true, required: true },
  description: { type: String, trim: true },
  features: [{ type: String, trim: true }],
  price: { type: Number, min: 0, default: 0 },
  taxLabel: { type: String, trim: true, default: '+ taxes' },
  isRecommended: { type: Boolean, default: false },
  startingFrom: { type: Boolean, default: false },
  sumInsuredLabel: { type: String, trim: true },
  coPayLabel: { type: String, trim: true },
  opdCoverLabel: { type: String, trim: true },
  customizationHint: { type: String, trim: true }
}, { _id: false });

const InsuranceSchema = new Schema({
  // Core policy metadata
  providerName: { type: String, trim: true, required: true },
  planName: { type: String, trim: true },
  premium: { type: Number, min: 0, default: 0 },
  tenureMonths: { type: Number, min: 1, default: 12 },
  waitingPeriod: { type: String, trim: true },
  claimProcess: { type: String, trim: true },
  exclusions: { type: String, trim: true },

  // Restrict insurance services to dogs & cats only
  petTypes: [{
    type: String,
    enum: ["dog", "cat"],
    lowercase: true,
    trim: true
  }],

  // Plan catalog (comprehensive / make your own / third party liability / etc.)
  plans: [InsurancePlanSchema],

  // Coverage rules (server-owned – used to decide eligibility/claims)
  coverage: {
    covered: [{
      title: { type: String, trim: true },
      description: { type: String, trim: true }
    }],
    notCovered: [{
      title: { type: String, trim: true },
      description: { type: String, trim: true }
    }]
  },

  // Eligibility gating
  eligibility: {
    minimumAgeMonths: { type: Number, min: 0, default: 6 },
    maximumEntryAgeYears: { type: Number, min: 0, default: 5 },
    maximumRenewalAgeYears: { type: Number, min: 0, default: 8 },
    minimumVaccinesRequired: { type: Number, min: 0, default: 3 },
    requiredVaccines: [{ type: String, trim: true }] // e.g. ["Rabies","Distemper",...]
  },

  // Required intake fields for booking (drives which booking screens show which inputs)
  intakeForm: {
    petDetails: { type: Boolean, default: true },
    petPhotos: { type: Boolean, default: true },
    vaccinationDiscount: { type: Boolean, default: true },
    kycPan: { type: Boolean, default: true },
    ownerAddress: { type: Boolean, default: true },
    ownerContact: { type: Boolean, default: true },
    gstinEia: { type: Boolean, default: false },
    existingCustomer: { type: Boolean, default: true },
    previousInsurance: { type: Boolean, default: true }
  },

  // Claim workflow
  claimSteps: [{
    stepNumber: { type: Number, min: 1 },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    contactInfo: { type: String, trim: true, default: null }
  }],

  // Minimal trust-signal stats (optional – only the numeric rating is server truth)
  stats: {
    customerRatings: { type: Number, min: 0, max: 5, default: null }
  }
}, { _id: false });

// Training
const TrainingPackagePricingSchema = new Schema({
  mrp: { type: Number, required: true, min: 0 },
  listPrice: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "INR" },
  billingUnit: {
    type: String,
    enum: ["per-session", "per-day", "per-month", "one-time", "per-year", "per-10-sessions"],
    default: "one-time"
  }
}, { _id: false });

const TrainingPackageSchema = new Schema({
  code: { type: String, required: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  sessionsCount: { type: Number, min: 0 },
  isActive: { type: Boolean, default: true },
  pricing: { type: TrainingPackagePricingSchema, required: true }
}, { _id: false });

const TrainingSchema = new Schema({
  programName: String,
  level: { type: String, enum: ["Beginner","Intermediate","Advanced"] },
  durationInDays: Number,
  sessionsPerWeek: Number,
  sessionDurationMinutes: Number,
  groupOrPrivate: { type: String, enum: ["group","private"], default: "group" },
  trainerName: String,
  certificationProvided: { type: Boolean, default: false },
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  trainingModes: [{
    type: String,
    enum: ["in-person", "online", "home-visit", "board-and-train", "hybrid"]
  }],
  behaviorFocusAreas: [{ type: String, trim: true }],
  intakeForm: {
    petId: { type: Boolean, default: true },
    customPetDetails: { type: Boolean, default: true },
    preferredStartDate: { type: Boolean, default: true },
    preferredTimeSlot: { type: Boolean, default: true },
    goals: { type: Boolean, default: true },
    behaviorConcerns: { type: Boolean, default: true }
  },
  packages: [TrainingPackageSchema],
  notes: String
}, { _id: false });

// Boarding
const BoardingSchema = new Schema({
  maxDogs: { type: Number, default: 4 },
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  acceptsUnneuteredPets: { type: Boolean, default: true },
  vaccinationRequired: { type: Boolean, default: true },
  roomType: { type: String, enum: ["Home","Kennel","Private","Shared"], default: "Home" },
  cageFree: { type: Boolean, default: true },
  cctv: { type: Boolean, default: false },
  outdoorPlayArea: { type: Boolean, default: false },
  walksPerDay: { type: Number, default: 2 },
  feedingIncluded: { type: Boolean, default: true },
  dropOffWindow: {
    start: { type: String, trim: true }, // "09:00"
    end: { type: String, trim: true }
  },
  pickUpWindow: {
    start: { type: String, trim: true },
    end: { type: String, trim: true }
  },
  intakeForm: {
    petId: { type: Boolean, default: true },
    customPetDetails: { type: Boolean, default: true },
    checkInDate: { type: Boolean, default: true },
    checkOutDate: { type: Boolean, default: true },
    transportRequired: { type: Boolean, default: true },
    careInstructions: { type: Boolean, default: true }
  }
}, { _id: false });

// Walking
const WalkingSchema = new Schema({
  workerName: String,
  walkDurationMinutes: { type: Number, default: 30 },
  maxDogsPerWalk: { type: Number, default: 3 },
  routeDescription: String,
  frequencyOptions: [{ type: String, enum: ["one-time","daily","weekly"] }]
}, { _id: false });

// Pet Nutritionist (legacy weekday availability)
const AvailabilitySlotSchema = new Schema({
  day: {
    type: String,
    enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    required: true,
    lowercase: true,
    trim: true
  },
  startTime: { type: String, required: true, trim: true }, // "10:00"
  endTime: { type: String, required: true, trim: true },   // "13:00"
  sessionDurationMinutes: { type: Number, min: 15, default: 45 },
  isAvailable: { type: Boolean, default: true }
}, { _id: false });

// Calendar based slots for booking real dates + times from frontend
const CalendarAvailabilitySlotSchema = new Schema({
  date: { type: Date, required: true },
  startTime: { type: String, required: true, trim: true }, // "10:00"
  endTime: { type: String, required: true, trim: true },   // "10:45"
  timezone: { type: String, default: "Asia/Kolkata", trim: true },
  consultationType: {
    type: String,
    enum: ["chat", "video", "call", "in-person"],
    default: "video"
  },
  sessionDurationMinutes: { type: Number, min: 15, default: 45 },
  maxBookings: { type: Number, min: 1, default: 1 },
  bookedCount: { type: Number, min: 0, default: 0 },
  isAvailable: { type: Boolean, default: true }
}, { _id: false });

const NutritionistExpertSchema = new Schema({
  name: { type: String, trim: true, required: true },
  image: { type: String, trim: true }, // expert profile image URL
  title: { type: String, trim: true }, // e.g. "Pet Nutrition Specialist"
  yearsOfExperience: { type: Number, min: 0, default: 0 },
  isVerifiedExpert: { type: Boolean, default: false },
  qualifications: [{ type: String, trim: true }],
  languages: [{ type: String, trim: true }],
  consultationTypes: [{
    type: String,
    enum: ["chat", "video", "call", "in-person"]
  }],
  specializations: [{ type: String, trim: true }],
  bio: { type: String, trim: true },
  methodology: { type: String, trim: true },
  weeklyAvailability: [AvailabilitySlotSchema],
  calendarAvailability: [CalendarAvailabilitySlotSchema],
  rating: { type: Number, min: 0, max: 5 },
  totalReviews: { type: Number, min: 0, default: 0 },
  totalConsultations: { type: Number, min: 0, default: 0 }
}, { _id: false });

const NutritionistSchema = new Schema({
  // Legacy single-expert fields kept for backwards compatibility
  expertName: { type: String, trim: true },
  expertTitle: { type: String, trim: true }, // e.g. "Pet Nutrition Specialist"
  yearsOfExperience: { type: Number, min: 0, default: 0 },
  isVerifiedExpert: { type: Boolean, default: false },
  qualifications: [{ type: String, trim: true }],
  languages: [{ type: String, trim: true }],
  consultationTypes: [{
    type: String,
    enum: ["chat", "video", "call", "in-person"]
  }],
  specializations: [{ type: String, trim: true }], // e.g. allergies, weight management
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  activityLevelsSupported: [{
    type: String,
    enum: ["low", "moderate", "high", "all"]
  }],
  dietTypesSupported: [{
    type: String,
    enum: ["dry", "wet", "homemade", "mixed", "raw", "all"]
  }],
  maxPetsPerSession: { type: Number, min: 1, default: 1 },
  followUpIncluded: { type: Boolean, default: true },
  followUpWindowDays: { type: Number, min: 0, default: 7 },
  availability: [AvailabilitySlotSchema], // legacy weekly availability
  calendarAvailability: [CalendarAvailabilitySlotSchema], // preferred date+time slots
  experts: [NutritionistExpertSchema], // preferred for multi-expert use-cases
  // Field map to match frontend intake flow for pet nutrition booking forms
  intakeForm: {
    petInformation: { type: Boolean, default: true },
    petBreeds: { type: Boolean, default: true },
    petAgeYears: { type: Boolean, default: true },
    petAgeMonths: { type: Boolean, default: true },
    petWeight: { type: Boolean, default: true },
    petActiveness: { type: Boolean, default: true },
    currentDiet: { type: Boolean, default: true },
    healthAllergies: { type: Boolean, default: true },
    medicalConditions: { type: Boolean, default: true },
    expectedImprovements: { type: Boolean, default: true },
    notes: { type: Boolean, default: true }
  },
  rating: { type: Number, min: 0, max: 5 },
  totalReviews: { type: Number, min: 0, default: 0 },
  totalConsultations: { type: Number, min: 0, default: 0 },
  bio: { type: String, trim: true },
  methodology: { type: String, trim: true },
  notes: { type: String, trim: true }
}, { _id: false });

// Pet Communicator
const PetCommunicatorExpertSchema = new Schema({
  name: { type: String, trim: true, required: true },
  image: { type: String, trim: true, required: true },
  title: { type: String, trim: true }, // e.g. "Animal Behavior Expert"
  yearsOfExperience: { type: Number, min: 0, default: 0 },
  isVerifiedExpert: { type: Boolean, default: false },
  qualifications: [{ type: String, trim: true }],
  languages: [{ type: String, trim: true }],
  consultationTypes: [{
    type: String,
    enum: ["chat", "video", "call", "in-person"]
  }],
  communicationStyles: [{ type: String, trim: true }], // intuitive, behavior-focused etc.
  specializations: [{ type: String, trim: true }],
  bio: { type: String, trim: true },
  methodology: { type: String, trim: true },
  weeklyAvailability: [AvailabilitySlotSchema],
  calendarAvailability: [CalendarAvailabilitySlotSchema],
  rating: { type: Number, min: 0, max: 5 },
  totalReviews: { type: Number, min: 0, default: 0 },
  totalSessions: { type: Number, min: 0, default: 0 }
}, { _id: false });

const PetCommunicatorSchema = new Schema({
  // Legacy single-expert fields kept for backwards compatibility
  expertName: { type: String, trim: true },
  expertTitle: { type: String, trim: true },
  yearsOfExperience: { type: Number, min: 0, default: 0 },
  isVerifiedExpert: { type: Boolean, default: false },
  qualifications: [{ type: String, trim: true }],
  languages: [{ type: String, trim: true }],
  consultationTypes: [{
    type: String,
    enum: ["chat", "video", "call", "in-person"]
  }],
  communicationStyles: [{ type: String, trim: true }],
  specializations: [{ type: String, trim: true }],
  petTypesSupported: [{
    type: String,
    enum: ["dog", "cat", "bird", "rabbit", "small-pet", "all"]
  }],
  concernsSupported: [{ type: String, trim: true }],
  maxPetsPerSession: { type: Number, min: 1, default: 1 },
  followUpIncluded: { type: Boolean, default: true },
  followUpWindowDays: { type: Number, min: 0, default: 7 },
  availability: [AvailabilitySlotSchema],
  calendarAvailability: [CalendarAvailabilitySlotSchema],
  experts: [PetCommunicatorExpertSchema],
  intakeForm: {
    petId: { type: Boolean, default: true },
    concerns: { type: Boolean, default: true },
    notes: { type: Boolean, default: true }
  },
  rating: { type: Number, min: 0, max: 5 },
  totalReviews: { type: Number, min: 0, default: 0 },
  totalSessions: { type: Number, min: 0, default: 0 },
  bio: { type: String, trim: true },
  methodology: { type: String, trim: true },
  notes: { type: String, trim: true }
}, { _id: false });

// Pet Cake
const PetCakeIngredientOptionSchema = new Schema({
  id: { type: String, trim: true },
  name: { type: String, trim: true, required: true },
  subtitle: { type: String, trim: true },
  image: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
  additionalPrice: { type: Number, min: 0, default: 0 }
}, { _id: false });

const PetCakeIngredientSectionSchema = new Schema({
  id: { type: String, trim: true },
  title: { type: String, trim: true, required: true }, // Protein Selection, The Base, Flavour Profile
  selectionType: { type: String, enum: ["single", "multiple"], default: "single" },
  options: [PetCakeIngredientOptionSchema]
}, { _id: false });

const PetCakeCustomizationOptionSchema = new Schema({
  id: { type: String, trim: true },
  name: { type: String, trim: true, required: true },
  value: { type: String, trim: true },
  subtitle: { type: String, trim: true },
  image: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
  additionalPrice: { type: Number, min: 0, default: 0 }
}, { _id: false });

const PetCakeCustomizationFieldSchema = new Schema({
  id: { type: String, trim: true },
  title: { type: String, trim: true, required: true },
  subtitle: { type: String, trim: true },
  inputType: { type: String, enum: ["single", "multiple", "dropdown", "text"], default: "single" },
  isRequired: { type: Boolean, default: false },
  placeholder: { type: String, trim: true },
  minSelections: { type: Number, min: 0, default: 0 },
  maxSelections: { type: Number, min: 0 },
  options: [PetCakeCustomizationOptionSchema]
}, { _id: false });

const PetCakeTypeSchema = new Schema({
  id: { type: String, trim: true },
  name: { type: String, trim: true, required: true },
  description: { type: String, trim: true },
  image: { type: String, trim: true },
  isPopular: { type: Boolean, default: false }
}, { _id: false });

const PetCakePerkSchema = new Schema({
  title: { type: String, trim: true },
  description: { type: String, trim: true },
  icon: { type: String, trim: true }
}, { _id: false });

const PetCakeSchema = new Schema({
  // First screen
  heroTitle: { type: String, trim: true, default: "Create a Custom Cake for Your Pet" },
  heroSubtitle: { type: String, trim: true, default: "Create Custom Cake For Your Pet" },

  // Second screen
  cakeTypes: [PetCakeTypeSchema],

  // Third/Fourth screen
  ingredientSections: [PetCakeIngredientSectionSchema],
  sizeOptions: [{ type: String, trim: true }],   // Small, Medium, Large
  shapeOptions: [{ type: String, trim: true }],  // Round, Pot, Heart
  themeStyles: [{ type: String, trim: true }],   // Classic, Festive, Minimal
  customizationFields: [PetCakeCustomizationFieldSchema],

  // Explicit blocks for current pet-cake customizer screens
  baseFrostingColourOptions: [PetCakeCustomizationOptionSchema],
  fondantDetailingColourOptions: [PetCakeCustomizationOptionSchema],
  allergiesOrPreferencesOptions: [PetCakeCustomizationOptionSchema],
  fillingOptions: [PetCakeCustomizationOptionSchema],
  cookiesAroundCakeOptions: [PetCakeCustomizationOptionSchema],
  signature3DDoggieCakeTopperOptions: [PetCakeCustomizationOptionSchema],
  happyBirthdayPetNameTextOptions: [PetCakeCustomizationOptionSchema],
  addOnOptions: [PetCakeCustomizationOptionSchema],

  // Home screen extras
  standards: [PetCakePerkSchema],
  benefits: [PetCakePerkSchema],
  promotions: [PetCakePerkSchema],

  notes: { type: String, trim: true }
}, { _id: false });

/* -------------------------
   Main flexible service schema
   ------------------------- */
const serviceSchema = new Schema({
  // Core search / filterable fields (keep these top-level)
  name: { type: String, required: true, index: true },
  slug: { type: String, index: true },
  shortDescription: { type: String, maxlength: 250 },
  longDescription: { type: String },
  serviceType: { type: String, required: true, enum: SERVICE_TYPES, index: true },
  category: { type: String, index: true },           // user-facing category tag (Boarding, Medical, etc.)
  partner: { type: PartnerSchema, required: true },  // provider details
  pricing: { type: PricingSchema, required: true },  // keep pricing top-level for easy queries
  durationInMinutes: { type: Number },
  isActive: { type: Boolean, default: true, index: true },
  images: [{ type: String }],
  extras: [ExtraSchema],
  tags: [{ type: String, index: true }],
  locationInfo: LocationSchema,   // optional for services with physical location
  
  // typed optional containers (use whichever fits the serviceType)
  medical: MedicalSchema,
  relocation: RelocationSchema,
  genetic: GeneticSchema,
  insurance: InsuranceSchema,
  training: TrainingSchema,
  boarding: BoardingSchema,
  walking: WalkingSchema,
  nutritionist: NutritionistSchema,
  communicator: PetCommunicatorSchema,
  cake: PetCakeSchema,
  
  // catch-all for any other fields or partner-specific metadata
  details: { type: Schema.Types.Mixed, default: {} },
  
  // admin/trust metadata
  isVerified: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  notes: String
}, { timestamps: true });

// Nutritionist payload normalization for old/new client compatibility
serviceSchema.pre("validate", function(next) {
  if (this.serviceType !== "pet-nutritionist" || !this.nutritionist) return next();

  // Promote legacy single expert into new experts[] format
  if ((!this.nutritionist.experts || this.nutritionist.experts.length === 0) && this.nutritionist.expertName) {
    this.nutritionist.experts = [{
      name: this.nutritionist.expertName,
      title: this.nutritionist.expertTitle,
      yearsOfExperience: this.nutritionist.yearsOfExperience,
      isVerifiedExpert: this.nutritionist.isVerifiedExpert,
      qualifications: this.nutritionist.qualifications,
      languages: this.nutritionist.languages,
      consultationTypes: this.nutritionist.consultationTypes,
      specializations: this.nutritionist.specializations,
      bio: this.nutritionist.bio,
      methodology: this.nutritionist.methodology,
      weeklyAvailability: this.nutritionist.availability,
      calendarAvailability: this.nutritionist.calendarAvailability,
      rating: this.nutritionist.rating,
      totalReviews: this.nutritionist.totalReviews,
      totalConsultations: this.nutritionist.totalConsultations
    }];
  }

  // Keep legacy expertName populated from experts[] for older clients
  if (!this.nutritionist.expertName && this.nutritionist.experts && this.nutritionist.experts.length > 0) {
    this.nutritionist.expertName = this.nutritionist.experts[0].name;
  }

  next();
});

// Pet communicator payload normalization for old/new client compatibility
serviceSchema.pre("validate", function(next) {
  if (this.serviceType !== "pet-communicator" || !this.communicator) return next();

  // Promote legacy single expert into new experts[] format
  if ((!this.communicator.experts || this.communicator.experts.length === 0) && this.communicator.expertName) {
    this.communicator.experts = [{
      name: this.communicator.expertName,
      title: this.communicator.expertTitle,
      yearsOfExperience: this.communicator.yearsOfExperience,
      isVerifiedExpert: this.communicator.isVerifiedExpert,
      qualifications: this.communicator.qualifications,
      languages: this.communicator.languages,
      consultationTypes: this.communicator.consultationTypes,
      communicationStyles: this.communicator.communicationStyles,
      specializations: this.communicator.specializations,
      bio: this.communicator.bio,
      methodology: this.communicator.methodology,
      weeklyAvailability: this.communicator.availability,
      calendarAvailability: this.communicator.calendarAvailability,
      rating: this.communicator.rating,
      totalReviews: this.communicator.totalReviews,
      totalSessions: this.communicator.totalSessions
    }];
  }

  // Keep legacy expertName populated from experts[] for older clients
  if (!this.communicator.expertName && this.communicator.experts && this.communicator.experts.length > 0) {
    this.communicator.expertName = this.communicator.experts[0].name;
  }

  next();
});

// Training package validation
serviceSchema.pre("validate", function(next) {
  if (this.serviceType !== "training") return next();

  const packages = Array.isArray(this.training?.packages) ? this.training.packages : [];
  if (packages.length === 0) {
    return next(new Error("training.packages must include at least one package for training services"));
  }

  const hasActivePackage = packages.some(pkg => pkg?.isActive !== false);
  if (!hasActivePackage) {
    return next(new Error("training.packages must include at least one active package"));
  }

  const seen = new Set();
  for (const pkg of packages) {
    const normalizedCode = String(pkg?.code || "").trim().toLowerCase();
    if (!normalizedCode) {
      return next(new Error("training.packages[].code is required"));
    }
    if (seen.has(normalizedCode)) {
      return next(new Error(`training.packages contains duplicate code: ${normalizedCode}`));
    }
    seen.add(normalizedCode);
  }

  return next();
});

/* -------------------------
   Indexes
   ------------------------- */
serviceSchema.index({ name: "text", shortDescription: "text", longDescription: "text" });
serviceSchema.index({ "locationInfo.location": "2dsphere" });

/* -------------------------
   Helpers / statics
   ------------------------- */
/**
 * Create a shallow normalized object of required fields for listing
 * (keeps API responses small)
 */
serviceSchema.methods.toListing = function() {
  return {
    id: this._id,
    name: this.name,
    slug: this.slug,
    shortDescription: this.shortDescription,
    serviceType: this.serviceType,
    category: this.category,
    partner: this.partner,
    pricing: this.pricing,
    isActive: this.isActive,
    images: this.images,
    tags: this.tags
  };
};

// Boarding booking payload for per-user subscriptions/orders
const BoardingOwnerSnapshotSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  fullName: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true }
}, { _id: false });

const BoardingPetBookingSchema = new Schema({
  petId: { type: Schema.Types.ObjectId, ref: "Pet" }, // Existing saved pet
  useCustomPetDetails: { type: Boolean, default: false },
  petType: { type: String, trim: true, default: "dog" },
  petName: { type: String, trim: true },
  breed: { type: String, trim: true },
  ageYears: { type: Number, min: 0 },
  ageMonths: { type: Number, min: 0, max: 11 },
  weightKg: { type: Number, min: 0 },
  gender: { type: String, enum: ["male", "female", "unknown"], default: "unknown" },
  isNeutered: { type: Boolean, default: false },
  vaccinationsUpToDate: { type: Boolean, default: false }
}, { _id: false });

const BoardingBookingSchema = new Schema({
  owner: { type: BoardingOwnerSnapshotSchema, required: true },
  stay: {
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    checkInTime: { type: String, trim: true }, // "14:30"
    checkOutTime: { type: String, trim: true },
    timezone: { type: String, trim: true, default: "Asia/Kolkata" }
  },
  pet: { type: BoardingPetBookingSchema, required: true },
  care: {
    feedingSchedule: { type: String, trim: true },
    medications: { type: String, trim: true },
    allergies: { type: String, trim: true },
    behaviorNotes: { type: String, trim: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },
    specialInstructions: { type: String, trim: true }
  },
  transport: {
    requiresPickup: { type: Boolean, default: false },
    requiresDropoff: { type: Boolean, default: false },
    pickupAddress: { type: String, trim: true },
    dropoffAddress: { type: String, trim: true }
  },
  status: {
    type: String,
    enum: ["draft", "requested", "confirmed", "cancelled", "completed"],
    default: "requested"
  }
}, { _id: false });

// Training booking payload for per-user subscriptions/orders
const TrainingOwnerSnapshotSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  fullName: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true }
}, { _id: false });

const TrainingPetBookingSchema = new Schema({
  petId: { type: Schema.Types.ObjectId, ref: "Pet" },
  useCustomPetDetails: { type: Boolean, default: false },
  petType: { type: String, trim: true, default: "dog" },
  petName: { type: String, trim: true },
  breed: { type: String, trim: true },
  ageYears: { type: Number, min: 0 },
  ageMonths: { type: Number, min: 0, max: 11 },
  weightKg: { type: Number, min: 0 }
}, { _id: false });

const TrainingBookingSchema = new Schema({
  owner: { type: TrainingOwnerSnapshotSchema, required: true },
  pet: { type: TrainingPetBookingSchema, required: true },
  schedule: {
    preferredStartDate: { type: Date },
    preferredEndDate: { type: Date },
    preferredTimeSlot: { type: String, trim: true }, // "07:00-08:00"
    timezone: { type: String, trim: true, default: "Asia/Kolkata" },
    sessionsPerWeek: { type: Number, min: 1 }
  },
  trainingPlan: {
    level: { type: String, enum: ["Beginner", "Intermediate", "Advanced"] },
    mode: { type: String, enum: ["in-person", "online", "home-visit", "board-and-train", "hybrid"] },
    goals: [{ type: String, trim: true }],
    behaviorConcerns: [{ type: String, trim: true }],
    priorTrainingHistory: { type: String, trim: true },
    specialInstructions: { type: String, trim: true }
  },
  status: {
    type: String,
    enum: ["draft", "requested", "confirmed", "cancelled", "completed"],
    default: "requested"
  }
}, { _id: false });

// Relocation booking payload for per-user subscriptions/orders
const RelocationOwnerSnapshotSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  fullName: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true }
}, { _id: false });

const RelocationPetBookingSchema = new Schema({
  petId: { type: Schema.Types.ObjectId, ref: "Pet" },
  useCustomPetDetails: { type: Boolean, default: false },
  petType: { type: String, trim: true, default: "dog" },
  petName: { type: String, trim: true },
  breed: { type: String, trim: true },
  ageYears: { type: Number, min: 0 },
  ageMonths: { type: Number, min: 0, max: 11 },
  weightKg: { type: Number, min: 0 }
}, { _id: false });

const RelocationBookingSchema = new Schema({
  owner: { type: RelocationOwnerSnapshotSchema, required: true },
  trip: {
    fromCity: { type: String, trim: true },
    toCity: { type: String, trim: true },
    pickupLocation: { type: String, trim: true },
    pickupCity: { type: String, trim: true },
    pickupPostalCode: { type: String, trim: true },
    dropLocation: { type: String, trim: true },
    dropCity: { type: String, trim: true },
    dropPostalCode: { type: String, trim: true },
    pickupDate: { type: Date },
    preferredPickupTime: { type: String, trim: true }, // "09:30"
    travelMode: { type: String, enum: ["road", "train", "air", "multimodal"], default: "road" }
  },
  pet: { type: RelocationPetBookingSchema, required: true },
  requirements: {
    crateRequired: { type: Boolean, default: false },
    insuranceRequired: { type: Boolean, default: false },
    documentsProvided: { type: Boolean, default: false },
    specialInstructions: { type: String, trim: true }
  },
  status: {
    type: String,
    enum: ["draft", "requested", "confirmed", "in-transit", "cancelled", "completed"],
    default: "requested"
  }
}, { _id: false });


// ==========================
// Subscription Schema
// ==========================
const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },

  // How user customizes the service
  quantity: { type: Number, default: 1 },                // number of sessions/items
  selectedTime: { type: Date },                          // booking time if scheduled
  frequency: {                                           // recurring or not
    type: String, 
    enum: ["one-time", "weekly", "monthly"], 
    default: "one-time" 
  },

  // Payment info
  paymentStatus: { 
    type: String, 
    enum: ["pending", "paid", "failed"], 
    default: "pending" 
  },
  paymentId: { type: String },                           // gateway transaction id
  amountPaid: { type: Number },                          // store final price

  // Lifecycle tracking
  status: { 
    type: String, 
    enum: ["pending", "active", "paused", "cancelled", "expired"], 
    default: "pending" 
  },
  startDate: { type: Date, default: Date.now },          // subscription start
  endDate: { type: Date },                               // subscription end

  // Pet nutrition booking payload
  nutritionBooking: {
    expertId: { type: String, trim: true },
    expertName: { type: String, trim: true },
    consultationType: { type: String, enum: ["chat", "video", "call", "in-person"] },
    slot: {
      date: { type: Date },
      startTime: { type: String, trim: true },
      endTime: { type: String, trim: true },
      timezone: { type: String, trim: true, default: "Asia/Kolkata" }
    },
    petDetails: {
      petInformation: { type: String, trim: true },
      petType: { type: String, trim: true },
      petBreed: { type: String, trim: true },
      ageYears: { type: Number, min: 0 },
      ageMonths: { type: Number, min: 0, max: 11 },
      weightKg: { type: Number, min: 0 },
      activeness: { type: String, trim: true },
      currentDiet: { type: String, trim: true },
      healthAllergies: { type: String, trim: true },
      medicalConditions: { type: String, trim: true },
      expectedImprovements: { type: String, trim: true },
      notes: { type: String, trim: true }
    }
  },

  // Boarding booking payload
  boardingBooking: BoardingBookingSchema,

  // Training booking payload
  trainingBooking: TrainingBookingSchema,

  // Relocation booking payload
  relocationBooking: RelocationBookingSchema,

  // Pet communicator booking payload
  communicatorBooking: {
    petId: { type: Schema.Types.ObjectId, ref: "Pet" },
    petName: { type: String, trim: true },
    expertId: { type: String, trim: true },
    expertName: { type: String, trim: true },
    consultationType: { type: String, enum: ["chat", "video", "call", "in-person"] },
    slot: {
      date: { type: Date },
      startTime: { type: String, trim: true },
      endTime: { type: String, trim: true },
      timezone: { type: String, trim: true, default: "Asia/Kolkata" }
    },
    concerns: { type: String, trim: true },
    notes: { type: String, trim: true }
  },

  // Pet cake booking payload
  petCakeBooking: {
    petId: { type: Schema.Types.ObjectId, ref: "Pet" },
    petName: { type: String, trim: true },
    cakeTypeId: { type: String, trim: true },
    cakeTypeName: { type: String, trim: true },
    ingredients: {
      type: Schema.Types.Mixed,
      default: undefined
    },
    customization: {
      size: { type: String, trim: true },
      shape: { type: String, trim: true },
      message: { type: String, trim: true },
      themeStyle: { type: String, trim: true }
    },
    customizationSelections: {
      type: Schema.Types.Mixed,
      default: undefined
    },
    pricing: {
      baseUnitPrice: { type: Number, min: 0 },
      customizationUnitPrice: { type: Number, min: 0 },
      unitPrice: { type: Number, min: 0 }
    },
    notes: { type: String, trim: true }
  },

  // Insurance booking payload saved from cart/order flow
  insuranceBooking: {
    type: Schema.Types.Mixed,
    default: undefined
  },

  // Generic service booking payload for service-type specific fields
  bookingPayload: {
    type: Schema.Types.Mixed,
    default: undefined
  },

  // For auditing
  notes: { type: String },                               // admin/user notes
}, { timestamps: true });

subscriptionSchema.pre("validate", function(next) {
  if (this.boardingBooking) {
    const { stay, pet } = this.boardingBooking;

    if (stay?.checkInDate && stay?.checkOutDate && stay.checkOutDate < stay.checkInDate) {
      return next(new Error("boardingBooking.stay.checkOutDate must be after checkInDate"));
    }

    // Require either saved pet id, or custom pet details when useCustomPetDetails is true
    if (pet && !pet.petId && pet.useCustomPetDetails !== true) {
      return next(new Error("boardingBooking.pet must include petId or set useCustomPetDetails=true"));
    }

    if (pet?.useCustomPetDetails && !pet?.petName) {
      return next(new Error("boardingBooking.pet.petName is required when useCustomPetDetails=true"));
    }
  }

  if (this.trainingBooking) {
    const { pet, schedule } = this.trainingBooking;

    if (schedule?.preferredStartDate && schedule?.preferredEndDate && schedule.preferredEndDate < schedule.preferredStartDate) {
      return next(new Error("trainingBooking.schedule.preferredEndDate must be after preferredStartDate"));
    }

    if (pet && !pet.petId && pet.useCustomPetDetails !== true) {
      return next(new Error("trainingBooking.pet must include petId or set useCustomPetDetails=true"));
    }

    if (pet?.useCustomPetDetails && !pet?.petName) {
      return next(new Error("trainingBooking.pet.petName is required when useCustomPetDetails=true"));
    }
  }

  if (this.relocationBooking) {
    const { trip, pet } = this.relocationBooking;

    if (trip?.pickupDate && trip.pickupDate < new Date(Date.now() - 60000)) {
      return next(new Error("relocationBooking.trip.pickupDate cannot be in the past"));
    }

    if (pet && !pet.petId && pet.useCustomPetDetails !== true) {
      return next(new Error("relocationBooking.pet must include petId or set useCustomPetDetails=true"));
    }

    if (pet?.useCustomPetDetails && !pet?.petName) {
      return next(new Error("relocationBooking.pet.petName is required when useCustomPetDetails=true"));
    }
  }

  next();
});

// Models
const Service = model("Service", serviceSchema);
const Subscription = mongoose.model("Subscription", subscriptionSchema);

module.exports = { Service, Subscription, SERVICE_TYPES };
