import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/auth";
import {
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
  broadcastNotificationToAllUsers,
  registerDeviceToken as registerDeviceTokenService,
} from "../services/notificationService";

export const getNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 20;

    const result = await listNotificationsForUser(userId, page, limit);

    return res.status(200).json({
      success: true,
      message: "Notifications retrieved successfully.",
      data: {
        notifications: result.notifications,
        pagination: result.pagination,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const markNotificationAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?._id?.toString();
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required.",
      });
    }

    const updated = await markNotificationRead(userId, id);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};

export const markAllNotificationsAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?._id?.toString();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    const modifiedCount = await markAllNotificationsRead(userId);

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      data: { updatedCount: modifiedCount },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Broadcast an announcement notification to all users.
 * Creates a Notification for each user and pushes via Socket.IO to connected clients.
 */
export const broadcastToAll = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Debug console log
    console.log("[DEBUG][broadcastToAll] Request body:", req.body);

    const { title, body } = req.body;
    if (!body || typeof body !== "string" || body.trim().length === 0) {
      console.log("[DEBUG][broadcastToAll] Missing or invalid body.");
      return res.status(400).json({
        success: false,
        message: "Body is required and must be a non-empty string.",
      });
    }

    const broadcastInput = {
      title: typeof title === "string" ? title.trim() || undefined : undefined,
      body: body.trim(),
    };

    console.log("[DEBUG][broadcastToAll] Prepared broadcastInput:", broadcastInput);

    const result = await broadcastNotificationToAllUsers(broadcastInput);

    console.log("[DEBUG][broadcastToAll] Result:", result);

    return res.status(201).json({
      success: true,
      message: "Broadcast notification sent to all users.",
      data: {
        notificationsCreated: result.created,
        realTimeEmitsSent: result.emitted,
      },
    });
  } catch (err) {
    console.log("[DEBUG][broadcastToAll] Error:", err);
    next(err);
  }
};

/**
 * Register FCM device token for push notifications.
 * Body: { fcmToken: string, platform: "ios" | "android" }
 */
export const registerDeviceToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?._id?.toString();
    const { fcmToken, platform } = req.body;
    console.log("Device token registration request:", req.body);


    if (process.env.NODE_ENV !== "production") {
      console.log("[PUSH] Device token registered — userId:", userId, "platform:", platform, "fcmToken:", fcmToken);
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    if (!fcmToken || typeof fcmToken !== "string" || !fcmToken.trim()) {
      return res.status(400).json({
        success: false,
        message: "fcmToken is required and must be a non-empty string.",
      });
    }

    if (!platform || !["ios", "android"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'platform is required and must be "ios" or "android".',
      });
    }

    await registerDeviceTokenService(userId, fcmToken.trim(), platform);
    

    return res.status(200).json({
      success: true,
      message: "Device token registered successfully.",
    });
  } catch (err) {
    next(err);
  }
};
