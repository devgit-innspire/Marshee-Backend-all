import { Request, Response } from "express";
import Poll from "../models/Poll";
import CommunityGroup from "../models/communityGroup"; // Make sure this import is correct
import { getIO } from "../socket";
import mongoose from "mongoose";

interface AuthRequest extends Request {
  user?: { id: string; [key: string]: any };
}

// Helper function to format poll with vote counts and user vote status
const formatPollForSocket = (poll: any, userId?: string) => {
  const pollObj = poll.toObject ? poll.toObject() : poll;
  
  // Ensure group field is preserved correctly
  let groupData = pollObj.group;
  if (groupData && typeof groupData === 'object') {
    // Ensure group has _id field
    if (!groupData._id && poll.group) {
      if (typeof poll.group === 'object' && poll.group._id) {
        groupData._id = poll.group._id;
      } else if (typeof poll.group === 'string') {
        groupData = { _id: poll.group, name: groupData.name || '' };
      }
    }
  }
  
  return {
    ...pollObj,
    group: groupData, // Ensure group is preserved
    groupId: groupData?._id?.toString() || groupData?._id || (typeof groupData === 'string' ? groupData : pollObj.groupId),
    options: poll.options.map((opt: any, index: number) => {
      const populatedVotes = pollObj.options[index]?.votes || [];
      return {
        text: opt.text,
        voteCount: populatedVotes.length,
        votes: populatedVotes.map((vote: any) => ({
          _id: vote._id || vote,
          name: vote.name,
          email: vote.email,
          phoneNumber: vote.phoneNumber,
          avatar: vote.avatar
        })),
        hasVoted: userId ? populatedVotes.some((vote: any) => {
          const voteId = vote._id?.toString() || vote.toString();
          return voteId === userId;
        }) : false
      };
    }),
    totalVotes: poll.options.reduce((sum: number, opt: any, index: number) => {
      const populatedVotes = pollObj.options[index]?.votes || [];
      return sum + populatedVotes.length;
    }, 0),
    hasUserVoted: userId ? poll.options.some((opt: any, index: number) => {
      const populatedVotes = pollObj.options[index]?.votes || [];
      return populatedVotes.some((vote: any) => {
        const voteId = vote._id?.toString() || vote.toString();
        return voteId === userId;
      });
    }) : false,
    isExpired: poll.expiresAt ? new Date() > poll.expiresAt : false
  };
};

export const createPoll = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { question, options, expiresAt, allowMultiple } = req.body;

    // Input validation
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Valid group ID is required."
      });
    }

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Question is required and must be at least 3 characters long."
      });
    }

    if (!options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        success: false,
        message: "At least 2 options are required."
      });
    }

    // Validate each option
    const validOptions = options.filter(opt => 
      typeof opt === "string" && opt.trim().length > 0
    );
    
    if (validOptions.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Each option must be a non-empty string."
      });
    }

    // Check for duplicate options (case-insensitive)
    const optionSet = new Set(validOptions.map(opt => opt.toLowerCase().trim()));
    if (optionSet.size !== validOptions.length) {
      return res.status(400).json({
        success: false,
        message: "Duplicate options are not allowed."
      });
    }

    // Validate expiration date if provided
    if (expiresAt) {
      const expirationDate = new Date(expiresAt);
      if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Expiration date must be a valid future date."
        });
      }
    }

    // Check if group exists and user is a member
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    // Check if user is a member of the group
    const isMember = group.members.some(member => 
      member.user.toString() === req.user?.id
    );
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of the group to create a poll."
      });
    }

    // Validate allowMultiple field
    const allowMultipleVotes = allowMultiple === true || allowMultiple === "true";

    // Create the poll
    const poll = await Poll.create({
      question: question.trim(),
      options: validOptions.map(opt => ({ 
        text: opt.trim(), 
        votes: [] 
      })),
      allowMultiple: allowMultipleVotes,
      createdBy: req.user?.id,
      group: groupId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    // Add poll to group's polls array
    group.polls.push(poll._id as mongoose.Types.ObjectId);
    await group.save();

    // Populate the createdBy and group fields before sending response
    const populatedPoll = await Poll.findById(poll._id)
      .populate("createdBy", "name email phoneNumber avatar")
      .populate("group", "name")
      .populate({
        path: "options.votes",
        select: "name email phoneNumber avatar",
        model: "User"
      });

    // Format poll for socket emission
    const formattedPoll = formatPollForSocket(populatedPoll, req.user?.id);

    // Broadcast poll to group members
    const socketIO = getIO();
    if (socketIO) {
      // Extract groupId from formatted poll for consistency (handles both populated and unpopulated groups)
      const pollGroupId = formattedPoll.groupId || 
                         formattedPoll.group?._id?.toString() || 
                         formattedPoll.group?._id || 
                         formattedPoll.group?.id?.toString() || 
                         formattedPoll.group?.id ||
                         (typeof formattedPoll.group === 'string' ? formattedPoll.group : null) ||
                         groupId;
      
      if (pollGroupId) {
        const groupIdStr = typeof pollGroupId === 'string' ? pollGroupId : pollGroupId.toString();
        console.log(`⚡ [SOCKET] Emitting newPoll event to group_${groupIdStr}`);
        socketIO.to(`group_${groupIdStr}`).emit("newPoll", formattedPoll);
        console.log(`✅ [SOCKET] newPoll emitted to group_${groupIdStr}`);
      } else {
        console.error(`❌ [SOCKET] Cannot emit newPoll - no groupId found in poll`);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Poll created successfully.",
      data: populatedPoll
    });

  } catch (err: any) {
    console.error("Error creating poll:", err);
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A poll with this question already exists in this group."
      });
    }
    
    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((error: any) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error occurred.",
        errors: process.env.NODE_ENV === "development" ? errors : undefined
      });
    }

    // Handle missing schema error specifically
    if (err.message.includes("MissingSchemaError") || err.message.includes("Schema hasn't been registered")) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error. Please contact administrator.",
        error: process.env.NODE_ENV === "development" ? err.message : undefined
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const votePoll = async (req: AuthRequest, res: Response) => {
  try {
    const { pollId } = req.params;
    const { optionIndex, optionIndices } = req.body;

    // Input validation
    if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({
        success: false,
        message: "Valid poll ID is required."
      });
    }

    // Find poll with group information
    const poll = await Poll.findById(pollId).populate("group", "members");
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found."
      });
    }

    // Check if poll is still active
    if (poll.expiresAt && new Date() > poll.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "This poll has expired and is no longer accepting votes."
      });
    }

    // Get group ID for membership check (extract from populated poll)
    let groupIdForMembershipCheck: string;
    if (typeof poll.group === 'object' && poll.group !== null) {
      const groupObj = poll.group as any;
      groupIdForMembershipCheck = groupObj._id?.toString() || groupObj.toString();
    } else {
      groupIdForMembershipCheck = (poll.group as mongoose.Types.ObjectId).toString();
    }

    // Check if user is a member of the group
    const group = poll.group as any;
    const isMember = group.members.some((member: any) => 
      member.user.toString() === req.user?.id
    );
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of the group to vote in this poll."
      });
    }

    // Determine if this is a single or multiple vote
    let selectedIndices: number[] = [];
    
    if (poll.allowMultiple) {
      // Multiple selection allowed
      if (optionIndices !== undefined) {
        // Validate optionIndices array
        if (!Array.isArray(optionIndices) || optionIndices.length === 0) {
          return res.status(400).json({
            success: false,
            message: "optionIndices must be a non-empty array when allowMultiple is true."
          });
        }
        
        // Validate all indices are numbers and within range
        const validIndices = optionIndices.filter((idx: any) => 
          typeof idx === "number" && idx >= 0 && idx < poll.options.length
        );
        
        if (validIndices.length !== optionIndices.length) {
          return res.status(400).json({
            success: false,
            message: "All option indices must be valid numbers within the poll's option range."
          });
        }
        
        // Remove duplicates
        selectedIndices = [...new Set(validIndices)];
        
        if (selectedIndices.length === 0) {
          return res.status(400).json({
            success: false,
            message: "At least one valid option index is required."
          });
        }
      } else if (optionIndex !== undefined) {
        // Allow single optionIndex for multiple selection polls (converts to array)
        if (typeof optionIndex !== "number" || optionIndex < 0 || optionIndex >= poll.options.length) {
          return res.status(400).json({
            success: false,
            message: "Valid option index is required."
          });
        }
        selectedIndices = [optionIndex];
      } else {
        return res.status(400).json({
          success: false,
          message: "Either optionIndex or optionIndices is required."
        });
      }
    } else {
      // Single selection only
      if (optionIndices !== undefined) {
        return res.status(400).json({
          success: false,
          message: "This poll only allows single selection. Use optionIndex instead of optionIndices."
        });
      }
      
      if (optionIndex === undefined || optionIndex === null || typeof optionIndex !== "number") {
        return res.status(400).json({
          success: false,
          message: "Valid option index is required for single selection polls."
        });
      }
      
      if (optionIndex < 0 || optionIndex >= poll.options.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid option index."
        });
      }
      
      selectedIndices = [optionIndex];
    }

    // Remove any existing votes from this user
    poll.options.forEach(opt => {
      opt.votes = opt.votes.filter(
        (userId) => userId.toString() !== req.user?.id
      );
    });

    // Add votes to selected options
    const userId = new mongoose.Types.ObjectId(req.user?.id);
    selectedIndices.forEach(index => {
      // Check if user already voted for this option (shouldn't happen after removal, but double-check)
      if (!poll.options[index].votes.some(voteId => voteId.toString() === userId.toString())) {
        poll.options[index].votes.push(userId);
      }
    });

    await poll.save();

    // Get updated poll with populated data including votes
    const updatedPoll = await Poll.findById(pollId)
      .populate("createdBy", "name email phoneNumber avatar")
      .populate("group", "name")
      .populate({
        path: "options.votes",
        select: "name email phoneNumber avatar",
        model: "User"
      });

    if (!updatedPoll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found after vote."
      });
    }

    // Format poll for socket emission
    const formattedPoll = formatPollForSocket(updatedPoll, req.user?.id);

    // Extract groupId from formatted poll for consistency
    let groupIdForBroadcast: string;
    if (formattedPoll.groupId) {
      groupIdForBroadcast = typeof formattedPoll.groupId === 'string' ? formattedPoll.groupId : formattedPoll.groupId.toString();
    } else if (typeof formattedPoll.group === 'object' && formattedPoll.group !== null) {
      const groupObj = formattedPoll.group as any;
      groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
    } else if (typeof formattedPoll.group === 'string') {
      groupIdForBroadcast = formattedPoll.group;
    } else {
      // Fallback to updatedPoll.group
      if (typeof updatedPoll.group === 'object' && updatedPoll.group !== null) {
        const groupObj = updatedPoll.group as any;
        groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
      } else {
        groupIdForBroadcast = (updatedPoll.group as mongoose.Types.ObjectId).toString();
      }
    }

    // Broadcast updated poll
    const socketIO = getIO();
    if (socketIO) {
      console.log(`⚡ [SOCKET] Emitting pollUpdated event to group_${groupIdForBroadcast}`);
      socketIO.to(`group_${groupIdForBroadcast}`).emit("pollUpdated", formattedPoll);
      console.log(`✅ [SOCKET] pollUpdated emitted to group_${groupIdForBroadcast}`);
    }

    return res.status(200).json({
      success: true,
      message: "Vote recorded successfully.",
      data: updatedPoll
    });

  } catch (err: any) {
    console.error("Error voting on poll:", err);
    
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: "Invalid data format."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getGroupPolls = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 10, status = "all" } = req.query;

    // Validate group ID
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Valid group ID is required."
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Page must be a positive integer."
      });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      return res.status(400).json({
        success: false,
        message: "Limit must be a positive integer between 1 and 50."
      });
    }

    // Check if group exists
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    // Build filter based on status
    const filter: any = { group: groupId };
    
    if (status === "active") {
      filter.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ];
    } else if (status === "closed") {
      filter.expiresAt = { $lte: new Date() };
    }

    // Get polls with pagination
    const total = await Poll.countDocuments(filter);
    const polls = await Poll.find(filter)
      .populate("createdBy", "name email phoneNumber avatar")
      .populate({
        path: "options.votes",
        select: "name email phoneNumber avatar",
        model: "User"
      })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    // Format response with vote information for the current user
    const formattedPolls = polls.map(poll => {
      const pollObj = poll.toObject();
      return {
        ...pollObj,
        options: poll.options.map((opt, index) => {
          const populatedVotes = pollObj.options[index]?.votes || [];
          return {
            text: opt.text,
            voteCount: populatedVotes.length,
            votes: populatedVotes.map((vote: any) => ({
              _id: vote._id || vote,
              name: vote.name,
              email: vote.email,
              phoneNumber: vote.phoneNumber,
              avatar: vote.avatar
            })),
            hasVoted: req.user ? populatedVotes.some((vote: any) => {
              const voteId = vote._id?.toString() || vote.toString();
              return voteId === req.user?.id;
            }) : false
          };
        }),
        totalVotes: poll.options.reduce((sum, opt) => {
          const optIndex = poll.options.indexOf(opt);
          const populatedVotes = pollObj.options[optIndex]?.votes || [];
          return sum + populatedVotes.length;
        }, 0),
        hasUserVoted: req.user ? poll.options.some((opt, index) => {
          const populatedVotes = pollObj.options[index]?.votes || [];
          return populatedVotes.some((vote: any) => {
            const voteId = vote._id?.toString() || vote.toString();
            return voteId === req.user?.id;
          });
        }) : false
      };
    });

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      message: "Polls retrieved successfully.",
      data: {
        polls: formattedPolls,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalPolls: total,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (err: any) {
    console.error("Error fetching group polls:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getPoll = async (req: AuthRequest, res: Response) => {
  try {
    const { pollId } = req.params;

    // Validate poll ID
    if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({
        success: false,
        message: "Valid poll ID is required."
      });
    }

    const poll = await Poll.findById(pollId)
      .populate("createdBy", "name email phoneNumber avatar")
      .populate("group", "name description coverImage")
      .populate({
        path: "options.votes",
        select: "name email phoneNumber avatar",
        model: "User"
      });

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found."
      });
    }

    // Check if user is a member of the group
    // Handle both populated and unpopulated group references
    let groupId: string;
    if (typeof poll.group === 'object' && poll.group !== null) {
      const groupObj = poll.group as any;
      groupId = groupObj._id?.toString() || groupObj.toString();
    } else {
      groupId = (poll.group as mongoose.Types.ObjectId).toString();
    }
    
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    const isMember = group.members.some(member => 
      member.user.toString() === req.user?.id
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You must be a member of the group to view this poll."
      });
    }

    // Format response with vote information
    const pollObj = poll.toObject();
    const pollWithCounts = {
      ...pollObj,
      options: poll.options.map((opt, index) => {
        const populatedVotes = pollObj.options[index]?.votes || [];
        return {
          text: opt.text,
          voteCount: populatedVotes.length,
          votes: populatedVotes.map((vote: any) => ({
            _id: vote._id || vote,
            name: vote.name,
            email: vote.email,
            phoneNumber: vote.phoneNumber,
            avatar: vote.avatar
          })),
          hasVoted: req.user ? populatedVotes.some((vote: any) => {
            const voteId = vote._id?.toString() || vote.toString();
            return voteId === req.user?.id;
          }) : false
        };
      }),
      totalVotes: poll.options.reduce((sum, opt, index) => {
        const populatedVotes = pollObj.options[index]?.votes || [];
        return sum + populatedVotes.length;
      }, 0),
      hasUserVoted: req.user ? poll.options.some((opt, index) => {
        const populatedVotes = pollObj.options[index]?.votes || [];
        return populatedVotes.some((vote: any) => {
          const voteId = vote._id?.toString() || vote.toString();
          return voteId === req.user?.id;
        });
      }) : false,
      isExpired: poll.expiresAt ? new Date() > poll.expiresAt : false
    };

    return res.status(200).json({
      success: true,
      message: "Poll retrieved successfully.",
      data: pollWithCounts
    });

  } catch (err: any) {
    console.error("Error fetching poll:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deletePoll = async (req: AuthRequest, res: Response) => {
  try {
    const { pollId } = req.params;

    // Validate poll ID
    if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({
        success: false,
        message: "Valid poll ID is required."
      });
    }

    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found."
      });
    }

    // Authorization check - poll creator, group admin, or platform admin can delete
    const group = await CommunityGroup.findById(poll.group);
    const isPlatformAdmin = req.user?.role === "admin";
    const isGroupAdmin =
      isPlatformAdmin ||
      group?.members.some(
        (member) =>
          member.user.toString() === req.user?.id && member.role === "admin"
      );

    if (poll.createdBy.toString() !== req.user?.id && !isGroupAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this poll."
      });
    }

    // Remove poll from group's polls array
    if (group) {
      group.polls = group.polls.filter(
        (pollRef) => pollRef.toString() !== pollId
      );
      await group.save();
    }

    // Extract groupId for broadcasting (handle both ObjectId and string)
    let groupIdForBroadcast: string;
    if (typeof poll.group === 'object' && poll.group !== null) {
      const groupObj = poll.group as any;
      groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
    } else {
      groupIdForBroadcast = (poll.group as mongoose.Types.ObjectId).toString();
    }
    
    await Poll.deleteOne({ _id: pollId });

    // Broadcast deletion to group members
    const socketIO = getIO();
    if (socketIO) {
      console.log(`⚡ [SOCKET] Emitting pollDeleted event to group_${groupIdForBroadcast}`);
      socketIO.to(`group_${groupIdForBroadcast}`).emit("pollDeleted", { pollId });
      console.log(`✅ [SOCKET] pollDeleted emitted to group_${groupIdForBroadcast}`);
    }

    return res.status(200).json({
      success: true,
      message: "Poll deleted successfully.",
      data: {
        deletedPollId: pollId
      }
    });

  } catch (err: any) {
    console.error("Error deleting poll:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const closePoll = async (req: AuthRequest, res: Response) => {
  try {
    const { pollId } = req.params;

    // Validate poll ID
    if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({
        success: false,
        message: "Valid poll ID is required."
      });
    }

    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found."
      });
    }

    // Check if poll is already closed
    if (poll.expiresAt && new Date() > poll.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Poll is already closed."
      });
    }

    // Authorization check - poll creator, group admin, or platform admin can close
    const group = await CommunityGroup.findById(poll.group);
    const isPlatformAdmin = req.user?.role === "admin";
    const isGroupAdmin =
      isPlatformAdmin ||
      group?.members.some(
        (member) =>
          member.user.toString() === req.user?.id && member.role === "admin"
      );

    if (poll.createdBy.toString() !== req.user?.id && !isGroupAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to close this poll."
      });
    }

    // Close the poll by setting expiration to now
    poll.expiresAt = new Date();
    await poll.save();

    // Get updated poll with populated data
    const updatedPoll = await Poll.findById(pollId)
      .populate("createdBy", "name email phoneNumber avatar")
      .populate("group", "name")
      .populate({
        path: "options.votes",
        select: "name email phoneNumber avatar",
        model: "User"
      });

    // Format poll for socket emission
    const formattedPoll = formatPollForSocket(updatedPoll, req.user?.id);

    // Extract groupId from formatted poll for consistency
    let groupIdForBroadcast: string;
    if (formattedPoll.groupId) {
      groupIdForBroadcast = typeof formattedPoll.groupId === 'string' ? formattedPoll.groupId : formattedPoll.groupId.toString();
    } else if (typeof formattedPoll.group === 'object' && formattedPoll.group !== null) {
      const groupObj = formattedPoll.group as any;
      groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
    } else if (typeof formattedPoll.group === 'string') {
      groupIdForBroadcast = formattedPoll.group;
    } else {
      groupIdForBroadcast = (poll.group as mongoose.Types.ObjectId).toString();
    }

    // Broadcast updated poll
    const socketIO = getIO();
    if (socketIO) {
      console.log(`⚡ [SOCKET] Emitting pollUpdated event to group_${groupIdForBroadcast}`);
      socketIO.to(`group_${groupIdForBroadcast}`).emit("pollUpdated", formattedPoll);
      console.log(`✅ [SOCKET] pollUpdated emitted to group_${groupIdForBroadcast}`);
    }

    return res.status(200).json({
      success: true,
      message: "Poll closed successfully.",
      data: updatedPoll
    });

  } catch (err: any) {
    console.error("Error closing poll:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updatePoll = async (req: AuthRequest, res: Response) => {  
  try {
    const { pollId } = req.params;
    const { question, options, expiresAt, allowMultiple } = req.body;

    // Validate poll ID
    if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) {
      return res.status(400).json({
        success: false,
        message: "Valid poll ID is required."
      });
    }

    // Find the poll with group information for authorization checks
    const poll = await Poll.findById(pollId).populate("group", "members");
    if (!poll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found."
      });
    }

    // Authorization check - only poll creator can update
    if (poll.createdBy.toString() !== req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own polls."
      });
    }

    // Check if poll has already received votes (prevent changing options after voting)
    const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    if (totalVotes > 0 && (options || question)) {
      return res.status(400).json({
        success: false,
        message: "Cannot update poll question or options after voting has started."
      });
    }
    
    // Prevent changing allowMultiple after votes have been cast
    if (totalVotes > 0 && allowMultiple !== undefined && allowMultiple !== poll.allowMultiple) {
      return res.status(400).json({
        success: false,
        message: "Cannot change allowMultiple setting after voting has started."
      });
    }

    // Validate update fields
    const updateData: any = {};

    if (question !== undefined) {
      if (typeof question !== "string" || question.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: "Question must be at least 3 characters long."
        });
      }
      updateData.question = question.trim();
    }

    if (options !== undefined) {
      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 options are required."
        });
      }

      // Validate each option
      const validOptions = options.filter(opt => 
        typeof opt === "string" && opt.trim().length > 0
      );
      
      if (validOptions.length < 2) {
        return res.status(400).json({
          success: false,
          message: "Each option must be a non-empty string."
        });
      }

      // Check for duplicate options (case-insensitive)
      const optionSet = new Set(validOptions.map(opt => opt.toLowerCase().trim()));
      if (optionSet.size !== validOptions.length) {
        return res.status(400).json({
          success: false,
          message: "Duplicate options are not allowed."
        });
      }

      // Only update options if poll hasn't received votes
      if (totalVotes === 0) {
        updateData.options = validOptions.map(opt => ({ 
          text: opt.trim(), 
          votes: [] 
        }));
      }
    }

    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        // Allow clearing expiration
        updateData.expiresAt = null;
      } else {
        const expirationDate = new Date(expiresAt);
        if (isNaN(expirationDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Expiration date must be a valid date."
          });
        }
        updateData.expiresAt = expirationDate;
      }
    }
    
    if (allowMultiple !== undefined) {
      // Validate allowMultiple field
      const allowMultipleVotes = allowMultiple === true || allowMultiple === "true";
      updateData.allowMultiple = allowMultipleVotes;
    }

    // Update the poll
    const updatedPoll = await Poll.findByIdAndUpdate(
      pollId,
      updateData,
      { 
        new: true,
        runValidators: true 
      }
    )
    .populate("createdBy", "name email phoneNumber avatar")
    .populate("group", "name")
    .populate({
      path: "options.votes",
      select: "name email phoneNumber avatar",
      model: "User"
    });

    if (!updatedPoll) {
      return res.status(404).json({
        success: false,
        message: "Poll not found after update attempt."
      });
    }

    // Format poll for socket emission
    const formattedPoll = formatPollForSocket(updatedPoll, req.user?.id);

    // Extract groupId from formatted poll for consistency
    let groupIdForBroadcast: string;
    if (formattedPoll.groupId) {
      groupIdForBroadcast = typeof formattedPoll.groupId === 'string' ? formattedPoll.groupId : formattedPoll.groupId.toString();
    } else if (typeof formattedPoll.group === 'object' && formattedPoll.group !== null) {
      const groupObj = formattedPoll.group as any;
      groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
    } else if (typeof formattedPoll.group === 'string') {
      groupIdForBroadcast = formattedPoll.group;
    } else {
      // Fallback to updatedPoll.group
      if (typeof updatedPoll.group === 'object' && updatedPoll.group !== null) {
        const groupObj = updatedPoll.group as any;
        groupIdForBroadcast = groupObj._id?.toString() || groupObj.toString();
      } else {
        groupIdForBroadcast = (updatedPoll.group as mongoose.Types.ObjectId).toString();
      }
    }
    
    const socketIO = getIO();
    if (socketIO) {
      console.log(`⚡ [SOCKET] Emitting pollUpdated event to group_${groupIdForBroadcast}`);
      socketIO.to(`group_${groupIdForBroadcast}`).emit("pollUpdated", formattedPoll);
      console.log(`✅ [SOCKET] pollUpdated emitted to group_${groupIdForBroadcast}`);
    }

    return res.status(200).json({
      success: true,
      message: "Poll updated successfully.",
      data: updatedPoll
    });

  } catch (err: any) {
    console.error("Error updating poll:", err);
    
    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((error: any) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error occurred.",
        errors: process.env.NODE_ENV === "development" ? errors : undefined
      });
    }
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A poll with this question already exists in this group."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}