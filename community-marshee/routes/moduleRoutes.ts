import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createModule,
  deleteModule,
  getModuleById,
  getModules,
  updateModule,
} from "../controllers/moduleController";

const router = Router();

router.get("/", getModules);
router.get("/:id", getModuleById);

router.post("/", auth, createModule);
router.patch("/:id", auth, updateModule);
router.delete("/:id", auth, deleteModule);

export default router;

