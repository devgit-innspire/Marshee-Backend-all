// routes/connectionRoutes.ts
import { Router } from 'express';

import { sendConnectionRequest , acceptConnectionRequest, rejectConnectionRequest, removeConnection, getConnectionRequests, getConnections} from '../controllers/connectionController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/connection/requests/send:
 *   post:
 *     summary: Send connection request
 *     tags: [Connections]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recipientId: { type: string }
 *     responses:
 *       201:
 *         description: Request sent
 */
router.post("/requests/send", auth, sendConnectionRequest);

/**
 * @openapi
 * /api/v1/connection/requests/accept:
 *   post:
 *     summary: Accept connection request
 *     tags: [Connections]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requestId: { type: string }
 *     responses:
 *       200:
 *         description: Request accepted
 */
router.post("/requests/accept", auth, acceptConnectionRequest);

/**
 * @openapi
 * /api/v1/connection/requests/reject:
 *   post:
 *     summary: Reject connection request
 *     tags: [Connections]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requestId: { type: string }
 *     responses:
 *       200:
 *         description: Request rejected
 */
router.post("/requests/reject", auth, rejectConnectionRequest);

/**
 * @openapi
 * /api/v1/connection/remove:
 *   post:
 *     summary: Remove connection
 *     tags: [Connections]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId: { type: string }
 *     responses:
 *       200:
 *         description: Connection removed
 */
router.post("/remove", auth, removeConnection);

/**
 * @openapi
 * /api/v1/connection/requests:
 *   get:
 *     summary: Get connection requests
 *     tags: [Connections]
 *     responses:
 *       200:
 *         description: List of connection requests
 */
router.get("/requests", auth, getConnectionRequests);

/**
 * @openapi
 * /api/v1/connection/list:
 *   get:
 *     summary: Get my connections
 *     tags: [Connections]
 *     responses:
 *       200:
 *         description: List of connections
 */
router.get("/list", auth, getConnections);

export default router;