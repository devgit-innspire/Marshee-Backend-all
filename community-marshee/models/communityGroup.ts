import mongoose, { Schema, Document } from "mongoose";

export type CommunityGroupMemberRole =
  | "member"
  | "moderator"
  | "admin"
  | "expert"
  // Legacy role kept for backward compatibility with existing data
  | "user";

export interface ICommunityGroup extends Document {
  name: string;
  description?: string;
  coverImage?: string;
  order?: number;
  rules?: string[];
  members: {
    user: mongoose.Types.ObjectId;
    role: CommunityGroupMemberRole;
    joinedAt: Date;
  }[];
  polls: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId; 
  createdAt: Date;
  updatedAt: Date;
}

const communityGroupSchema = new Schema<ICommunityGroup>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    rules: [
      {
        type: String,
        trim: true,
      },
    ],
    coverImage: { type: String }, // e.g. Cloudinary URL
    order: { type: Number, default: 0 }, // display order (lower = first)

    members: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        role: {
          type: String,
          enum: ["member", "moderator", "admin", "expert", "user"],
          default: "member",
        },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    polls: [{ type: Schema.Types.ObjectId, ref: "Poll" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICommunityGroup>(
  "CommunityGroup",
  communityGroupSchema
);
