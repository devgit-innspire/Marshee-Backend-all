import mongoose, { model, Schema } from "mongoose";
import { ArticleCategory, ArticleStatus, IArticle } from "../types/grow.types";

const toSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const ArticlePhotoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const ArticleContentBlockSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["heading", "paragraph", "highlight", "list", "photo"],
      required: true,
    },
    text: { type: String },
    level: { type: Number, enum: [1, 2, 3] },
    title: { type: String },
    items: [
      {
        text: String,
      },
    ],
    // Allows one or multiple photos within a content block.
    photos: [ArticlePhotoSchema],
    // Style customization per block (similar to lesson content blocks)
    bgColor: { type: String },
    textColor: { type: String },
    icon: { type: String },
  },
  { _id: false }
);

const ArticleSchema = new Schema<IArticle>(
  {
    title: { type: String, required: true, trim: true, maxlength: 160, index: true },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    // Legacy plain content for backward compatibility
    content: { type: String, trim: true },
    // Rich article content with customizable blocks and inline photos
    contentBlocks: [ArticleContentBlockSchema],
    coverImage: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: Object.values(ArticleCategory),
      required: true,
      index: true,
    },

    readTime: { type: Number, required: true, min: 1, max: 120 },

    author: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      image: { type: String, required: true, trim: true },
      role: { type: String, required: true, trim: true, maxlength: 120 },
    },

    isFeatured: { type: Boolean, default: false, index: true },

    slug: { type: String, unique: true, sparse: true, index: true },

    status: {
      type: String,
      enum: ["active", "hidden"] satisfies ArticleStatus[],
      default: "active",
      index: true,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

ArticleSchema.pre("validate", function (this: IArticle, next) {
  if (this.slug) return next();
  if (!this.title) return next();
  this.slug = toSlug(this.title);
  next();
});

ArticleSchema.pre("validate", function (this: IArticle, next) {
  const hasLegacyContent = typeof this.content === "string" && this.content.trim().length > 0;
  const hasBlocks = Array.isArray(this.contentBlocks) && this.contentBlocks.length > 0;
  if (!hasLegacyContent && !hasBlocks) {
    return next(new Error("Either content or contentBlocks is required for an article."));
  }
  next();
});

ArticleSchema.index({ category: 1, createdAt: -1, isDeleted: 1 });
ArticleSchema.index({ isFeatured: 1, createdAt: -1, isDeleted: 1 });
ArticleSchema.index({ status: 1, isDeleted: 1 });

export const Article =
  (mongoose.models.Article as mongoose.Model<IArticle>) ||
  model<IArticle>("Article", ArticleSchema);