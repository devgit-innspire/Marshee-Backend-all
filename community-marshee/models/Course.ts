import mongoose, { model, Schema } from "mongoose";
import { CourseLevel, CourseStatus, ICourse } from "../types/grow.types";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const CourseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 8000 },
    thumbnail: { type: String, required: true, trim: true },

    level: {
      type: String,
      enum: Object.values(CourseLevel),
      required: true,
      index: true,
    },

    duration: { type: Number, required: true, min: 1 },

    featuresOfCourse: [
      {
        type: String,
        trim: true,
        maxlength: 120,
      },
    ],

    instructor: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      image: { type: String, required: true, trim: true },
      role: { type: String, required: true, trim: true, maxlength: 120 },
    },

    slug: { type: String, unique: true, sparse: true, index: true },

    status: {
      type: String,
      enum: ["active", "hidden"] satisfies CourseStatus[],
      default: "active",
      index: true,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

CourseSchema.pre("validate", function (next) {
  if (this.slug) return next();
  if (!this.title) return next();
  this.slug = toSlug(this.title);
  next();
});

CourseSchema.index({ level: 1, isDeleted: 1, status: 1 });
CourseSchema.index({ createdAt: -1, isDeleted: 1 });

export const Course =
  (mongoose.models.Course as mongoose.Model<ICourse>) ||
  model<ICourse>("Course", CourseSchema);