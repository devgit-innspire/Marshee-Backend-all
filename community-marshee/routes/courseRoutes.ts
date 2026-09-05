import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createCourse,
  deleteCourse,
  enrollInCourse,
  getCourseProgress,
  getCourseById,
  getCourses,
  getMyCourseProgress,
  markLessonCompleted,
  removeCompletedLesson,
  searchGrowContent,
  updateCourse,
} from "../controllers/courseController";

const router = Router();

router.get("/", getCourses);
router.get("/search/discover", searchGrowContent);
router.get("/progress/me", auth, getMyCourseProgress);
router.get("/:courseId/progress", auth, getCourseProgress);
router.get("/:courseId", getCourseById);

router.post("/", auth, createCourse);
router.post("/:courseId/enroll", auth, enrollInCourse);
router.patch("/:courseId/lessons/:lessonId/complete", auth, markLessonCompleted);
router.patch("/:courseId/lessons/:lessonId/uncomplete", auth, removeCompletedLesson);
router.patch("/:id", auth, updateCourse);
router.delete("/:id", auth, deleteCourse);

export default router;

