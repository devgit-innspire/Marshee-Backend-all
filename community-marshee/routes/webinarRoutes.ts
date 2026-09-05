import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createWebinar,
  deleteWebinar,
  getMyWebinars,
  getWebinarById,
  getWebinarBySlug,
  getWebinars,
  registerForWebinar,
  updateWebinar,
} from "../controllers/webinarController";

const router = Router();

/**
 * @openapi
 * /api/v1/webinars:
 *   get:
 *     summary: List webinars
 *     tags: [Webinars]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: live
 *         schema: { type: boolean }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of webinars
 */
router.get("/", getWebinars);
router.get("/me", auth, getMyWebinars);
router.get("/slug/:slug", getWebinarBySlug);
router.get("/:id", getWebinarById);
router.post("/:id/register", auth, registerForWebinar);

/**
 * @openapi
 * /api/v1/webinars:
 *   post:
 *     summary: Create webinar (admin)
 *     tags: [Webinars]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Webinar created
 */
router.post("/", auth, createWebinar);
router.patch("/:id", auth, updateWebinar);
router.delete("/:id", auth, deleteWebinar);

export default router;

