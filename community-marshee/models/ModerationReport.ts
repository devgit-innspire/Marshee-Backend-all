import mongoose, { Schema, Document, Model } from "mongoose";

export type ReportTargetType = "user" | "post" | "comment";
export type ModerationReportStatus = "pending" | "reviewed" | "resolved" | "dismissed";

export interface IModerationReport extends Document {
  targetType: ReportTargetType;
  reporter: mongoose.Types.ObjectId;
  /** Author of reported content, or the reported user for user-target reports */
  reportedUser: mongoose.Types.ObjectId;
  post?: mongoose.Types.ObjectId;
  comment?: mongoose.Types.ObjectId;
  reason: string;
  description?: string;
  status: ModerationReportStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  adminNotes?: string;
  resolutionAction?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Stable collection name — browse this in Compass/Atlas (not `reports`). */
const MODERATION_REPORTS_COLLECTION = "moderationreports";

const moderationReportSchema = new Schema<IModerationReport>(
  {
    targetType: {
      type: String,
      enum: ["user", "post", "comment"],
      required: true,
    },
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    post: { type: Schema.Types.ObjectId, ref: "Post" },
    comment: { type: Schema.Types.ObjectId, ref: "Comment" },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["pending", "reviewed", "resolved", "dismissed"],
      default: "pending",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    adminNotes: { type: String, trim: true, maxlength: 1000 },
    resolutionAction: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true, collection: MODERATION_REPORTS_COLLECTION }
);

moderationReportSchema.index({ createdAt: -1 });
moderationReportSchema.index({ status: 1, createdAt: -1 });
moderationReportSchema.index({ targetType: 1, status: 1 });
moderationReportSchema.index({ reporter: 1, post: 1 }, { sparse: true });
moderationReportSchema.index({ reporter: 1, comment: 1 }, { sparse: true });
moderationReportSchema.index({ reporter: 1, reportedUser: 1, targetType: 1 }, { sparse: true });

const ModerationReport: Model<IModerationReport> = mongoose.model<IModerationReport>(
  "ModerationReport",
  moderationReportSchema
);

export default ModerationReport;
