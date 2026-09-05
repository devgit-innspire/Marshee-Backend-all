import { AuthRequest } from "../middlewares/auth";

export const getCurrentUserId = (req: AuthRequest): string | null => {
  const user = req.user as any;
  if (!user) return null;
  return user._id?.toString?.() || user.id?.toString?.() || null;
};

export const isAdminUser = (req: AuthRequest): boolean => {
  const user = req.user as any;
  return user?.role === "admin";
};

