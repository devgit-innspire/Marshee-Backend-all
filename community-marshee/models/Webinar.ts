import mongoose, { model, Schema } from "mongoose";
import { IWebinar, WebinarStatus } from "../types/grow.types";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const WebinarFeatureSchema = new Schema(
  {
    icon: { type: String, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const WebinarSchema = new Schema<IWebinar>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    coverImage: { type: String, required: true, trim: true },

    date: { type: Date, required: true, index: true },
    timezone: { type: String, default: "UTC", trim: true, maxlength: 80 },
    duration: { type: Number, required: true, min: 1 },
    isLive: { type: Boolean, default: false },

    speaker: {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      image: { type: String, required: true, trim: true },
      role: { type: String, required: true, trim: true, maxlength: 120 },
    },

    seats: { type: Number, required: true, min: 1 },
    registeredCount: { type: Number, default: 0, min: 0 },
    registrationUrl: { type: String, trim: true },
    whatYouWillLearn: [{ type: String, trim: true, maxlength: 300 }],
    eventDetails: [WebinarFeatureSchema],

    slug: { type: String, unique: true, sparse: true, index: true },

    status: {
      type: String,
      enum: ["active", "hidden"] satisfies WebinarStatus[],
      default: "active",
      index: true,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

WebinarSchema.pre("validate", function (next) {
  if (this.slug) return next();
  if (!this.title) return next();
  this.slug = toSlug(this.title);
  next();
});

WebinarSchema.index({ date: 1, isDeleted: 1, status: 1 });
WebinarSchema.index({ isLive: 1, date: 1, isDeleted: 1 });
WebinarSchema.index({ title: "text", description: "text", "speaker.name": "text" });

export const Webinar =
  (mongoose.models.Webinar as mongoose.Model<IWebinar>) ||
  model<IWebinar>("Webinar", WebinarSchema);