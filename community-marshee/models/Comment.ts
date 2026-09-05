// models/Comment.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export interface IComment extends Document {
  post: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  text: string;
  content?: string;
  likes: mongoose.Types.ObjectId[];
  parentComment?: mongoose.Types.ObjectId;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    // Backward-compatible alias used by existing modules.
    content: { type: String, trim: true, maxlength: 1000 },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    parentComment: { type: Schema.Types.ObjectId, ref: "Comment" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

commentSchema.pre("validate", function (next) {
  if (!this.text && this.content) {
    this.text = this.content;
  }
  if (!this.content && this.text) {
    this.content = this.text;
  }
  next();
});

// Virtuals
commentSchema.virtual("likeCount").get(function () {
  return this.likes.length;
});

// Indexes
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ user: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1 });

const Comment: Model<IComment> = mongoose.model<IComment>(
  "Comment",
  commentSchema
);
export default Comment;