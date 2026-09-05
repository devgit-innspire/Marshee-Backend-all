// routes/blockRoutes.ts
import { Router } from 'express';
import {
  blockUser,
  unblockUser,
  getBlockedUsers
} from '../controllers/blockController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/block/block:
 *   post:
 *     summary: Block a user
 *     tags: [Block]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId: { type: string }
 *     responses:
 *       200:
 *         description: User blocked
 */
router.post('/block', auth, blockUser);

/**
 * @openapi
 * /api/v1/block/unblock:
 *   post:
 *     summary: Unblock a user
 *     tags: [Block]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId: { type: string }
 *     responses:
 *       200:
 *         description: User unblocked
 */
router.post('/unblock', auth, unblockUser);

/**
 * @openapi
 * /api/v1/block/list:
 *   get:
 *     summary: Get blocked users list
 *     tags: [Block]
 *     responses:
 *       200:
 *         description: List of blocked users
 */
router.get('/list', auth, getBlockedUsers);

export default router;



