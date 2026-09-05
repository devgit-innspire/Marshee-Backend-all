import mongoose, { model, Schema } from "mongoose";

export interface IWebinarRegistration extends mongoose.Document {
  webinar: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  petNames: string[];
  source: "user" | "guest";
  registeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebinarRegistrationSchema = new Schema<IWebinarRegistration>(
  {
    webinar: { type: Schema.Types.ObjectId, ref: "Webinar", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phoneNumber: { type: String, trim: true, maxlength: 30, index: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 180, index: true },
    petNames: { type: [String], default: [] },
    source: { type: String, enum: ["user", "guest"], default: "guest" },
    registeredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Prevent duplicate booking per webinar by user/email/phone.
WebinarRegistrationSchema.index(
  { webinar: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } }
);
WebinarRegistrationSchema.index(
  { webinar: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string", $ne: "" } } }
);
WebinarRegistrationSchema.index(
  { webinar: 1, phoneNumber: 1 },
  { unique: true, partialFilterExpression: { phoneNumber: { $type: "string", $ne: "" } } }
);

export const WebinarRegistration =
  (mongoose.models.WebinarRegistration as mongoose.Model<IWebinarRegistration>) ||
  model<IWebinarRegistration>("WebinarRegistration", WebinarRegistrationSchema);

