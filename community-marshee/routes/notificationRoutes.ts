import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  broadcastToAll,
  registerDeviceToken,
} from "../controllers/notificationController";

const router = Router();

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     summary: Get my notifications
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: List of notifications
 */
router.get("/", auth, getNotifications);

/**
 * @openapi
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     summary: Mark notification as read
 *     tags: [Notifications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.patch("/:id/read", auth, markNotificationAsRead);

/**
 * @openapi
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: All marked as read
 */
router.patch("/read-all", auth, markAllNotificationsAsRead);

/**
 * @openapi
 * /api/v1/notifications/broadcast:
 *   post:
 *     summary: Broadcast to all (admin)
 *     tags: [Notifications]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               body: { type: string }
 *     responses:
 *       200:
 *         description: Broadcast sent
 */
router.post("/broadcast", auth, broadcastToAll);

/**
 * @openapi
 * /api/v1/notifications/device-token:
 *   post:
 *     summary: Register device token for push
 *     tags: [Notifications]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *               platform: { type: string }
 *     responses:
 *       200:
 *         description: Token registered
 */
router.post("/device-token", auth, registerDeviceToken);

export default router;

