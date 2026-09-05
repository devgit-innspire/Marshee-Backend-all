import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const user = req.user as { role?: string } | null | undefined;
  if (!user || user.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin access required." });
    return;
  }
  next();
};
