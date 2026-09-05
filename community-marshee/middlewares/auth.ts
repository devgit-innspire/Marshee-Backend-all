import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import mongoose from "mongoose";
import User, { IUser } from "../models/User";

// Extend Express Request type to include user
export interface AuthRequest extends Request {
  user?: IUser | null;
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let token: string | undefined;


    // 1. Check if token comes from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    // 2. Or from cookie-parser
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }
    // 3. Or directly from Cookie header (manual parsing)
    else if (req.headers.cookie) {
      token = req.headers.cookie
        .split(";")
        .find((c) => c.trim().startsWith("token="))
        ?.split("=")[1];
    }

    if (!token) {
      res.status(401).json({ message: "No token provided" });
      return;
    }

    console.log("[AUTH] Token:", token);

    // Verify token (do not log full token in production)
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload & {
      id: string;
      firebaseUID?: string;
      phoneNumber?: string;
    };

    // Resolve user: by _id first (community-issued tokens), then by firebaseUID (app/main-backend tokens)
    let user = await User.findById(decoded.id).select("-password").exec();
    if (!user && decoded.firebaseUID) {
      user = await User.findOne({ firebaseUID: decoded.firebaseUID }).select("-password").exec();
    }
    if (!user && decoded.id && !mongoose.Types.ObjectId.isValid(decoded.id)) {
      user = await User.findOne({ firebaseUID: decoded.id }).select("-password").exec();
    }

    // Create community user on first request when JWT has firebaseUID (app users from main backend)
    if (!user && decoded.firebaseUID) {
      const phoneNumber = decoded.phoneNumber && /^\+[1-9]\d{1,14}$/.test(String(decoded.phoneNumber).replace(/\s/g, ""))
        ? String(decoded.phoneNumber).replace(/\s/g, "")
        : null;
      if (phoneNumber) {
        try {
          user = await User.create({
            firebaseUID: decoded.firebaseUID,
            phoneNumber,
            role: "user",
            profile: { isComplete: false, lastLogin: new Date() },
            connections: [],
            connectionRequests: [],
            blockedUsers: [],
          });
          user = await User.findById(user._id).select("-password").exec() || user;
          console.log("[auth] Created community user on first request:", user?._id?.toString(), "firebaseUID:", decoded.firebaseUID);
        } catch (createErr: any) {
          if (createErr.code !== 11000) {
            console.error("[auth] Failed to create user on first request:", createErr?.message || createErr);
          }
        }
      } else {
        console.warn("[auth] User not found and JWT has firebaseUID but no valid phoneNumber; cannot create user. decoded.id:", decoded.id, "firebaseUID:", decoded.firebaseUID);
      }
    }

    if (!user) {
      const hasFirebaseUID = Boolean(decoded.firebaseUID);
      console.warn("[auth] User not found: decoded.id=", decoded.id, "decoded.firebaseUID=", decoded.firebaseUID ?? "(missing)", "hasPhoneNumber=", Boolean(decoded.phoneNumber));
      res.status(401).json({
        message: hasFirebaseUID
          ? "User not found"
          : "User not found. Please log out and log in again to refresh your session.",
        code: hasFirebaseUID ? "USER_NOT_FOUND" : "SESSION_REFRESH_NEEDED",
      });
      return;
    }

    req.user = user;

  console.log("Authenticated user:", req.user?._id?.toString());
  console.log("User role:", req.user?.role);

    next();
  } catch (error: any) {
    console.error("JWT error:", error.message);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
