// controllers/blockController.ts
import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import User from "../models/User";

interface AuthRequest extends Request {
  user?: { id: string; [key: string]: any };
}

// Block User
export const blockUser = async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user?.id;


    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid target user ID is required.",
      });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot block yourself.",
      });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Target user not found.",
      });
    }

    // Get current user
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Your user account not found.",
      });
    }

    const targetUserObjectId = new Types.ObjectId(targetUserId);
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Check if already blocked
    if (currentUser.blockedUsers?.some(id => id.equals(targetUserObjectId))) {
      return res.status(400).json({
        success: false,
        message: "User is already blocked.",
      });
    }

    // Update using findByIdAndUpdate to avoid full-document validation on save()
    // (some users e.g. admin may have required fields like email missing in DB)
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: targetUserObjectId },
      $pull: {
        connections: targetUserObjectId,
        connectionRequests: targetUserObjectId,
      },
    });

    // Remove current user from target's connections and connectionRequests if present
    await User.findByIdAndUpdate(targetUserId, {
      $pull: {
        connections: currentUserObjectId,
        connectionRequests: currentUserObjectId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User blocked successfully.",
      data: {
        blockedUserId: targetUserId,
        blockedUserName: targetUser.name,
      },
    });

  } catch (err: any) {
    console.error("Error blocking user:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Unblock User
export const unblockUser = async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid target user ID is required.",
      });
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Your user account not found.",
      });
    }

    const targetUserObjectId = new Types.ObjectId(targetUserId);

    // Check if user is blocked
    if (!currentUser.blockedUsers?.some(id => id.equals(targetUserObjectId))) {
      return res.status(400).json({
        success: false,
        message: "User is not blocked.",
      });
    }

    // Update using findByIdAndUpdate to avoid full-document validation on save()
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: targetUserObjectId },
    });

    const targetUser = await User.findById(targetUserId);

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully.",
      data: {
        unblockedUserId: targetUserId,
        unblockedUserName: targetUser?.name,
      },
    });

  } catch (err: any) {
    console.error("Error unblocking user:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Blocked Users List
export const getBlockedUsers = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const currentUser = await User.findById(currentUserId)
      .populate("blockedUsers", "name email phoneNumber avatar profile");

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Blocked users retrieved successfully.",
      data: {
        blockedUsers: currentUser.blockedUsers || [],
        count: currentUser.blockedUsers?.length || 0,
      },
    });

  } catch (err: any) {
    console.error("Error fetching blocked users:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Check if user is blocked
export const checkIfBlocked = async (userId: string, targetUserId: string): Promise<boolean> => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.blockedUsers) return false;

    const targetUserObjectId = new Types.ObjectId(targetUserId);
    return user.blockedUsers.some(id => id.equals(targetUserObjectId));
  } catch (err) {
    console.error("Error checking if user is blocked:", err);
    return false;
  }
};

// Check if either user has blocked the other (bidirectional check)
export const isBlocked = async (userId1: string, userId2: string): Promise<boolean> => {
  try {
    const user1 = await User.findById(userId1);
    const user2 = await User.findById(userId2);
    
    if (!user1 || !user2) return false;

    const user1ObjectId = new Types.ObjectId(userId1);
    const user2ObjectId = new Types.ObjectId(userId2);

    const user1BlockedUser2 = user1.blockedUsers?.some(id => id.equals(user2ObjectId)) || false;
    const user2BlockedUser1 = user2.blockedUsers?.some(id => id.equals(user1ObjectId)) || false;

    return user1BlockedUser2 || user2BlockedUser1;
  } catch (err) {
    console.error("Error checking if users are blocked:", err);
    return false;
  }
};

