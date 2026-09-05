const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const config = require('../config/config');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: function () {
      // Name is only required for admin and partner roles
      return this.role === "admin" || this.role === "partner";
    },
    trim: true,
    maxlength: [50, "Name cannot be more than 50 characters"],
  },
  email: {
    type: String,
    required: false,
    // Do not auto-create a global unique index from the schema; we add a
    // partial unique index below so only non-null emails must be unique.
    unique: false,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please add a valid email",
    ],
  },
  phoneNumber: {
    type: String,
    required: function () {
      // Phone number is required for user role only if firebaseUID is provided (Firebase phone auth)
      // For email/password registration, phoneNumber is optional
      if (this.role !== "user") return false;
      // If password is provided, it's email/password registration, so phoneNumber is optional
      if (this.password) return false;
      // If firebaseUID is provided, it's Firebase auth, so phoneNumber is required
      return !!this.firebaseUID;
    },
    trim: true,
  },
  role: {
    type: String,
    enum: ["user", "partner", "admin"],
    default: "user",
  },
  password: {
    type: String,
    required: function () {
      // Password is only required for admin role
      // Partner role can have null password initially (set via setup link)
      return this.role === "admin";
    },
    minlength: 6,
    select: false,
  },
  firebaseUID: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values
    required: function () {
      // Firebase UID is required for user role only if phoneNumber is provided (Firebase phone auth)
      // For email/password registration, firebaseUID is optional
      if (this.role !== "user") return false;
      // If password is provided, it's email/password registration, so firebaseUID is optional
      if (this.password) return false;
      // If phoneNumber is provided, it's Firebase auth, so firebaseUID is required
      return !!this.phoneNumber;
    },
  },
  profile: {
    isComplete: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
    avatar: String,
    bio: {
      type: String,
      maxlength: [200, "Bio cannot be more than 200 characters"],
    },
  },
  avatar: {
    type: String,
    trim: true,
    default: null,
  },
  address: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Address",
  },
  connections: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
   connectionRequests: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  pets: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Pet",
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure a partial unique index on email so that only present, non-null emails are unique.
// This allows many Firebase phone-auth users without emails to coexist.
userSchema.index(
  { email: 1 },
  { name: 'email_1', unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// Encrypt password using bcrypt
userSchema.pre("save", async function (next) {
  // Only hash password if it's modified and exists
  if (!this.isModified("password") || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Sign JWT and return
// userSchema.methods.getSignedJwtToken = function() {
//   const signOptions = { expiresIn: (config && config.jwtExpire) || '30d' };
//   return jwt.sign({ id: this._id }, config.jwtSecret, signOptions);
// };

// Sign JWT and return (include firebaseUID + phoneNumber so community service can resolve/create user)
userSchema.methods.getSignedJwtToken = function() {
  const signOptions = { expiresIn: (config && config.jwtExpire) || '30d' };
  const payload = { id: this._id };
  if (this.firebaseUID) payload.firebaseUID = this.firebaseUID;
  if (this.phoneNumber) payload.phoneNumber = this.phoneNumber;
  return jwt.sign(payload, config.jwtSecret, signOptions);
};

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  // If password is not set (null), return false
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
