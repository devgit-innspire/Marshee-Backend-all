import mongoose, { Document, Schema, Model } from "mongoose";

export interface IDeviceToken extends Document {
  user: mongoose.Types.ObjectId;
  fcmToken: string;
  platform: "ios" | "android";
  updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fcmToken: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

deviceTokenSchema.index({ user: 1, fcmToken: 1 }, { unique: true });

const DeviceToken: Model<IDeviceToken> = mongoose.model<IDeviceToken>(
  "DeviceToken",
  deviceTokenSchema
);
export default DeviceToken;
