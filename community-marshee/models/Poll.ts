import mongoose, { Document, Schema, Model } from "mongoose";

export interface IPoll extends Document {
  question: string;
  options: {
    text: string;
    votes: mongoose.Types.ObjectId[]; // list of userIds who voted
  }[];
  allowMultiple: boolean; // allow users to select multiple options
  createdBy: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  createdAt: Date;
  expiresAt?: Date; // optional: poll expiry time
}

const pollSchema = new Schema<IPoll>(
  {
    question: { type: String, required: true },
    options: [
      {
        text: { type: String, required: true },
        votes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      },
    ],
    allowMultiple: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "CommunityGroup", required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

const Poll: Model<IPoll> = mongoose.model<IPoll>("Poll", pollSchema);
export default Poll;
