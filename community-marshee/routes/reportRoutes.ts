import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  reportUser,
  reportPost,
  reportComment,
  listReportsForAdmin,
  adminUpdateReport,
  suspendUserAdmin,
  listSuspendedUsersAdmin,
  unsuspendUserAdmin,
} from "../controllers/reportController";

const router = Router();

router.post("/user", auth, reportUser);
router.post("/post", auth, reportPost);
router.post("/comment", auth, reportComment);

router.get("/admin/list", auth, requireAdmin, listReportsForAdmin);
router.patch("/admin/:id", auth, requireAdmin, adminUpdateReport);

router.post("/admin/users/:userId/suspend", auth, requireAdmin, suspendUserAdmin);
router.get("/admin/users/suspended", auth, requireAdmin, listSuspendedUsersAdmin);
router.post("/admin/users/:userId/unsuspend", auth, requireAdmin, unsuspendUserAdmin);

export default router;
