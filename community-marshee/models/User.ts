import mongoose, { Document, Schema, Model } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Define interface for User document
export interface IUser extends Document {
  name?: string;
  email?: string;
  phoneNumber?: string;
  role: "user" | "partner" | "admin";
  password?: string;
  firebaseUID?: string;
  profile: {
    isComplete: boolean;
    lastLogin: Date;
    avatar?: string;
    bio?: string;
  };
  connections: mongoose.Types.ObjectId[];
  connectionRequests: mongoose.Types.ObjectId[];
  blockedUsers: mongoose.Types.ObjectId[];
  pets?: mongoose.Types.ObjectId;
  // Moderation fields
  isBanned: boolean;
  isSuspended: boolean;
  suspendedUntil?: Date;
  banReason?: string;
  suspensionReason?: string;
  bannedBy?: mongoose.Types.ObjectId;
  suspendedBy?: mongoose.Types.ObjectId;
  bannedAt?: Date;
  suspendedAt?: Date;
  createdAt: Date;

  // methods
  getSignedJwtToken(): string;
  matchPassword(enteredPassword: string): Promise<boolean>;
}

const userSchema: Schema<IUser> = new Schema<IUser>({
  name: {
    type: String,
    required: function (this: IUser) {
      return this.role === "admin" || this.role === "partner";
    },
    trim: true,
    maxlength: [50, "Name cannot be more than 50 characters"],
  },
  email: {
    type: String,
    required: function (this: IUser) {
      return this.role === "admin" || this.role === "partner";
    },
    unique: true,
    sparse: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please add a valid email",
    ],
  },
  phoneNumber: {
    type: String,
    required: function (this: IUser) {
      return this.role === "user";
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
    required: function (this: IUser) {
      return this.role === "admin" || this.role === "partner";
    },
    minlength: 6,
    select: false,
  },
  firebaseUID: {
    type: String,
    unique: true,
    sparse: true,
    required: function (this: IUser) {
      return this.role === "user";
    },
  },
  profile: {
    isComplete: { type: Boolean, default: false },
    lastLogin: { type: Date, default: Date.now },
    avatar: { type: String },
    bio: { type: String, maxlength: [200, "Bio cannot be more than 200 characters"] },
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
  blockedUsers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  pets: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Pet",
  },
  // Moderation fields
  isBanned: {
    type: Boolean,
    default: false,
  },
  isSuspended: {
    type: Boolean,
    default: false,
  },
  suspendedUntil: {
    type: Date,
  },
  banReason: {
    type: String,
    maxlength: [500, "Ban reason cannot exceed 500 characters"],
  },
  suspensionReason: {
    type: String,
    maxlength: [500, "Suspension reason cannot exceed 500 characters"],
  },
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  bannedAt: {
    type: Date,
  },
  suspendedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Middleware: Encrypt password before saving
userSchema.pre<IUser>("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password!, salt);
  next();
});

// Method: Sign JWT and return
userSchema.methods.getSignedJwtToken = function (): string {
return jwt.sign({ id: this._id }, process.env.JWT_SECRET!, { expiresIn: "7d" });
};

// Method: Match entered password to hashed password
userSchema.methods.matchPassword = async function (enteredPassword: string): Promise<boolean> {
  return await bcrypt.compare(enteredPassword, this.password!);
};

// Export model
const User: Model<IUser> = mongoose.model<IUser>("User", userSchema);

export default User;
