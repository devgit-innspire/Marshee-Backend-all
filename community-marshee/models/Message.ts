// models/Message.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  sender: mongoose.Types.ObjectId;
  receiver?: mongoose.Types.ObjectId;
  group?: mongoose.Types.ObjectId;
  content?: string;
  attachments?: {
    url: string;
    type: "image" | "video" | "file";
    filename?: string;
    size?: number;
    duration?: number;
    thumbnail?: string;
  }[];
  type: "text" | "image" | "video" | "file";
  reactions: {
    user: mongoose.Types.ObjectId;
    emoji: string;
    createdAt: Date;
  }[];
  readBy: mongoose.Types.ObjectId[];
  isDeleted: boolean;
  isPinned?: boolean;
  pinnedAt?: Date;
  pinnedBy?: mongoose.Types.ObjectId;
  replyTo?: mongoose.Types.ObjectId;
  forwardedFrom?: mongoose.Types.ObjectId;
  /** User IDs mentioned in this message (for notifications) */
  mentions?: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    sender: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },

    receiver: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      validate: {
        validator: function(this: IMessage) {
          // Either receiver OR group must exist, but not both
          return !!(this.receiver || this.group) && !(this.receiver && this.group);
        },
        message: "Message must have either a receiver or group, but not both."
      }
    },

    group: { 
      type: Schema.Types.ObjectId, 
      ref: "CommunityGroup",
      validate: {
        validator: function(this: IMessage) {
          return !!(this.receiver || this.group) && !(this.receiver && this.group);
        },
        message: "Message must have either a receiver or group, but not both."
      }
    },

    content: { 
      type: String,
      maxlength: 5000,
    validate: {
  validator: function (this: IMessage, content: string): boolean {
    return !!(content || (this.attachments && this.attachments.length > 0));
  },
  message: "Message must have either content or attachments."
}

    },

    attachments: [
      {
        url: { 
          type: String, 
          required: true,
          validate: {
            validator: (v: string) => /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/.test(v),
            message: "Invalid URL format"
          }
        },
        type: {
          type: String,
          enum: ["image", "video", "file"],
          required: true,
        },
        filename: String,
        size: { type: Number, min: 0 },
        duration: { type: Number, min: 0 },
        thumbnail: String
      },
    ],

    type: {
      type: String,
      enum: ["text", "image", "video", "file"],
      default: "text",
    },
    
    reactions: [{
      user: { type: Schema.Types.ObjectId, ref: "User", required: true },
      emoji: { type: String, required: true, maxlength: 10 },
      createdAt: { type: Date, default: Date.now }
    }],

    readBy: [{ 
      type: Schema.Types.ObjectId, 
      ref: "User" 
    }],

    isDeleted: { 
      type: Boolean, 
      default: false 
    },

    isPinned: { type: Boolean, default: false },
    pinnedAt: { type: Date },
    pinnedBy: { type: Schema.Types.ObjectId, ref: "User" },

    replyTo: { 
      type: Schema.Types.ObjectId, 
      ref: "Message" 
    },

    forwardedFrom: { 
      type: Schema.Types.ObjectId, 
      ref: "Message" 
    },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for checking if message is read by a specific user
messageSchema.methods.isReadBy = function (userId: mongoose.Types.ObjectId): boolean {
  return this.readBy.some((id: mongoose.Types.ObjectId) => id.equals(userId));
};


// Indexes for better query performance
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ "reactions.user": 1 });

export default mongoose.model<IMessage>("Message", messageSchema);