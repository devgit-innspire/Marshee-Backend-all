import mongoose, { model, Schema } from "mongoose";
import { IModule, ModuleStatus } from "../types/grow.types";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const ModuleSchema = new Schema<IModule>(
  {
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    order: { type: Number, required: true, min: 1 },

    slug: { type: String, unique: true, sparse: true, index: true },

    status: {
      type: String,
      enum: ["active", "hidden"] satisfies ModuleStatus[],
      default: "active",
      index: true,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

ModuleSchema.pre("validate", function (next) {
  if (this.slug) return next();
  if (!this.title) return next();
  this.slug = toSlug(this.title);
  next();
});

ModuleSchema.index({ course: 1, order: 1, isDeleted: 1 });

export const Module =
  (mongoose.models.Module as mongoose.Model<IModule>) ||
  model<IModule>("Module", ModuleSchema);