import { Server, Socket } from "socket.io";
import http from "http";
import { Express } from "express";
import jwt from "jsonwebtoken";
import User from "./models/User";
import CommunityGroup from "./models/communityGroup";
import mongoose from "mongoose";

let io: Server | undefined;

// Store online users: userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();

// Store user socket mapping: socketId -> userId
const socketToUser = new Map<string, string>();

// Store typing users: { groupId/userId -> Set of userIds }
const typingUsers = new Map<string, Set<string>>();

// Authenticate socket connection
const authenticateSocket = async (socket: Socket): Promise<string | null> => {
  try {
    // Try multiple sources for token: auth object, Authorization header, or query parameter
    let token = socket.handshake.auth?.token;

    console.log("Token handshake:", token);
    
    if (!token && socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }
    
    if (!token && socket.handshake.query?.token) {
      token = socket.handshake.query.token as string;
    }
    
    if (!token) {
      console.log("Socket authentication failed: No token provided");
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    const user = await User.findById(decoded.id).select("-password");
    
    if (!user) {
      console.log("Socket authentication failed: User not found");
      return null;
    }

    return String(user._id);
  } catch (error: any) {
    console.log("Socket authentication failed:", error.message);
    return null;
  }
};

export default function setupSocket(server: http.Server, app: Express) {
  console.log(`🔌 [SOCKET] Initializing Socket.IO server...`);
  
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true, // Allow Engine.IO v3 clients
  });
  
  console.log(`✅ [SOCKET] Socket.IO server created`);

  io.use(async (socket: Socket, next) => {
    const userId = await authenticateSocket(socket);
    if (!userId) {
      return next(new Error("Authentication failed"));
    }
    (socket as any).userId = userId;
    next();
  });

  io.on("connection", async (socket: Socket) => {
    const userId = (socket as any).userId;
    
    if (!userId) {
      console.error(`❌ [SOCKET] Connection rejected: No userId found`);
      socket.disconnect();
      return;
    }

    console.log(`✅ [SOCKET] User connected: ${userId} (socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);
    socketToUser.set(socket.id, userId);

    // Join user's private room
    const privateRoomName = `user_${userId}`;
    socket.join(privateRoomName);
    
    // Verify join worked
    const privateRoom = io?.sockets.adapter.rooms.get(privateRoomName);
    const privateRoomClientCount = privateRoom?.size || 0;
    console.log(`✅ [SOCKET] User ${userId} joined private room: ${privateRoomName}`);
    console.log(`✅ [SOCKET] Clients in ${privateRoomName}: ${privateRoomClientCount}`);

    // Notify user's connections that they're online
    try {
      const user = await User.findById(userId);
      const socketIO = io;
      if (user && user.connections && user.connections.length > 0 && socketIO) {
        user.connections.forEach((connId: mongoose.Types.ObjectId) => {
          socketIO.to(`user_${connId.toString()}`).emit("userOnline", { userId });
        });
      }
    } catch (error) {
      console.error("Error notifying online status:", error);
    }

    // CRITICAL: Handle generic 'join' event (for frontend compatibility)
    socket.on("join", async (roomName: string) => {
      console.log(`✅ [SOCKET] User ${userId} requesting to join room: ${roomName}`);
      
      // Validate room name format
      if (!roomName || typeof roomName !== 'string') {
        console.error(`❌ [SOCKET] Invalid room name: ${roomName}`);
        socket.emit("error", { message: "Invalid room name" });
        return;
      }
      
      // Handle group room joins with validation
      if (roomName.startsWith('group_')) {
        const groupId = roomName.replace('group_', '');
        if (!mongoose.Types.ObjectId.isValid(groupId)) {
          console.error(`❌ [SOCKET] Invalid group ID in room name: ${groupId}`);
          socket.emit("error", { message: "Invalid group ID" });
          return;
        }
        
        try {
          const group = await CommunityGroup.findById(groupId);
          if (!group) {
            console.error(`❌ [SOCKET] Group not found: ${groupId}`);
            socket.emit("error", { message: "Group not found" });
            return;
          }
          
          const isMember = group.members.some(
            (member: any) => member.user.toString() === userId
          );
          
          if (!isMember) {
            console.error(`❌ [SOCKET] User ${userId} is not a member of group ${groupId}`);
            socket.emit("error", { message: "You are not a member of this group" });
            return;
          }
        } catch (error: any) {
          console.error(`❌ [SOCKET] Error validating group membership:`, error);
          socket.emit("error", { message: "Failed to validate group membership" });
          return;
        }
      }
      
      // CRITICAL: Actually join the socket to the room
      socket.join(roomName);
      
      // Verify join worked
      const room = io?.sockets.adapter.rooms.get(roomName);
      const clientCount = room?.size || 0;
      console.log(`✅ [SOCKET] User ${userId} joined room: ${roomName}`);
      console.log(`✅ [SOCKET] Clients in ${roomName}: ${clientCount}`);
      
      // Send confirmation back to client
      socket.emit("joined", { room: roomName });
    });

    // Handle generic 'leave' event
    socket.on("leave", (roomName: string) => {
      console.log(`✅ [SOCKET] User ${userId} leaving room: ${roomName}`);
      socket.leave(roomName);
      
      const room = io?.sockets.adapter.rooms.get(roomName);
      const clientCount = room?.size || 0;
      console.log(`✅ [SOCKET] User ${userId} left room: ${roomName}`);
      console.log(`✅ [SOCKET] Clients remaining in ${roomName}: ${clientCount}`);
      
      socket.emit("left", { room: roomName });
    });

    // Join Group Room (with validation)
    socket.on("joinGroup", async (groupId: string) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(groupId)) {
          socket.emit("error", { message: "Invalid group ID" });
          return;
        }

        const group = await CommunityGroup.findById(groupId);
        if (!group) {
          socket.emit("error", { message: "Group not found" });
          return;
        }

        const isMember = group.members.some(
          (member: any) => member.user.toString() === userId
        );

        if (!isMember) {
          socket.emit("error", { message: "You are not a member of this group" });
          return;
        }

        const roomName = `group_${groupId}`;
        socket.join(roomName);
        
        // Verify join worked
        const room = io?.sockets.adapter.rooms.get(roomName);
        const clientCount = room?.size || 0;
        console.log(`✅ [SOCKET] User ${userId} joined group room: ${roomName}`);
        console.log(`✅ [SOCKET] Clients in ${roomName}: ${clientCount}`);
        
        socket.emit("joinedGroup", { groupId });
        console.log(`✅ [SOCKET] Emitted joinedGroup event to user ${userId}`);
      } catch (error: any) {
        console.error("Error joining group:", error);
        socket.emit("error", { message: "Failed to join group" });
      }
    });

    // Leave Group Room
    socket.on("leaveGroup", (groupId: string) => {
      const roomName = `group_${groupId}`;
      socket.leave(roomName);
      
      const room = io?.sockets.adapter.rooms.get(roomName);
      const clientCount = room?.size || 0;
      console.log(`✅ [SOCKET] User ${userId} left group room: ${roomName}`);
      console.log(`✅ [SOCKET] Clients remaining in ${roomName}: ${clientCount}`);
      
      socket.emit("leftGroup", { groupId });
    });

    // Typing Indicator - Private Chat
    socket.on("typing", async (data: { receiverId?: string; groupId?: string }) => {
      try {
        const { receiverId, groupId } = data;

        if (receiverId) {
          // Private chat typing
          if (!mongoose.Types.ObjectId.isValid(receiverId)) {
            return;
          }

          const user = await User.findById(userId);
          if (!user || !user.connections?.some((connId: any) => connId.toString() === receiverId)) {
            return;
          }

          const key = `private_${userId}_${receiverId}`;
          if (!typingUsers.has(key)) {
            typingUsers.set(key, new Set());
          }
          typingUsers.get(key)!.add(userId);

          if (io) {
            console.log(`⚡ [SOCKET] Emitting typing indicator to user_${receiverId}`);
            io.to(`user_${receiverId}`).emit("typing", {
              userId,
              receiverId,
              isTyping: true,
            });
          }

          // Clear typing after 3 seconds
          setTimeout(() => {
            const typingSet = typingUsers.get(key);
            if (typingSet) {
              typingSet.delete(userId);
              if (typingSet.size === 0) {
                typingUsers.delete(key);
              }
            }
            if (io) {
              io.to(`user_${receiverId}`).emit("typing", {
                userId,
                receiverId,
                isTyping: false,
              });
            }
          }, 3000);
        } else if (groupId) {
          // Group chat typing
          if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return;
          }

          const group = await CommunityGroup.findById(groupId);
          if (!group || !group.members.some((member: any) => member.user.toString() === userId)) {
            return;
          }

          const key = `group_${groupId}`;
          if (!typingUsers.has(key)) {
            typingUsers.set(key, new Set());
          }
          typingUsers.get(key)!.add(userId);

          console.log(`⚡ [SOCKET] Emitting groupTyping indicator to group_${groupId}`);
          socket.to(`group_${groupId}`).emit("groupTyping", {
            userId,
            groupId,
            isTyping: true,
          });

          // Clear typing after 3 seconds
          setTimeout(() => {
            const typingSet = typingUsers.get(key);
            if (typingSet) {
              typingSet.delete(userId);
              if (typingSet.size === 0) {
                typingUsers.delete(key);
              }
            }
            socket.to(`group_${groupId}`).emit("groupTyping", {
              userId,
              groupId,
              isTyping: false,
            });
          }, 3000);
        }
      } catch (error: any) {
        console.error("Error handling typing indicator:", error);
      }
    });

    // Stop Typing
    socket.on("stopTyping", (data: { receiverId?: string; groupId?: string }) => {
      const { receiverId, groupId } = data;

      if (receiverId) {
        const key = `private_${userId}_${receiverId}`;
        const typingSet = typingUsers.get(key);
        if (typingSet) {
          typingSet.delete(userId);
          if (typingSet.size === 0) {
            typingUsers.delete(key);
          }
        }
        if (io) {
          io.to(`user_${receiverId}`).emit("typing", {
            userId,
            receiverId,
            isTyping: false,
          });
        }
      } else if (groupId) {
        const key = `group_${groupId}`;
        const typingSet = typingUsers.get(key);
        if (typingSet) {
          typingSet.delete(userId);
          if (typingSet.size === 0) {
            typingUsers.delete(key);
          }
        }
        socket.to(`group_${groupId}`).emit("groupTyping", {
          userId,
          groupId,
          isTyping: false,
        });
      }
    });

    // Mark messages as read (for real-time read receipts)
    socket.on("markMessagesRead", async (data: { messageIds: string[]; receiverId?: string; groupId?: string }) => {
      try {
        const { messageIds, receiverId, groupId } = data;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return;
        }

        // Validate message IDs
        const validIds = messageIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validIds.length === 0) {
          return;
        }

        // Validate and mark messages as read
        const Message = (await import("./models/Message")).default;
        
        // Build filter
        const filter: any = {
          _id: { $in: validIds },
          isDeleted: false,
        };

        if (receiverId) {
          // For private messages: verify user is the receiver
          if (userId !== receiverId) {
            socket.emit("error", { message: "You can only mark messages sent to you as read." });
            return;
          }
          filter.receiver = receiverId;
        } else if (groupId) {
          // For group messages: verify user is a member
          const group = await CommunityGroup.findById(groupId);
          if (!group) {
            socket.emit("error", { message: "Group not found." });
            return;
          }
          const isMember = group.members.some(
            (member: any) => member.user.toString() === userId
          );
          if (!isMember) {
            socket.emit("error", { message: "You must be a member of the group." });
            return;
          }
          filter.group = groupId;
        } else {
          socket.emit("error", { message: "Either receiverId or groupId is required." });
          return;
        }

        // Update messages
        await Message.updateMany(
          {
            ...filter,
            readBy: { $ne: userId },
          },
          {
            $addToSet: { readBy: userId },
          }
        );

        // Notify senders/receivers
        if (receiverId) {
          // For private messages: notify the sender(s)
          const messages = await Message.find({ _id: { $in: validIds }, receiver: receiverId }).select("sender");
          const senderIds = [...new Set(messages.map(m => m.sender.toString()))];
          
          const socketIO = io;
          if (socketIO) {
            senderIds.forEach(senderId => {
              socketIO.to(`user_${senderId}`).emit("messagesRead", {
                messageIds: validIds,
                readBy: userId,
                receiverId,
              });
            });
          }
        } else if (groupId) {
          // For group messages: notify all group members
          if (io) {
            io.to(`group_${groupId}`).emit("groupMessagesRead", {
              messageIds: validIds,
              readBy: userId,
              groupId,
            });
          }
        }
      } catch (error: any) {
        console.error("Error marking messages as read:", error);
        socket.emit("error", { message: "Failed to mark messages as read." });
      }
    });

    // Get online status
    socket.on("getOnlineStatus", async (data: { userIds: string[] }) => {
      try {
        const { userIds } = data;
        const statuses: { [userId: string]: boolean } = {};

        userIds.forEach((uid) => {
          statuses[uid] = onlineUsers.has(uid) && onlineUsers.get(uid)!.size > 0;
        });

        socket.emit("onlineStatus", statuses);
      } catch (error: any) {
        console.error("Error getting online status:", error);
      }
    });

    // Disconnect handling
    socket.on("disconnect", async (reason) => {
      console.log(`⚠️ [SOCKET] User disconnected: ${userId} (socket: ${socket.id}), reason: ${reason}`);

      // Remove socket from online users
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);

          // Notify connections that user is offline
          try {
            const user = await User.findById(userId);
            const socketIO = io;
            if (user && user.connections && user.connections.length > 0 && socketIO) {
              user.connections.forEach((connId: mongoose.Types.ObjectId) => {
                socketIO.to(`user_${connId.toString()}`).emit("userOffline", { userId });
              });
            }
          } catch (error) {
            console.error("Error notifying offline status:", error);
          }
        }
      }

      socketToUser.delete(socket.id);

      // Clear typing indicators
      typingUsers.forEach((typingSet, key) => {
        typingSet.delete(userId);
        if (typingSet.size === 0) {
          typingUsers.delete(key);
        }
      });
    });

    // Error handling
    socket.on("error", (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });

  console.log("✅ [SOCKET] Socket.IO server initialized successfully");
  console.log(`✅ [SOCKET] Server ready to accept connections on port ${server.address()}`);
}

// Helper function to check if user is online
export const isUserOnline = (userId: string): boolean => {
  return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
};

// Helper function to get online users count
export const getOnlineUsersCount = (): number => {
  return onlineUsers.size;
};

// Safe getter for io instance
export const getIO = (): Server | undefined => {
  return io;
};

export { io };
