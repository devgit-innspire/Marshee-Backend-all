// controllers/chatController.ts
import { Response } from "express";
import mongoose from "mongoose";
import Message from "../models/Message";
import User from "../models/User";
import CommunityGroup from "../models/communityGroup";
import { io, getIO } from "../socket";
import { AuthRequest } from "../middlewares/auth";
import { isBlocked } from "./blockController";
import { hasPermission } from "../utils/groupPermissions";
import { createNotification } from "../services/notificationService";

const getCurrentUserId = (req: AuthRequest): string | null => {
  const user: any = req.user;
  if (!user) {
    return null;
  }

  if (user._id) {
    return user._id.toString();
  }

  if (user.id) {
    return typeof user.id === "string" ? user.id : user.id.toString();
  }

  return null;
};

// Send Message (supports both private and group messages)
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const {
      content,
      attachments,
      receiverId,
      groupId: groupIdFromBody,
      type,
      replyTo,
      forwardedFrom,
      mentionedUserIds,
    } = req.body;

    console.log("req.body:-", req.body);

    const groupId = groupIdFromBody || req.params?.groupId;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    // Validate input
    if (!receiverId && !groupId) {
      return res.status(400).json({
        success: false,
        message: "Either receiverId or groupId is required."
      });
    }

    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Message content or attachments are required."
      });
    }

    if (content && content.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Message content cannot exceed 5000 characters."
      });
    }

    // Validate attachments if provided
    if (attachments && Array.isArray(attachments)) {
      for (const attachment of attachments) {
        if (!attachment.url || !attachment.type) {
          return res.status(400).json({
            success: false,
            message: "Each attachment must have a URL and type."
          });
        }
        
        if (!["image", "video", "file"].includes(attachment.type)) {
          return res.status(400).json({
            success: false,
            message: "Attachment type must be 'image', 'video', or 'file'."
          });
        }
      }
    }

    // Authorization and validation based on message type
    if (receiverId) {
      // Private message validation
      if (!mongoose.Types.ObjectId.isValid(receiverId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid receiver ID format."
        });
      }

      // Check if receiver exists
      const receiver = await User.findById(receiverId);
      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: "Receiver not found."
        });
      }

      // Check if users are connected (for private messages)
      const sender = await User.findById(currentUserId);
      if (!sender) {
        return res.status(404).json({
          success: false,
          message: "Sender not found."
        });
      }

      const isConnected = sender.connections?.some((connId: any) => connId.toString() === receiverId);

      if (!isConnected) {
        return res.status(403).json({
          success: false,
          message: "You can only send messages to connected users."
        });
      }

      // Check if users have blocked each other
      const usersAreBlocked = await isBlocked(currentUserId, receiverId);
      if (usersAreBlocked) {
        return res.status(403).json({
          success: false,
          message: "You cannot send messages to this user."
        });
      }
    } else if (groupId) {
      // Group message validation
      if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid group ID format."
        });
      }

      // Check if group exists and user is a member
      const group = await CommunityGroup.findById(groupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          message: "Group not found."
        });
      }
      const isMember = group.members.some(member => member.user.toString() === currentUserId);

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "You must be a member of the group to send messages."
        });
      }
    }

    // Validate replyTo and forwardedFrom if provided
    if (replyTo && !mongoose.Types.ObjectId.isValid(replyTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid replyTo message ID."
      });
    }

    if (forwardedFrom && !mongoose.Types.ObjectId.isValid(forwardedFrom)) {
      return res.status(400).json({
        success: false,
        message: "Invalid forwardedFrom message ID."
      });
    }

    // Validate and normalize mentioned user IDs
    let mentionIds: mongoose.Types.ObjectId[] = [];
    if (mentionedUserIds && Array.isArray(mentionedUserIds)) {
      const validIds = mentionedUserIds
        .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
        .map((id: string) => new mongoose.Types.ObjectId(id));
      mentionIds = [...new Set(validIds.map((id) => id.toString()))].map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      if (groupId) {
        const group = await CommunityGroup.findById(groupId).select("members").lean();
        const memberIds = new Set(
          (group?.members || []).map((m: any) => m.user?.toString())
        );
        mentionIds = mentionIds.filter((id) => memberIds.has(id.toString()));
      } else if (receiverId) {
        // Private chat: only the receiver can be "mentioned" (optional)
        mentionIds = mentionIds.filter((id) => id.toString() === receiverId);
      }
    }

    // Create message
    const message = await Message.create({
      sender: currentUserId,
      receiver: receiverId,
      group: groupId,
      content: content?.trim(),
      attachments,
      type: type || (attachments?.length > 0 ? attachments[0].type : "text"),
      replyTo,
      forwardedFrom,
      mentions: mentionIds.length > 0 ? mentionIds : undefined,
    });

    // Populate message with sender details
    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "name email phoneNumber avatar")
      .populate("receiver", "name email phoneNumber")
      .populate("group", "name")
      .populate("replyTo", "content sender")
      .populate("forwardedFrom", "content sender")
      .populate("mentions", "name email avatar");

    if (!populatedMessage) {
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve message after creation."
      });
    }

    // Notify the original message author when someone replies to their message
    if (replyTo) {
      console.log("[CHAT] Notifying original message author when someone replies to their message with replyTo:", replyTo);
      try {
        const originalMessage = await Message.findById(replyTo).select("sender").lean();
        if (originalMessage?.sender) {
          const originalSenderId = originalMessage.sender.toString();
          if (originalSenderId !== currentUserId) {
            await createNotification({
              recipientId: originalSenderId,
              actorId: currentUserId,
              type: "reply_message",
              messageId: (message._id as mongoose.Types.ObjectId).toString(),
              groupId: groupId || undefined,
            });
          }
        }
      } catch (notifErr) {
        console.error("Error creating reply_message notification:", notifErr);
      }
    }

    // Notify each mentioned user (except sender)
    for (const mentionedUserId of mentionIds) {
      if (mentionedUserId.toString() === currentUserId) continue;
      try {
        await createNotification({
          recipientId: mentionedUserId.toString(),
          actorId: currentUserId,
          type: "mention_message",
          messageId: (message._id as mongoose.Types.ObjectId).toString(),
          groupId: groupId || undefined,
        });
      } catch (notifErr) {
        console.error("Error creating mention_message notification:", notifErr);
      }
    }

    // Notify receiver for new private message (push when app is closed). Reply case already handled above.
    if (receiverId && !replyTo) {
      try {
        await createNotification({
          recipientId: receiverId,
          actorId: currentUserId,
          type: "new_message",
          messageId: (message._id as mongoose.Types.ObjectId).toString(),
        });
      } catch (notifErr) {
        console.error("Error creating new_message notification:", notifErr);
      }
    }

    // Notify other group members for new group message (push when app is closed). Reply/mention already handled above.
    if (groupId) {
      try {
        const group = await CommunityGroup.findById(groupId).select("members").lean();
        if (group?.members?.length) {
          const senderId = currentUserId?.toString();
          const originalSenderId = replyTo
            ? (await Message.findById(replyTo).select("sender").lean())?.sender?.toString()
            : null;
          const alreadyNotified = new Set<string>([senderId].filter(Boolean));
          if (originalSenderId) alreadyNotified.add(originalSenderId);
          mentionIds.forEach((id) => alreadyNotified.add(id.toString()));

          const memberIds = group.members
            .map((m: any) => m?.user?.toString?.() ?? m?.user)
            .filter((id: string) => id && !alreadyNotified.has(id));

          if (memberIds.length > 0) {
            const members = await User.find({ _id: { $in: memberIds } }).select("_id blockedUsers").lean();
            const blockedMap = new Map<string, boolean>();
            members.forEach((u: any) => {
              const uid = u._id.toString();
              blockedMap.set(uid, (u.blockedUsers || []).some((bid: any) => bid?.toString() === senderId));
            });

            for (const memberId of memberIds) {
              if (blockedMap.get(memberId)) continue;
              await createNotification({
                recipientId: memberId,
                actorId: currentUserId,
                type: "new_group_message",
                messageId: (message._id as mongoose.Types.ObjectId).toString(),
                groupId,
              });
            }
          }
        }
      } catch (notifErr) {
        console.error("Error creating new_group_message notifications:", notifErr);
      }
    }

    // Broadcast message via socket.io (only if io is initialized)
    const socketIO = getIO();
    if (socketIO) {
      // Convert Mongoose document to plain object for socket emission
      const messageData = populatedMessage.toObject ? populatedMessage.toObject() : JSON.parse(JSON.stringify(populatedMessage));
      
      // Ensure groupId is included at top level for easier access
      if (groupId) {
        messageData.groupId = groupId.toString();
      }
      if (receiverId) {
        messageData.receiverId = receiverId.toString();
      }
      if (currentUserId) {
        messageData.senderId = currentUserId.toString();
      }
      
      if (groupId) {
        const roomName = `group_${groupId}`;
        const clientsInRoom = socketIO.sockets.adapter.rooms.get(roomName)?.size || 0;
        
        console.log(`⚡ [SOCKET] About to emit groupMessage`);
        console.log(`⚡ [SOCKET] Room: ${roomName}`);
        console.log(`⚡ [SOCKET] Socket.IO instance: initialized`);
        console.log(`⚡ [SOCKET] Clients in room: ${clientsInRoom}`);
        console.log(`⚡ [SOCKET] Message data:`, {
          messageId: messageData._id || messageData.id,
          groupId: messageData.groupId || messageData.group?._id || messageData.group?.id,
          sender: messageData.sender?._id || messageData.sender?.id,
          content: messageData.content?.substring(0, 50),
        });
        
        // Get group members and filter out users who have blocked the sender
        try {
          const group = await CommunityGroup.findById(groupId);
          if (group && group.members) {
            const senderId = currentUserId?.toString();
            const memberUserIds = group.members
              .map((member: any) => member.user?.toString())
              .filter((id: string) => id && id !== senderId);
            
            if (memberUserIds.length > 0) {
              // Fetch all members' blocked lists in one query
              const members = await User.find({
                _id: { $in: memberUserIds }
              }).select("_id blockedUsers");
              
              // Create a map for quick lookup
              const blockedMap = new Map<string, boolean>();
              members.forEach((member: any) => {
                const memberId = member._id.toString();
                const hasBlocked = member.blockedUsers?.some(
                  (blockedId: any) => blockedId.toString() === senderId
                ) || false;
                blockedMap.set(memberId, hasBlocked);
              });
              
              // Emit to each member individually, excluding those who blocked the sender
              let emittedCount = 0;
              for (const memberUserId of memberUserIds) {
                if (blockedMap.get(memberUserId)) {
                  // Skip this user - they've blocked the sender
                  continue;
                }
                
                // Emit to this user's private room
                const userRoom = `user_${memberUserId}`;
                socketIO.to(userRoom).emit("groupMessage", messageData);
                emittedCount++;
              }
              
              console.log(`✅ [SOCKET] groupMessage emitted to ${emittedCount} users (excluding ${memberUserIds.length - emittedCount} blocked)`);
            } else {
              console.log(`✅ [SOCKET] No members to emit to (only sender in group)`);
            }
          } else {
            // Fallback: emit to group room if we can't get members
            socketIO.to(roomName).emit("groupMessage", messageData);
            console.log(`✅ [SOCKET] groupMessage emitted to room ${roomName} (fallback)`);
          }
        } catch (error) {
          console.error(`❌ [SOCKET] Error filtering group message:`, error);
          // Fallback: emit to group room on error
          socketIO.to(roomName).emit("groupMessage", messageData);
          console.log(`✅ [SOCKET] groupMessage emitted to room ${roomName} (error fallback)`);
        }
        
        if (clientsInRoom === 0) {
          console.warn(`⚠️ [SOCKET] No clients in room ${roomName}! Message may not be delivered.`);
        }
      } else if (receiverId) {
        const senderRoom = `user_${currentUserId}`;
        const receiverRoom = `user_${receiverId}`;
        const clientsInSenderRoom = socketIO.sockets.adapter.rooms.get(senderRoom)?.size || 0;
        const clientsInReceiverRoom = socketIO.sockets.adapter.rooms.get(receiverRoom)?.size || 0;
        
        console.log(`⚡ [SOCKET] About to emit privateMessage`);
        console.log(`⚡ [SOCKET] Rooms: ${senderRoom} (${clientsInSenderRoom} clients) and ${receiverRoom} (${clientsInReceiverRoom} clients)`);
        console.log(`⚡ [SOCKET] Socket.IO instance: initialized`);
        console.log(`⚡ [SOCKET] Message data:`, {
          messageId: messageData._id || messageData.id,
          senderId: messageData.senderId || messageData.sender?._id || messageData.sender?.id,
          receiverId: messageData.receiverId || messageData.receiver?._id || messageData.receiver?.id,
          content: messageData.content?.substring(0, 50),
        });
        
        // Check if users have blocked each other before emitting
        try {
          // Fetch both users' blocked lists to check individually
          const [sender, receiver] = await Promise.all([
            User.findById(currentUserId).select("blockedUsers"),
            User.findById(receiverId).select("blockedUsers")
          ]);
          
          const senderIdStr = currentUserId?.toString();
          const receiverIdStr = receiverId?.toString();
          
          // Check if receiver has blocked sender
          const receiverBlockedSender = receiver?.blockedUsers?.some(
            (blockedId: any) => blockedId.toString() === senderIdStr
          ) || false;
          
          // Check if sender has blocked receiver
          const senderBlockedReceiver = sender?.blockedUsers?.some(
            (blockedId: any) => blockedId.toString() === receiverIdStr
          ) || false;
          
          // If either user has blocked the other, don't emit to either
          if (receiverBlockedSender || senderBlockedReceiver) {
            console.warn(`⚠️ [SOCKET] Blocking detected - not emitting privateMessage`);
            console.warn(`⚠️ [SOCKET] Receiver blocked sender: ${receiverBlockedSender}, Sender blocked receiver: ${senderBlockedReceiver}`);
            console.warn(`⚠️ [SOCKET] Sender: ${currentUserId}, Receiver: ${receiverId}`);
            // Don't emit to either user if blocking exists
            return;
          }
          
          // Emit to both rooms (both users haven't blocked each other)
          socketIO.to(receiverRoom).emit("privateMessage", messageData);
          socketIO.to(senderRoom).emit("privateMessage", messageData);
          
          // Warn if no clients in rooms
          if (clientsInReceiverRoom === 0) {
            console.warn(`⚠️ [SOCKET] No clients in receiver room ${receiverRoom}!`);
          }
          if (clientsInSenderRoom === 0) {
            console.warn(`⚠️ [SOCKET] No clients in sender room ${senderRoom}!`);
          }
          
          console.log(`✅ [SOCKET] privateMessage emitted successfully to both rooms (blocking check passed)`);
        } catch (error) {
          console.error(`❌ [SOCKET] Error checking blocked users for private message:`, error);
          // Fallback: emit to both rooms if check fails (defensive approach)
          socketIO.to(receiverRoom).emit("privateMessage", messageData);
          socketIO.to(senderRoom).emit("privateMessage", messageData);
          console.log(`✅ [SOCKET] privateMessage emitted to both rooms (error fallback)`);
        }
      }
    } else {
      console.error(`❌ [SOCKET] Socket.IO instance not initialized! Cannot emit message.`);
      console.error(`❌ [SOCKET] Socket.IO instance: NOT INITIALIZED`);
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: populatedMessage
    });

  } catch (err: any) {
    console.error("Error sending message:", err);
    
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((error: any) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error occurred.",
        errors: process.env.NODE_ENV === "development" ? errors : undefined
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Group Messages
export const getGroupMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const currentUserId = getCurrentUserId(req);

    console.log("[CHAT] getGroupMessages called with:", { groupId, page, limit, before, currentUserId });

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    // Validate group ID
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Valid group ID is required."
      });
    }

    // Validate pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Page must be a positive integer."
      });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be a positive integer between 1 and 100."
      });
    }

    // Check if group exists and user is a member
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    const isMember = group.members.some(member => member.user.toString() === currentUserId);

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of the group to view messages."
      });
    }

    // Get current user's blocked users list
    const currentUser = await User.findById(currentUserId).select("blockedUsers");
    const blockedUserIds = currentUser?.blockedUsers?.map((id: any) => id.toString()) || [];

    // Build filter
    const filter: any = { 
      group: groupId, 
      isDeleted: false 
    };

    // Exclude messages from blocked users
    if (blockedUserIds.length > 0) {
      filter.sender = { $nin: currentUser!.blockedUsers };
    }

    if (before && mongoose.Types.ObjectId.isValid(before as string)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(before as string) };
    }

    // Get messages with pagination
    const total = await Message.countDocuments(filter);
    const messages = await Message.find(filter)
      .populate("sender", "name email avatar phoneNumber")
      .populate("replyTo", "content sender")
      .populate("forwardedFrom", "content sender")
      .populate("mentions", "name email avatar")
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      message: "Group messages retrieved successfully.",
      data: {
        messages,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMessages: total,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (err: any) {
    console.error("Error fetching group messages:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Pinned Messages for a group
export const getPinnedMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Valid group ID is required."
      });
    }

    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    const isMember = group.members.some(member => member.user.toString() === currentUserId);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of the group to view pinned messages."
      });
    }

    const currentUser = await User.findById(currentUserId).select("blockedUsers");
    const blockedUserIds = currentUser?.blockedUsers?.map((id: any) => id.toString()) || [];

    const filter: any = {
      group: groupId,
      isDeleted: false,
      isPinned: true
    };

    if (blockedUserIds.length > 0) {
      filter.sender = { $nin: currentUser!.blockedUsers };
    }

    const messages = await Message.find(filter)
      .populate("sender", "name email avatar phoneNumber")
      .populate("pinnedBy", "name email avatar phoneNumber")
      .populate("replyTo", "content sender")
      .populate("mentions", "name email avatar")
      .sort({ pinnedAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Pinned messages retrieved successfully.",
      data: messages
    });
  } catch (err: any) {
    console.error("Error fetching pinned messages:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Get Private Messages
export const getPrivateMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    // Validate user ID
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID is required."
      });
    }

    // Validate pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Page must be a positive integer."
      });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit must be a positive integer between 1 and 100."
      });
    }

    // Check if the other user exists
    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    // Check if users are connected
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Current user not found."
      });
    }

    const isConnected = currentUser.connections?.some(
      (connId: any) => connId.toString() === userId
    );

    if (!isConnected) {
      return res.status(403).json({
        success: false,
        message: "You can only view messages with connected users."
      });
    }

    // Check if users have blocked each other
    const usersAreBlocked = await isBlocked(currentUserId, userId);
    if (usersAreBlocked) {
      return res.status(403).json({
        success: false,
        message: "You cannot view messages with this user."
      });
    }

    // Build filter
    const filter: any = {
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId },
      ],
      isDeleted: false
    };

    if (before && mongoose.Types.ObjectId.isValid(before as string)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(before as string) };
    }

    // Get messages with pagination
    const total = await Message.countDocuments(filter);
    const messages = await Message.find(filter)
      .populate("sender", "name email phoneNumber avatar")
      .populate("receiver", "name email phoneNumber avatar")
      .populate("replyTo", "content sender")
      .populate("forwardedFrom", "content sender")
      .populate("mentions", "name email avatar")
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      message: "Private messages retrieved successfully.",
      data: {
        messages,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMessages: total,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (err: any) {
    console.error("Error fetching private messages:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Mark Message as Read (supports both private and group messages)
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Valid message ID is required."
      });
    }

    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Message not found."
      });
    }

    // For private messages: check if user is the receiver
    if (message.receiver) {
      if (message.receiver.toString() !== currentUserId) {
        return res.status(403).json({
          success: false,
          message: "You can only mark messages sent to you as read."
        });
      }
    }
    // For group messages: check if user is a member
    else if (message.group) {
      const group = await CommunityGroup.findById(message.group);
      if (!group) {
        return res.status(404).json({
          success: false,
          message: "Group not found."
        });
      }

      const isMember = group.members.some(
        (member: any) => member.user.toString() === currentUserId
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "You must be a member of the group to mark messages as read."
        });
      }

      // Don't allow marking own messages as read in groups
      if (message.sender.toString() === currentUserId) {
        return res.status(403).json({
          success: false,
          message: "You cannot mark your own messages as read."
        });
      }
    }

    // Check if already read
    const alreadyRead = message.readBy.some(id => id.toString() === currentUserId);

    if (!alreadyRead) {
      message.readBy.push(new mongoose.Types.ObjectId(currentUserId));
      await message.save();

      // Broadcast read receipt via socket.io
      const socketIO = getIO();
      if (socketIO) {
        const messageId = String(message._id);
        if (message.receiver) {
          // Private message read receipt
          console.log(`⚡ [SOCKET] Emitting messageRead to user_${message.sender.toString()}`);
          socketIO.to(`user_${message.sender.toString()}`).emit("messageRead", {
            messageId: messageId,
            readBy: currentUserId,
            receiverId: message.receiver.toString(),
          });
          console.log(`✅ [SOCKET] messageRead emitted successfully`);
        } else if (message.group) {
          // Group message read receipt
          console.log(`⚡ [SOCKET] Emitting groupMessageRead to group_${message.group.toString()}`);
          socketIO.to(`group_${message.group.toString()}`).emit("groupMessageRead", {
            messageId: messageId,
            readBy: currentUserId,
            groupId: message.group.toString(),
          });
          console.log(`✅ [SOCKET] groupMessageRead emitted successfully`);
        }
      } else {
        console.error(`❌ [SOCKET] Socket.IO instance not initialized! Cannot emit read receipt.`);
      }
    }

    const populatedMessage = await Message.findById(messageId)
      .populate("sender", "name email phoneNumber avatar")
      .populate("receiver", "name email phoneNumber avatar")
      .populate("group", "name")
      .populate("readBy", "name email avatar");

    return res.status(200).json({
      success: true,
      message: "Message marked as read.",
      data: populatedMessage
    });

  } catch (err: any) {
    console.error("Error marking message as read:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Mark Multiple Messages as Read
export const markMultipleAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { messageIds, receiverId, groupId } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Valid array of message IDs is required."
      });
    }

    // Validate all message IDs
    const validIds = messageIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid message IDs provided."
      });
    }

    // Build filter
    const filter: any = {
      _id: { $in: validIds },
      isDeleted: false,
    };

    if (receiverId) {
      filter.receiver = receiverId;
      // Verify user is the receiver (current user should be the receiverId)
      if (currentUserId !== receiverId) {
        return res.status(403).json({
          success: false,
          message: "You can only mark messages sent to you as read."
        });
      }
    } else if (groupId) {
      filter.group = groupId;
      // Verify user is a group member
      const group = await CommunityGroup.findById(groupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          message: "Group not found."
        });
      }

      const isMember = group.members.some(
        (member: any) => member.user.toString() === currentUserId
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "You must be a member of the group to mark messages as read."
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Either receiverId or groupId is required."
      });
    }

    // Update messages
    const result = await Message.updateMany(
      {
        ...filter,
        readBy: { $ne: currentUserId },
      },
      {
        $addToSet: { readBy: currentUserId },
      }
    );

    // Broadcast read receipts via socket.io
    const socketIO = getIO();
    if (socketIO && result.modifiedCount > 0) {
      if (receiverId) {
        // Get sender IDs from updated messages
        const messages = await Message.find(filter).select("sender");
        const senderIds = [...new Set(messages.map(m => m.sender.toString()))];
        
        senderIds.forEach(senderId => {
          socketIO.to(`user_${senderId}`).emit("messagesRead", {
            messageIds: validIds,
            readBy: currentUserId,
            receiverId,
          });
        });
      } else if (groupId) {
        socketIO.to(`group_${groupId}`).emit("groupMessagesRead", {
          messageIds: validIds,
          readBy: currentUserId,
          groupId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} message(s) marked as read.`,
      data: {
        markedCount: result.modifiedCount,
        totalCount: validIds.length,
      }
    });

  } catch (err: any) {
    console.error("Error marking messages as read:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Delete Message
export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Valid message ID is required."
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found."
      });
    }

    // Authorization check - only sender can delete
    if (message.sender.toString() !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages."
      });
    }

    // Soft delete
    message.isDeleted = true;
    await message.save();

    // Broadcast deletion via socket.io
    const socketIO = getIO();
    if (socketIO) {
      const messageId = String(message._id);
      if (message.group) {
        // Group message deletion
        socketIO.to(`group_${message.group.toString()}`).emit("messageDeleted", {
          messageId: messageId,
          groupId: message.group.toString(),
          deletedBy: currentUserId,
        });
      } else if (message.receiver) {
        // Private message deletion
        socketIO.to(`user_${message.receiver.toString()}`).emit("messageDeleted", {
          messageId: messageId,
          receiverId: message.receiver.toString(),
          deletedBy: currentUserId,
        });
        socketIO.to(`user_${message.sender.toString()}`).emit("messageDeleted", {
          messageId: messageId,
          receiverId: message.receiver.toString(),
          deletedBy: currentUserId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully."
    });

  } catch (err: any) {
    console.error("Error deleting message:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// Add Reaction to Message
export const addReaction = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Valid message ID is required."
      });
    }

    if (!emoji || typeof emoji !== "string" || emoji.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Valid emoji is required (max 10 characters)."
      });
    }

    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Message not found."
      });
    }

    // Authorization check
    if (message.receiver) {
      // Private message: check if user is sender or receiver
      const isParticipant = 
        message.sender.toString() === currentUserId || 
        message.receiver.toString() === currentUserId;
      
      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          message: "You can only react to messages in your conversations."
        });
      }
    } else if (message.group) {
      // Group message: check if user is a member
      const group = await CommunityGroup.findById(message.group);
      if (!group) {
        return res.status(404).json({
          success: false,
          message: "Group not found."
        });
      }

      const isMember = group.members.some(
        (member: any) => member.user.toString() === currentUserId
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "You must be a member of the group to react to messages."
        });
      }
    }

    // Remove existing reaction from this user
    message.reactions = message.reactions.filter(
      reaction => reaction.user.toString() !== currentUserId
    );

    // Add new reaction
    message.reactions.push({
      user: new mongoose.Types.ObjectId(currentUserId),
      emoji,
      createdAt: new Date()
    });

    await message.save();

    const updatedMessage = await Message.findById(messageId)
      .populate("sender", "name email phoneNumber avatar")
      .populate("reactions.user", "name email phoneNumber avatar")
      .populate("receiver", "name email phoneNumber avatar")
      .populate("group", "name");

    // Broadcast reaction via socket.io
    const socketIO = getIO();
    if (socketIO) {
      if (message.group) {
        socketIO.to(`group_${message.group.toString()}`).emit("messageReaction", updatedMessage);
      } else if (message.receiver) {
        socketIO.to(`user_${message.sender.toString()}`).emit("messageReaction", updatedMessage);
        socketIO.to(`user_${message.receiver.toString()}`).emit("messageReaction", updatedMessage);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Reaction added successfully.",
      data: updatedMessage
    });

  } catch (err: any) {
    console.error("Error adding reaction:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const pinGroupMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId, messageId } = req.params;
    const { pinned } = req.body;
    const userId = getCurrentUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid group ID." });
    }
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }
    if (typeof pinned !== "boolean") {
      return res.status(400).json({ success: false, message: "Body must include pinned: true or false." });
    }

    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }
    if (!hasPermission(group, userId, "pin_messages", { platformRole: req.user?.role })) {
      return res.status(403).json({
        success: false,
        message: "Only group admins and moderators can pin messages.",
      });
    }

    const message = await Message.findOne({ _id: messageId, group: groupId });
    if (!message || message.isDeleted) {
      return res.status(404).json({ success: false, message: "Message not found in this group." });
    }

    if (pinned) {
      await Message.updateMany(
        { group: groupId, isPinned: true, _id: { $ne: messageId } },
        { $set: { isPinned: false }, $unset: { pinnedAt: 1, pinnedBy: 1 } }
      );
      message.isPinned = true;
      message.pinnedAt = new Date();
      message.pinnedBy = new mongoose.Types.ObjectId(userId);
      await message.save();
    } else {
      message.isPinned = false;
      message.pinnedAt = undefined;
      message.pinnedBy = undefined;
      await message.save();
    }

    const updated = await Message.findById(messageId)
      .populate("sender", "name email phoneNumber avatar")
      .populate("pinnedBy", "name email phoneNumber avatar")
      .populate("group", "name");

    const socketIO = getIO();
    if (socketIO) {
      socketIO.to(`group_${groupId}`).emit("messagePinned", updated?.toObject?.() ?? updated);
    }

    return res.status(200).json({
      success: true,
      message: pinned ? "Message pinned." : "Message unpinned.",
      data: updated,
    });
  } catch (err: any) {
    console.error("Error pinning message:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};