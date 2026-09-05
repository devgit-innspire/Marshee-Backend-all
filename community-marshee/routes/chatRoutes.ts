// routes/chatRoutes.ts
import { Router } from 'express';
import {
  sendMessage,
  getGroupMessages,
  getPinnedMessages,
  getPrivateMessages,
  markAsRead,
  markMultipleAsRead,
  deleteMessage,
  addReaction,
  pinGroupMessage
} from '../controllers/chatController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/chats/groups/{groupId}/messages:
 *   get:
 *     summary: Get group messages
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: before
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of messages
 *   post:
 *     summary: Send message to group
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post('/groups/:groupId/messages', auth, sendMessage);
router.get('/groups/:groupId/messages', auth, getGroupMessages);

/**
 * @openapi
 * /api/v1/chats/groups/{groupId}/messages/pinned:
 *   get:
 *     summary: Get pinned messages in group
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of pinned messages
 */
router.get('/groups/:groupId/messages/pinned', auth, getPinnedMessages);

/**
 * @openapi
 * /api/v1/chats/groups/{groupId}/messages/{messageId}/pin:
 *   patch:
 *     summary: Pin or unpin a group message
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Message pin updated
 */
router.patch('/groups/:groupId/messages/:messageId/pin', auth, pinGroupMessage);

/**
 * @openapi
 * /api/v1/chats/private/{userId}/messages:
 *   get:
 *     summary: Get private messages with user
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of private messages
 */
router.get('/private/:userId/messages', auth, getPrivateMessages);

/**
 * @openapi
 * /api/v1/chats/private/messages:
 *   post:
 *     summary: Send private message
 *     tags: [Chats]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string }
 *               recipientId: { type: string }
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post('/private/messages', auth, sendMessage);

/**
 * @openapi
 * /api/v1/chats/messages/{messageId}/read:
 *   patch:
 *     summary: Mark message as read
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Message marked as read
 */
router.patch('/messages/:messageId/read', auth, markAsRead);

/**
 * @openapi
 * /api/v1/chats/messages/read:
 *   patch:
 *     summary: Mark multiple messages as read
 *     tags: [Chats]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Messages marked as read
 */
router.patch('/messages/read', auth, markMultipleAsRead);

/**
 * @openapi
 * /api/v1/chats/messages/{messageId}:
 *   delete:
 *     summary: Delete a message
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Message deleted
 */
router.delete('/messages/:messageId', auth, deleteMessage);

/**
 * @openapi
 * /api/v1/chats/messages/{messageId}/reactions:
 *   post:
 *     summary: Add reaction to message
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emoji: { type: string }
 *     responses:
 *       200:
 *         description: Reaction added
 */
router.post('/messages/:messageId/reactions', auth, addReaction);

export default router;