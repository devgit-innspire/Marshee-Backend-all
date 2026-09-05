import mongoose, { Document, Schema, Model } from "mongoose";

export type NotificationType =
  | "new_message"
  | "new_group_message"
  | "reply_message"
  | "reply_post"
  | "reply_comment"
  | "like_post"
  | "poll_closed"
  | "mention_post"
  | "mention_comment"
  | "mention_message"
  | "announcement";

export interface INotification extends Document {
  /** Omitted for broadcast announcements (type "announcement") */
  recipient?: mongoose.Types.ObjectId;
  actor?: mongoose.Types.ObjectId;
  type: NotificationType;
  group?: mongoose.Types.ObjectId;
  post?: mongoose.Types.ObjectId;
  comment?: mongoose.Types.ObjectId;
  message?: mongoose.Types.ObjectId;
  poll?: mongoose.Types.ObjectId;
  /** Optional title for announcement-type notifications */
  title?: string;
  /** Optional body for announcement-type notifications */
  body?: string;
  isRead: boolean;
  /** For announcements (single doc): user IDs who have read it */
  readBy?: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
      default: null,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      required: true,
      enum: [
        "new_message",
        "new_group_message",
        "reply_message",
        "reply_post",
        "reply_comment",
        "like_post",
        "poll_closed",
        "mention_post",
        "mention_comment",
        "mention_message",
        "announcement",
      ],
    },
    title: { type: String },
    body: { type: String },
    group: {
      type: Schema.Types.ObjectId,
      ref: "CommunityGroup",
    },
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
    },
    comment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
    },
    message: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    poll: {
      type: Schema.Types.ObjectId,
      ref: "Poll",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });

const Notification: Model<INotification> = mongoose.model<INotification>(
  "Notification",
  notificationSchema
);

export default Notification;

