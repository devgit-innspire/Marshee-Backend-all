import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createLesson,
  deleteLesson,
  getLessonById,
  getLessons,
  submitQuizLesson,
  updateLesson,
} from "../controllers/lessonController";

const router = Router();

router.get("/", getLessons);
router.get("/:id", getLessonById);

router.post("/", auth, createLesson);
router.post("/:id/submit-quiz", auth, submitQuizLesson);
router.patch("/:id", auth, updateLesson);
router.delete("/:id", auth, deleteLesson);

export default router;

