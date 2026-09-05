// routes/postRoutes.ts
import { Router } from 'express';
import {
  createPost,
  getPosts,
  getMyPosts,
  getPostById,
  updatePost,
  deletePost,
  toggleLikePost,
  resolveHelpPost,
  setBestComment
} from '../controllers/postController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/posts:
 *   get:
 *     summary: List posts
 *     tags: [Posts]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: groupId
 *         schema: { type: string }
 *         description: Filter by group ID
 *     responses:
 *       200:
 *         description: List of posts
 */
router.get("/", getPosts);
router.get("/me", auth, getMyPosts);

/**
 * @openapi
 * /api/v1/posts/pinned:
 *   get:
 *     summary: Get pinned posts
 *     tags: [Posts]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: groupId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of pinned posts
 */
router.post("/", auth, createPost);
router.get("/:id", getPostById);
router.patch("/:id", auth, updatePost);
router.delete("/:id", auth, deletePost);
router.post("/:id/like", auth, toggleLikePost);
router.patch("/:id/resolve", auth, resolveHelpPost);
router.patch("/:id/best-comment", auth, setBestComment);

export default router;