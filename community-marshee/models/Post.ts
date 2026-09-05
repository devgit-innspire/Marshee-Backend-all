// models/Post.ts
import mongoose, { Schema, Document, Model } from "mongoose";

type PostMediaType = "image" | "video";
export type PostType = "ADVICE" | "HELP" | "INFO" | "PET_MOMENT" | "QUESTION"| "GENERAL";
export type PostPriority = "LOW" | "MEDIUM" | "HIGH";

interface IPostMedia {
  url: string;
  type: PostMediaType;
}

export interface IPost extends Document {
  user: mongoose.Types.ObjectId;
  author: mongoose.Types.ObjectId;
  group?: mongoose.Types.ObjectId;
  pet?: mongoose.Types.ObjectId;
  caption?: string;
  media: IPostMedia[];
  postType: PostType;
  tags: string[];
  priority?: PostPriority;
  likes: mongoose.Types.ObjectId[];
  commentsCount: number;
  isResolved: boolean;
  bestComment?: mongoose.Types.ObjectId;
  location?: string;
  isDeleted: boolean;
  status: "active" | "hidden" | "reported";
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Backward-compatible alias used by other existing modules.
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    group: { type: Schema.Types.ObjectId, ref: "CommunityGroup" },
    pet: { type: Schema.Types.ObjectId, ref: "Pet" },
    caption: { type: String, trim: true, maxlength: 5000 },
    media: [
      {
        url: { type: String, required: true, trim: true },
        type: { type: String, enum: ["image", "video"], required: true },
      },
    ],
    postType: {
      type: String,
      enum: ["ADVICE", "HELP", "INFO", "PET_MOMENT", "QUESTION"],
      required: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH"] },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    commentsCount: { type: Number, default: 0, min: 0 },
    isResolved: { type: Boolean, default: false },
    bestComment: { type: Schema.Types.ObjectId, ref: "Comment" },
    location: { type: String, trim: true, maxlength: 255 },
    isDeleted: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["active", "hidden", "reported"],
      default: "active",
    },
  },
  { timestamps: true }
);

postSchema.pre("validate", function (next) {
  if ((!this.caption || this.caption.trim().length === 0) && this.media.length === 0) {
    return next(new Error("Post must have either caption or media."));
  }

  if (this.postType === "HELP" && !this.priority) {
    this.priority = "MEDIUM";
  }

  if (this.postType !== "HELP") {
    this.priority = undefined;
    this.isResolved = false;
    this.bestComment = undefined;
  }

  next();
});

postSchema.virtual("likesCount").get(function () {
  return this.likes?.length || 0;
});

postSchema.index({ createdAt: -1 });
postSchema.index({ postType: 1 });
postSchema.index({ tags: 1 });
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ isDeleted: 1, status: 1 });

const Post: Model<IPost> = mongoose.model<IPost>("Post", postSchema);
export default Post;