import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  addComment,
  getCommentsByPost,
  replyToComment,
  getCommentById,
  getMyComments,
  updateComment,
  deleteComment,
} from "../controllers/commentController";

const router = Router();

router.post("/", auth, addComment);
router.post("/reply", auth, replyToComment);
router.get("/me/list", auth, getMyComments);
router.get("/single/:id", getCommentById);
router.patch("/:id", auth, updateComment);
router.delete("/:id", auth, deleteComment);
router.get("/:postId", getCommentsByPost);

export default router;
