// controllers/connectionController.ts
import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import User from "../models/User";
import { isBlocked } from "./blockController";

interface AuthRequest extends Request {
  user?: { id: string; [key: string]: any };
}

// Send Connection Request
export const sendConnectionRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid target user ID is required."
      });
    }

    if (currentUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot send a connection request to yourself."
      });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Target user not found."
      });
    }

    // Convert string to ObjectId
    const currentUserObjectId = new Types.ObjectId(currentUserId);
    const targetUserObjectId = new Types.ObjectId(targetUserId);

    // Check if current user exists
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Your user account not found."
      });
    }

    // Check if users have blocked each other
    const usersAreBlocked = await isBlocked(currentUserId, targetUserId);
    if (usersAreBlocked) {
      return res.status(403).json({
        success: false,
        message: "You cannot send a connection request to this user."
      });
    }

    // Prevent duplicate requests
    if (targetUser.connectionRequests.some(id => id.equals(currentUserObjectId))) {
      return res.status(400).json({
        success: false,
        message: "Connection request already sent to this user."
      });
    }

    // Check if already connected
    if (targetUser.connections.some(id => id.equals(currentUserObjectId))) {
      return res.status(400).json({
        success: false,
        message: "You are already connected with this user."
      });
    }

    // Check if target user has already sent a request to current user
    if (currentUser.connectionRequests.some(id => id.equals(targetUserObjectId))) {
      return res.status(400).json({
        success: false,
        message: "This user has already sent you a connection request. Please check your pending requests."
      });
    }

    // Add connection request
    targetUser.connectionRequests.push(currentUserObjectId);
    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Connection request sent successfully.",
      data: {
        targetUserId: targetUserId,
        targetUserName: targetUser.name
      }
    });

  } catch (err: any) {
    console.error("Error sending connection request:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Accept Connection Request
export const acceptConnectionRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestUserId } = req.body;
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!requestUserId || !mongoose.Types.ObjectId.isValid(requestUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid request user ID is required."
      });
    }

    // Check if users exist
    const currentUser = await User.findById(currentUserId);
    const requestUser = await User.findById(requestUserId);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Your user account not found."
      });
    }

    if (!requestUser) {
      return res.status(404).json({
        success: false,
        message: "Requesting user not found."
      });
    }

    // Convert string to ObjectId
    const requestUserObjectId = new Types.ObjectId(requestUserId);
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Check if users have blocked each other
    const usersAreBlocked = await isBlocked(currentUserId, requestUserId);
    if (usersAreBlocked) {
      return res.status(403).json({
        success: false,
        message: "You cannot accept a connection request from this user."
      });
    }

    // Check if request exists
    const hasPendingRequest = currentUser.connectionRequests.some(id => 
      id.equals(requestUserObjectId)
    );

    if (!hasPendingRequest) {
      return res.status(400).json({
        success: false,
        message: "No pending connection request from this user."
      });
    }

    // Check if already connected
    const isAlreadyConnected = currentUser.connections.some(id => 
      id.equals(requestUserObjectId)
    );

    if (isAlreadyConnected) {
      // Clean up the pending request if already connected
      currentUser.connectionRequests = currentUser.connectionRequests.filter(
        id => !id.equals(requestUserObjectId)
      );
      await currentUser.save();

      return res.status(400).json({
        success: false,
        message: "You are already connected with this user."
      });
    }

    // Add each other to connections
    currentUser.connections.push(requestUserObjectId);
    requestUser.connections.push(currentUserObjectId);

    // Remove from pending requests
    currentUser.connectionRequests = currentUser.connectionRequests.filter(
      id => !id.equals(requestUserObjectId)
    );

    await currentUser.save();
    await requestUser.save();

    return res.status(200).json({
      success: true,
      message: "Connection request accepted successfully.",
      data: {
        connectedUserId: requestUserId,
        connectedUserName: requestUser.name
      }
    });

  } catch (err: any) {
    console.error("Error accepting connection request:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Reject Connection Request
export const rejectConnectionRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestUserId } = req.body;
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!requestUserId || !mongoose.Types.ObjectId.isValid(requestUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid request user ID is required."
      });
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    const requestUserObjectId = new Types.ObjectId(requestUserId);

    // Check if request exists
    const hasPendingRequest = currentUser.connectionRequests.some(id => 
      id.equals(requestUserObjectId)
    );

    if (!hasPendingRequest) {
      return res.status(400).json({
        success: false,
        message: "No pending connection request from this user."
      });
    }

    // Remove the connection request
    currentUser.connectionRequests = currentUser.connectionRequests.filter(
      id => !id.equals(requestUserObjectId)
    );

    await currentUser.save();

    return res.status(200).json({
      success: true,
      message: "Connection request rejected successfully."
    });

  } catch (err: any) {
    console.error("Error rejecting connection request:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Remove Connection
export const removeConnection = async (req: AuthRequest, res: Response) => {
  try {
    const { connectionUserId } = req.body;
    const currentUserId = req.user?.id;

    // Input validation
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!connectionUserId || !mongoose.Types.ObjectId.isValid(connectionUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid connection user ID is required."
      });
    }

    const currentUser = await User.findById(currentUserId);
    const connectionUser = await User.findById(connectionUserId);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Your user account not found."
      });
    }

    if (!connectionUser) {
      return res.status(404).json({
        success: false,
        message: "Connection user not found."
      });
    }

    const connectionUserObjectId = new Types.ObjectId(connectionUserId);
    const currentUserObjectId = new Types.ObjectId(currentUserId);

    // Check if connection exists
    const isConnected = currentUser.connections.some(id => 
      id.equals(connectionUserObjectId)
    );

    if (!isConnected) {
      return res.status(400).json({
        success: false,
        message: "You are not connected with this user."
      });
    }

    // Remove connection from both users
    currentUser.connections = currentUser.connections.filter(
      id => !id.equals(connectionUserObjectId)
    );

    connectionUser.connections = connectionUser.connections.filter(
      id => !id.equals(currentUserObjectId)
    );

    await currentUser.save();
    await connectionUser.save();

    return res.status(200).json({
      success: true,
      message: "Connection removed successfully."
    });

  } catch (err: any) {
    console.error("Error removing connection:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Connection Requests
export const getConnectionRequests = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const user = await User.findById(currentUserId)
      .populate("connectionRequests", "name email phoneNumber avatar profile")
      .select("connectionRequests");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Connection requests retrieved successfully.",
      data: {
        requests: user.connectionRequests,
        count: user.connectionRequests.length
      }
    });

  } catch (err: any) {
    console.error("Error getting connection requests:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Connections
export const getConnections = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const user = await User.findById(currentUserId)
      .populate("connections", "name email phoneNumber avatar profile")
      .select("connections");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Connections retrieved successfully.",
      data: {
        connections: user.connections,
        count: user.connections.length
      }
    });

  } catch (err: any) {
    console.error("Error getting connections:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};