import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createArticle,
  deleteArticle,
  getArticleById,
  getArticles,
  getRelatedArticles,
  updateArticle,
} from "../controllers/articleController";

const router = Router();

router.get("/", getArticles);
router.get("/:id/related", getRelatedArticles);
router.get("/:id", getArticleById);

router.post("/", auth, createArticle);
router.patch("/:id", auth, updateArticle);
router.delete("/:id", auth, deleteArticle);

export default router;

