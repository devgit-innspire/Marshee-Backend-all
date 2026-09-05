import mongoose from "mongoose";
import Notification, {
  INotification,
  NotificationType,
} from "../models/Notification";
import DeviceToken from "../models/DeviceToken";
import { getIO } from "../socket";
import { sendPushToUser, sendPushToUsers } from "./pushService";

export interface CreateNotificationInput {
  recipientId: string | mongoose.Types.ObjectId;
  actorId?: string | mongoose.Types.ObjectId;
  type: NotificationType;
  groupId?: string | mongoose.Types.ObjectId;
  postId?: string | mongoose.Types.ObjectId;
  commentId?: string | mongoose.Types.ObjectId;
  messageId?: string | mongoose.Types.ObjectId;
  pollId?: string | mongoose.Types.ObjectId;
  /** Optional: stored on notification (primarily for announcement) */
  title?: string;
  /** Optional: stored on notification (primarily for announcement) */
  body?: string;
  /** Optional: used as FCM notification title (else default from type) */
  pushTitle?: string;
  /** Optional: used as FCM notification body (else default from type) */
  pushBody?: string;
}

const toObjectId = (id?: string | mongoose.Types.ObjectId) => {
  if (!id) return undefined;
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
};

export async function createNotification(
  input: CreateNotificationInput
): Promise<INotification | null> {
  const recipient = toObjectId(input.recipientId);
  if (!recipient) {
    console.log("[createNotification] Invalid recipient:", input.recipientId);
    return null;
  }

  const actor = input.actorId ? toObjectId(input.actorId) : undefined;

  // Actor should not notify themselves
  if (actor && actor.equals(recipient)) {
    console.log("[createNotification] Actor is recipient, skipping notification. actor:", actor.toString());
    return null;
  }

  const notification = await Notification.create({
    recipient,
    actor,
    type: input.type,
    group: toObjectId(input.groupId),
    post: toObjectId(input.postId),
    comment: toObjectId(input.commentId),
    message: toObjectId(input.messageId),
    poll: toObjectId(input.pollId),
    title: input.title,
    body: input.body,
  });

  const socketIO = getIO();
  if (socketIO) {
    const payload = {
      id: notification._id,
      type: notification.type,
      recipient: notification.recipient,
      actor: notification.actor,
      group: notification.group,
      post: notification.post,
      comment: notification.comment,
      message: notification.message,
      poll: notification.poll,
      title: notification.title,
      body: notification.body,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    };

    if (notification.recipient) {
      console.log(
        `[createNotification] Emitting to socket user_${notification.recipient.toString()}:`,
        payload
      );
      socketIO.to(`user_${notification.recipient.toString()}`).emit("notification", payload);
    }
  } else {
    console.log("[createNotification] SocketIO unavailable, skipping emit.");
  }

  const recipientStr = notification.recipient?.toString();
  if (recipientStr) {
    const { title, body } = getPushTitleBody(notification.type, input.pushTitle, input.pushBody);
    const data: Record<string, string> = {
      type: notification.type,
      id: (notification._id as mongoose.Types.ObjectId).toString(),
    };
    if (input.groupId) data.groupId = toObjectId(input.groupId)?.toString() ?? "";
    if (input.postId) data.postId = toObjectId(input.postId)?.toString() ?? "";
    if (input.commentId) data.commentId = toObjectId(input.commentId)?.toString() ?? "";
    if (input.messageId) data.messageId = toObjectId(input.messageId)?.toString() ?? "";
    console.log(
      "[createNotification] Sending push to user:",
      recipientStr,
      "title:",
      title,
      "body:",
      body,
      "data:",
      data
    );
    sendPushToUser(recipientStr, title, body, data).catch((err: unknown) =>
      console.error("[PUSH] createNotification send failed:", err)
    );
  }

  return notification;
}

function getPushTitleBody(
  type: NotificationType,
  customTitle?: string,
  customBody?: string
): { title: string; body: string } {
  if (customTitle && customBody) return { title: customTitle, body: customBody };
  const fallback: Record<NotificationType, { title: string; body: string }> = {
    new_message: { title: "New message", body: "You have a new message" },
    new_group_message: { title: "New message", body: "You have a new message in a group" },
    reply_message: { title: "Reply", body: "Someone replied to your message" },
    reply_post: { title: "Comment", body: "Someone commented on your post" },
    reply_comment: { title: "Reply", body: "Someone replied to your comment" },
    like_post: { title: "Like", body: "Someone liked your post" },
    poll_closed: { title: "Poll closed", body: "A poll you participated in has closed" },
    mention_post: { title: "Mention", body: "You were mentioned in a post" },
    mention_comment: { title: "Mention", body: "You were mentioned in a comment" },
    mention_message: { title: "Mention", body: "You were mentioned in a message" },
    announcement: { title: "Announcement", body: "New announcement" },
  };
  const d = fallback[type] ?? { title: "Notification", body: "You have a new notification" };
  return { title: customTitle ?? d.title, body: customBody ?? d.body };
}

export interface BroadcastNotificationInput {
  title?: string;
  body: string;
}

/**
 * Create a single announcement notification and push via Socket.IO to all connected clients.
 * One document is stored; all users see it in their notification list (recipient is null for announcements).
 */
export async function broadcastNotificationToAllUsers(
  input: BroadcastNotificationInput
): Promise<{ created: number; emitted: number }> {
  console.log("[DEBUG] broadcastNotificationToAllUsers called with input:", input);
  const notification = await Notification.create({
    type: "announcement" as NotificationType,
    title: input.title,
    body: input.body,
    isRead: false,
    readBy: [],
  });
  console.log("[DEBUG] Notification created:", notification);

  const socketIO = getIO();
  let emitted = 0;
  if (socketIO) {
    const payload = {
      id: notification._id,
      type: notification.type,
      recipient: notification.recipient,
      actor: notification.actor,
      group: notification.group,
      post: notification.post,
      comment: notification.comment,
      message: notification.message,
      poll: notification.poll,
      title: notification.title,
      body: notification.body,
      isRead: notification.isRead,
      readBy: notification.readBy,
      createdAt: notification.createdAt,
    };
    console.log("[DEBUG] Emitting socket notification with payload:", payload);
    socketIO.emit("notification", payload);
    emitted = 1;
  } else {
    console.log("[DEBUG] Socket.IO not available, no emit.");
  }

  const pushTitle = input.title ?? "Announcement";
  const pushBody = input.body;
  const data = {
    type: "announcement",
    id: (notification._id as mongoose.Types.ObjectId).toString(),
  };
  const userIds = await DeviceToken.distinct("user").then((ids) => ids.map((id) => id.toString()));
  console.log("[DEBUG] userIds for FCM push:", userIds);
  if (userIds.length === 0) {
    console.log("[PUSH] Broadcast: no device tokens registered — FCM not sent (tray/lock screen will not show). Register tokens from the app via POST /api/v1/notifications/device-token.");
  } else {
    console.log("[PUSH] Broadcast: sending FCM to", userIds.length, "user(s) for tray/lock screen.");
  }
  sendPushToUsers(userIds, pushTitle, pushBody, data).catch((err: unknown) =>
    console.error("[PUSH] broadcast send failed:", err)
  );

  console.log("[DEBUG] broadcastNotificationToAllUsers returning:", { created: 1, emitted });
  return { created: 1, emitted };
}

export async function registerDeviceToken(
  userId: string,
  fcmToken: string,
  platform: "ios" | "android"
): Promise<void> {
  console.log("Registering device token in service:", { userId, fcmToken, platform });
  await DeviceToken.findOneAndUpdate(
    { user: userId, fcmToken },
    { $set: { platform, updatedAt: new Date() } },
    { upsert: true, new: true }
  );
}

export interface NotificationListResult {
  notifications: INotification[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export async function listNotificationsForUser(
  userId: string | mongoose.Types.ObjectId,
  page = 1,
  limit = 20
): Promise<NotificationListResult> {
  const recipient = toObjectId(userId);
  if (!recipient) {
    return {
      notifications: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
        limit,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const maxLimit = 50;
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(limit, maxLimit)
      : 20;

  const filter = {
    $or: [
      { recipient },
      { type: "announcement", recipient: { $in: [null, undefined] } },
    ],
  };

  const totalItems = await Notification.countDocuments(filter);

  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .skip((safePage - 1) * safeLimit)
    .populate("actor", "name email phoneNumber avatar")
    .populate("group", "name")
    .populate("post", "content")
    .populate("comment", "content")
    .populate("message", "content")
    .populate("poll", "question")
    .lean();

  const userIdStr = recipient.toString();
  const notificationsWithRead = notifications.map((n: any) => {
    const doc = { ...n };
    if (doc.type === "announcement" && Array.isArray(doc.readBy)) {
      doc.isRead = doc.readBy.some(
        (id: mongoose.Types.ObjectId) => id?.toString() === userIdStr
      );
    }
    return doc;
  });

  const totalPages = Math.ceil(totalItems / safeLimit) || 0;

  return {
    notifications: notificationsWithRead as INotification[],
    pagination: {
      currentPage: safePage,
      totalPages,
      totalItems,
      limit: safeLimit,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}

export async function markNotificationRead(
  userId: string | mongoose.Types.ObjectId,
  notificationId: string | mongoose.Types.ObjectId
): Promise<INotification | null> {
  const userObjId = toObjectId(userId);
  const id = toObjectId(notificationId);

  if (!userObjId || !id) {
    return null;
  }

  const notification = await Notification.findById(id).lean();
  if (!notification) return null;

  const isAnnouncement =
    notification.type === "announcement" &&
    (notification.recipient == null || notification.recipient === undefined);

  if (isAnnouncement) {
    return Notification.findByIdAndUpdate(
      id,
      { $addToSet: { readBy: userObjId } },
      { new: true }
    );
  }

  return Notification.findOneAndUpdate(
    { _id: id, recipient: userObjId },
    { $set: { isRead: true } },
    { new: true }
  );
}

export async function markAllNotificationsRead(
  userId: string | mongoose.Types.ObjectId
): Promise<number> {
  const userObjId = toObjectId(userId);
  if (!userObjId) {
    return 0;
  }

  const normalResult = await Notification.updateMany(
    { recipient: userObjId, isRead: false },
    { $set: { isRead: true } }
  );

  const announcementResult = await Notification.updateMany(
    {
      type: "announcement",
      recipient: { $in: [null, undefined] },
      readBy: { $ne: userObjId },
    },
    { $addToSet: { readBy: userObjId } }
  );

  return (normalResult.modifiedCount ?? 0) + (announcementResult.modifiedCount ?? 0);
}
