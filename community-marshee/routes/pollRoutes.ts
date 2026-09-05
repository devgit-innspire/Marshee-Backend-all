import { Router } from 'express';
import { createPoll, votePoll, getGroupPolls, getPoll, updatePoll, deletePoll, closePoll } from '../controllers/pollController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/poll/getPoll/{pollId}:
 *   get:
 *     summary: Get poll by ID
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: pollId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Poll details
 */
router.get("/getPoll/:pollId", auth, getPoll);

/**
 * @openapi
 * /api/v1/poll/{pollId}/vote:
 *   post:
 *     summary: Vote on a poll
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: pollId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               optionId: { type: string }
 *     responses:
 *       200:
 *         description: Vote recorded
 */
router.post('/:pollId/vote', auth, votePoll);

/**
 * @openapi
 * /api/v1/poll/{pollId}/close:
 *   post:
 *     summary: Close a poll
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: pollId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Poll closed
 */
router.post('/:pollId/close', auth, closePoll);

/**
 * @openapi
 * /api/v1/poll/{pollId}:
 *   put:
 *     summary: Update a poll
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: pollId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question: { type: string }
 *               options:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Poll updated
 *   delete:
 *     summary: Delete a poll
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: pollId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Poll deleted
 */
router.put("/:pollId", auth, updatePoll);
router.delete("/:pollId", auth, deletePoll);

/**
 * @openapi
 * /api/v1/poll/{groupId}:
 *   get:
 *     summary: Get polls for a group
 *     tags: [Polls]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of group polls
 *   post:
 *     summary: Create a poll in a group
 *     tags: [Polls]
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
 *               question: { type: string }
 *               options:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Poll created
 */
router.post('/:groupId', auth, createPoll);
router.get('/:groupId', auth, getGroupPolls);

export default router;