import CommunityGroup, { ICommunityGroup } from "../models/communityGroup";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middlewares/auth";
import User from "../models/User";
import {
  getMembershipInfo,
  normalizeRole,
  compareRolePriority,
  hasPermission,
} from "../utils/groupPermissions";

type MembershipRole = "admin" | "member" | "moderator" | "expert" | "user" | null;

/** Filter out members whose User no longer exists (deleted from User collection). */
const filterMembersWithExistingUsers = (members: any[]): any[] => {
  if (!Array.isArray(members)) return [];
  return members.filter((m) => m != null && m.user != null);
};

const normalizeMemberUserId = (member: any): string | null => {
  if (!member || !member.user) {
    return null;
  }

  const memberUser = member.user;

  if (typeof memberUser === "string") {
    return memberUser;
  }

  if (memberUser instanceof mongoose.Types.ObjectId) {
    return memberUser.toString();
  }

  if (typeof memberUser === "object") {
    if (memberUser._id) {
      return memberUser._id.toString();
    }
    if (memberUser.id) {
      return memberUser.id.toString();
    }
  }

  try {
    return memberUser.toString();
  } catch {
    return null;
  }
};

const getMembershipDetails = (group: any, userId?: string) => {
  if (!userId) {
    return {
      isMember: false,
      membershipRole: null as MembershipRole,
      membershipStatus: "none" as "none" | "member" | "admin",
    };
  }

  const members: any[] = Array.isArray(group?.members) ? group.members : [];
  const matchedMember = members.find(
    (member) => normalizeMemberUserId(member) === userId
  );

  if (!matchedMember) {
    return {
      isMember: false,
      membershipRole: null as MembershipRole,
      membershipStatus: "none" as "none" | "member" | "admin",
    };
  }

  const membershipRole = (normalizeRole(matchedMember.role) as MembershipRole) ?? null;

  return {
    isMember: true,
    membershipRole,
    membershipStatus: membershipRole === "admin" ? "admin" : "member",
  };
};

const formatGroupForResponse = (group: any, userId?: string) => {
  const serializableGroup = group?.toObject ? group.toObject() : group;
  const allMembers = serializableGroup?.members ?? [];
  const validMembers = filterMembersWithExistingUsers(allMembers);
  const groupWithValidMembers = { ...serializableGroup, members: validMembers };
  const { isMember, membershipRole, membershipStatus } = getMembershipDetails(groupWithValidMembers, userId);

  return {
    ...groupWithValidMembers,
    totalMembers: validMembers.length,
    totalPolls: serializableGroup?.polls?.length || 0,
    isMember,
    membershipRole,
    membershipStatus,
  };
};

/** Ensure any member who is a platform admin (User.role === "admin") has group role "admin". */
async function ensurePlatformAdminsAreGroupAdmins(
  group: ICommunityGroup
): Promise<void> {
  const memberUserIds = group.members.map((m) =>
    typeof m.user === "object" && m.user && (m.user as any)._id
      ? (m.user as any)._id.toString()
      : m.user.toString()
  );
  const platformAdmins = await User.find({
    _id: { $in: memberUserIds },
    role: "admin",
  })
    .select("_id")
    .lean();
  const adminIdSet = new Set(platformAdmins.map((u) => u._id.toString()));
  let modified = false;
  for (const m of group.members) {
    const id =
      typeof m.user === "object" && m.user && (m.user as any)._id
        ? (m.user as any)._id.toString()
        : m.user.toString();
    if (adminIdSet.has(id) && m.role !== "admin") {
      m.role = "admin";
      modified = true;
    }
  }
  if (modified) await group.save();
}


export const createGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, coverImage, order } = req.body;

    const createdBy = req.user?._id?.toString();

    console.log("createdBy:-", createdBy);

    // Validate user authentication
    if (!createdBy || !mongoose.Types.ObjectId.isValid(createdBy)) {
      return res.status(401).json({
        success: false,
        message: "User authentication required to create a group.",
      });
    }

    //Input validations
    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Group name is required and should be at least 3 characters.",
      });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Group name must not exceed 100 characters.",
      });
    }

    if (description && typeof description !== "string") {
      return res.status(400).json({
        success: false,
        message: "Description must be a string.",
      });
    }

    if (description && description.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: "Description must not exceed 500 characters.",
      });
    }

    if (coverImage && typeof coverImage !== "string") {
      return res.status(400).json({
        success: false,
        message: "Cover image must be a valid string URL.",
      });
    }

    const orderNum = order !== undefined ? Number(order) : undefined;
    if (orderNum !== undefined && (Number.isNaN(orderNum) || !Number.isInteger(orderNum) || orderNum < 0)) {
      return res.status(400).json({
        success: false,
        message: "Order must be a non-negative integer.",
      });
    }

    // Check for duplicate group name (case-insensitive)
    const trimmedName = name.trim();
    const duplicateGroup = await CommunityGroup.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
    });

    if (duplicateGroup) {
      return res.status(409).json({
        success: false,
        message: "A group with this name already exists.",
      });
    }

    // Create group with creator as admin
    const group = await CommunityGroup.create({
      name: trimmedName,
      description: description?.trim() || "",
      coverImage: coverImage?.trim() || undefined,
      order: orderNum !== undefined ? orderNum : 0,
      createdBy: new mongoose.Types.ObjectId(createdBy),
      members: [
        {
          user: new mongoose.Types.ObjectId(createdBy),
          role: "admin",
          joinedAt: new Date(),
        },
      ],
    });

    // Populate the created group with user details
    const populatedGroup = await CommunityGroup.findById(group._id)
      .populate('members.user', 'name email phoneNumber avatar')
      .populate('createdBy', 'name email phoneNumber avatar');

    if (!populatedGroup) {
      return res.status(500).json({
        success: false,
        message: "Group created but failed to retrieve details.",
      });
    }

    // Format response consistently with other endpoints
    const formattedGroup = formatGroupForResponse(populatedGroup, createdBy);

    return res.status(201).json({
      success: true,
      message: "Community group created successfully.",
      data: formattedGroup,
    });
  } catch (err: any) {
    console.error("Error creating group:", err);

    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((error: any) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error occurred.",
        errors: process.env.NODE_ENV === "development" ? errors : undefined,
      });
    }

    // Handle duplicate key error (if unique index added to name)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A group with this name already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const addMemberToGroup = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { userId, role } = req.body;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid groupId." });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId." });
    }

    // Validate role
    if (role && !["user", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Role must be 'user' or 'admin'." });
    }

    // Find group
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // Check if user already a member
    const isMember = group.members.some((member) => member.user.toString() === userId);
    if (isMember) {
      return res.status(400).json({ success: false, message: "User is already a member of this group." });
    }

    const userToAdd = await User.findById(userId).select("role").lean();
    const requestedRole = role === "user" ? "member" : (role || "member");
    const effectiveRole =
      userToAdd?.role === "admin" ? "admin" : requestedRole;

    group.members.push({
      user: new mongoose.Types.ObjectId(userId),
      role: effectiveRole,
      joinedAt: new Date(),
    });

    await group.save();

    return res.status(200).json({
      success: true,
      message: "Member added successfully.",
      data: group,
    });
  } catch (err: any) {
    console.error("Error adding member:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getGroups = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 100, search, sortBy = 'order', sortOrder = 'asc' } = req.query;
    const requestingUserId = req.user?._id?.toString();
    
    // Validate pagination parameters
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

    // Validate and parse sort parameters
    const validSortFields = ['order', 'name', 'createdAt', 'updatedAt', 'memberCount'];
    const sortFieldStr = typeof sortBy === 'string' ? sortBy : 'order';
    const sortField = validSortFields.includes(sortFieldStr) ? sortFieldStr : 'order';
    
    const sortOrderStr = typeof sortOrder === 'string' ? sortOrder : 'desc';
    const sortDirection = sortOrderStr === 'asc' ? 1 : -1;

    // Build search filter
    const filter: any = {};
    if (search && typeof search === 'string' && search.trim().length > 0) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    let groups;
    let total;

    if (sortField === 'memberCount') {
      // Use aggregation for member count sorting
      const aggregation: any[] = [
        { $match: filter },
        { $addFields: { membersCount: { $size: "$members" } } },
        // Keep results stable and still "in order" where possible
        { $sort: { membersCount: sortDirection, order: 1, createdAt: 1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
        {
          $lookup: {
            from: "users",
            localField: "createdBy",
            foreignField: "_id",
            as: "createdBy"
          }
        },
        { $unwind: { path: "$createdBy", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "users",
            localField: "members.user",
            foreignField: "_id",
            as: "populatedMembers"
          }
        },
        {
          $project: {
            name: 1,
            description: 1,
            coverImage: 1,
            order: 1,
            "createdBy.name": 1,
            "createdBy.email": 1,
            "createdBy.avatar": 1,
            members: {
              $map: {
                input: "$members",
                as: "member",
                in: {
                  user: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$populatedMembers",
                          as: "populatedUser",
                          cond: { $eq: ["$$populatedUser._id", "$$member.user"] }
                        }
                      },
                      0
                    ]
                  },
                  role: "$$member.role",
                  joinedAt: "$$member.joinedAt"
                }
              }
            },
            polls: 1,
            createdAt: 1,
            updatedAt: 1,
            membersCount: 1
          }
        },
        // Filter out members whose User no longer exists (deleted from User collection)
        {
          $addFields: {
            members: {
              $filter: {
                input: { $ifNull: ["$members", []] },
                as: "m",
                cond: { $ne: ["$$m.user", null] }
              }
            }
          }
        }
      ];

      // Get total count
      total = await CommunityGroup.countDocuments(filter);
      
      // Execute aggregation
      groups = await CommunityGroup.aggregate(aggregation);

    } else {
      // Regular find with population for other sort fields
      total = await CommunityGroup.countDocuments(filter);

      // Build sort object with proper typing
      const sortOptions: { [key: string]: 1 | -1 } = {};
      sortOptions[sortField] = sortDirection;
      if (sortField === 'order') {
        sortOptions['createdAt'] = 1; // secondary sort for same order value
      }

      groups = await CommunityGroup.find(filter)
        .populate('createdBy', 'name email phoneNumber avatar')
        .populate('members.user', 'name email phoneNumber avatar')
        .sort(sortOptions)
        .limit(limitNum)
        .skip((pageNum - 1) * limitNum);
    }



    // Format groups to include member counts
    const formattedGroups = groups.map((group: any) => formatGroupForResponse(group, requestingUserId));



    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      message: "Groups retrieved successfully.",
      data: {
        groups: formattedGroups,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalGroups: total,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          limit: limitNum
        },
        filters: {
          search: search || '',
          sortBy: sortField,
          sortOrder: sortDirection === 1 ? 'asc' : 'desc'
        }
      }
    });

  } catch (err: any) {
    console.error("Error fetching groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getAllGroups = async (req: AuthRequest, res: Response) => {
  try {
    const requestingUserId = req.user?._id?.toString();
    const groups = await CommunityGroup.find({})
      .select("name description coverImage order members createdAt updatedAt")
      .populate("members.user", "name email phoneNumber avatar")
      .sort({ order: 1, createdAt: 1 });

    const groupsWithMembership = groups.map(group => formatGroupForResponse(group, requestingUserId));

    return res.status(200).json({
      success: true,
      message: "Groups retrieved successfully.",
      data: groupsWithMembership,
    });
  } catch (err: any) {
    console.error("Error fetching groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteGroup = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID format."
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

    // Optional: Add authorization check
    // if (group.createdBy.toString() !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "You are not authorized to delete this group."
    //   });
    // }

    // Delete the group
    await CommunityGroup.findByIdAndDelete(groupId);

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully.",
      data: {
        deletedGroupId: groupId
      }
    });

  } catch (err: any) {
    console.error("Error deleting group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateGroup = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { name, description, coverImage, order } = req.body;

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID format."
      });
    }

    // Validate update fields
    if (name && (typeof name !== "string" || name.trim().length < 3)) {
      return res.status(400).json({
        success: false,
        message: "Group name must be at least 3 characters long."
      });
    }

    if (description && typeof description !== "string") {
      return res.status(400).json({
        success: false,
        message: "Description must be a string."
      });
    }

    if (coverImage && typeof coverImage !== "string") {
      return res.status(400).json({
        success: false,
        message: "Cover image must be a valid URL string."
      });
    }

    const orderNum = order !== undefined ? Number(order) : undefined;
    if (orderNum !== undefined && (Number.isNaN(orderNum) || !Number.isInteger(orderNum) || orderNum < 0)) {
      return res.status(400).json({
        success: false,
        message: "Order must be a non-negative integer.",
      });
    }

    // Check if group exists
    const existingGroup = await CommunityGroup.findById(groupId);
    if (!existingGroup) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    // Authorization check - UNCOMMENT AND MODIFY BASED ON YOUR AUTH SYSTEM
    // if (existingGroup.createdBy.toString() !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "You are not authorized to update this group."
    //   });
    // }

    // Check for duplicate group name (case-insensitive)
    if (name && name.trim().toLowerCase() !== existingGroup.name.toLowerCase()) {
      const duplicateGroup = await CommunityGroup.findOne({ 
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        _id: { $ne: groupId }
      });
      
      if (duplicateGroup) {
        return res.status(409).json({
          success: false,
          message: "A group with this name already exists."
        });
      }
    }
    console.log("orderNum:-", orderNum);

    // Prepare update data with sanitization
    const updateData: any = {};
    if (name) updateData.name = name.trim();
    if (description) updateData.description = description.trim();
    if (coverImage) updateData.coverImage = coverImage.trim();
    if (orderNum !== undefined) updateData.order = orderNum;

    // Add updatedAt timestamp manually to ensure it reflects this update
    updateData.updatedAt = new Date();

    // Update the group
    const updatedGroup = await CommunityGroup.findByIdAndUpdate(
      groupId,
      updateData,
      { 
        new: true,
        runValidators: true 
      }
    )
    .populate('members.user', 'name email phoneNumber avatar')
    .populate('createdBy', 'name email phoneNumber avatar');

    // Check if group was successfully updated
    if (!updatedGroup) {
      return res.status(404).json({
        success: false,
        message: "Group not found after update attempt."
      });
    }

    // Format response to include counts (filter out deleted users from members)
    const validMembers = filterMembersWithExistingUsers(updatedGroup.members ?? []);
    const formattedGroup = {
      ...updatedGroup.toObject(),
      members: validMembers,
      totalMembers: validMembers.length,
      totalPolls: updatedGroup.polls?.length || 0
    };

    return res.status(200).json({
      success: true,
      message: "Group updated successfully.",
      data: formattedGroup
    });

  } catch (err: any) {
    console.error("Error updating group:", err);
    
    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map((error: any) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error occurred.",
        errors: process.env.NODE_ENV === "development" ? errors : undefined
      });
    }
    
    // Handle duplicate key error (if unique index added to name)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A group with this name already exists."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const checkMembershipStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?._id?.toString();

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID format."
      });
    }

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID."
      });
    }

    // Find group (only select members field for efficiency)
    const group = await CommunityGroup.findById(groupId).select('members');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    // Get membership details
    const membershipDetails = getMembershipDetails(group, userId);

    // Find the member to get joinedAt date if they're a member
    let joinedAt = null;
    if (membershipDetails.isMember) {
      const member = group.members.find((m: any) => 
        normalizeMemberUserId(m) === userId
      );
      joinedAt = member?.joinedAt || null;
    }

    return res.status(200).json({
      success: true,
      message: "Membership status retrieved successfully.",
      data: {
        groupId,
        userId,
        ...membershipDetails,
        joinedAt,
      }
    });

  } catch (err: any) {
    console.error("Error checking membership status:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getGroupById = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const requestingUserId = req.user?._id?.toString();

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID format."
      });
    }

    const groupDoc = await CommunityGroup.findById(groupId);
    if (!groupDoc) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }
    await ensurePlatformAdminsAreGroupAdmins(groupDoc);

    const group = await CommunityGroup.findById(groupId)
      .populate("members.user", "name email phoneNumber avatar role")
      .populate("createdBy", "name email phoneNumber avatar");

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    const formattedGroup = formatGroupForResponse(group, requestingUserId);

    return res.status(200).json({
      success: true,
      message: "Group retrieved successfully.",
      data: formattedGroup
    });

  } catch (err: any) {
    console.error("Error fetching group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const joinGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?._id?.toString();

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID format."
      });
    }

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID."
      });
    }

    // Find group
    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found."
      });
    }

    // Check if user is already a member
    const isMember = group.members.some(member => 
      member.user.toString() === userId
    );
    
    if (isMember) {
      return res.status(400).json({
        success: false,
        message: "You are already a member of this group."
      });
    }

    const initialRole = req.user?.role === "admin" ? "admin" : "member";
    group.members.push({
      user: new mongoose.Types.ObjectId(userId),
      role: initialRole,
      joinedAt: new Date(),
    });

    await group.save();

    // Populate the updated group data
    const populatedGroup = await CommunityGroup.findById(groupId)
      .populate('members.user', 'name email phoneNumber avatar')
      .populate('createdBy', 'name email phoneNumber avatar');

    const formattedGroup = populatedGroup ? formatGroupForResponse(populatedGroup, userId) : null;

    return res.status(200).json({
      success: true,
      message: "Successfully joined the group.",
      data: formattedGroup
    });

  } catch (err: any) {
    console.error("Error joining group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const leaveGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?._id?.toString();

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid groupId." });
    }

    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // Check if user is a member
    const memberIndex = group.members.findIndex(member => 
      member.user.toString() === userId
    );

    if (memberIndex === -1) {
      return res.status(400).json({ success: false, message: "You are not a member of this group." });
    }

    // Prevent admin from leaving if they're the only admin
    const isAdmin = group.members[memberIndex].role === "admin";
    const adminCount = group.members.filter(m => m.role === "admin").length;
    
    if (isAdmin && adminCount === 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot leave group as the only admin. Transfer admin role first or delete the group."
      });
    }

    // Remove member
    group.members.splice(memberIndex, 1);
    await group.save();

    return res.status(200).json({
      success: true,
      message: "Successfully left the group."
    });

  } catch (err: any) {
    console.error("Error leaving group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const removeMember = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId, userId } = req.params;
    const actingUserId = req.user?._id?.toString();

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(groupId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res.status(400).json({ success: false, message: "Invalid IDs." });
    }

    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    if (!hasPermission(group, actingUserId, "remove_members", { platformRole: req.user?.role })) {
      return res.status(403).json({
        success: false,
        message: "Only group admins and moderators can remove members.",
      });
    }

    const actingMembership = getMembershipInfo(group, actingUserId, {
      platformRole: req.user?.role,
    });

    // Check if target user is a member
    const memberIndex = group.members.findIndex(
      (member) => member.user.toString() === userId
    );

    if (memberIndex === -1) {
      return res.status(400).json({ success: false, message: "User is not a member of this group." });
    }

    const targetRole = normalizeRole(group.members[memberIndex].role);
    const actingRole = actingMembership.role;

    // Prevent removing the only admin (regardless of who is acting)
    const adminCount = group.members.filter((m) => m.role === "admin").length;
    if (targetRole === "admin" && adminCount === 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot remove the only admin from the group.",
      });
    }

    // Enforce role hierarchy: cannot remove member with higher or equal role
    if (compareRolePriority(actingRole, targetRole) <= 0) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to remove this member.",
      });
    }

    // Remove member
    group.members.splice(memberIndex, 1);
    await group.save();

    return res.status(200).json({
      success: true,
      message: "Member removed successfully."
    });

  } catch (err: any) {
    console.error("Error removing member:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

const ALLOWED_ROLES = ["admin", "moderator", "member", "expert"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

export const updateMemberRole = async (req: AuthRequest, res: Response) => {
  try {
    const { groupId, userId: targetUserId } = req.params;
    const { role: newRole } = req.body;
    const actingUserId = req.user?._id?.toString();

    console.log("actingUserId:-", actingUserId);
    console.log("req.user?.role:-", req.user?.role);  
    console.log("targetUserId:-", targetUserId);
    console.log("newRole:-", newRole);

    if (
      !mongoose.Types.ObjectId.isValid(groupId) ||
      !mongoose.Types.ObjectId.isValid(targetUserId)
    ) {
      return res.status(400).json({ success: false, message: "Invalid group or user ID." });
    }

    if (!newRole || typeof newRole !== "string") {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be a string.",
      });
    }

    const roleStr = newRole.trim().toLowerCase();
    if (!ALLOWED_ROLES.includes(roleStr as AllowedRole)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${ALLOWED_ROLES.join(", ")}.`,
      });
    }

    const group = await CommunityGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    if (!hasPermission(group, actingUserId, "change_member_role", { platformRole: req.user?.role })) {
      return res.status(403).json({
        success: false,
        message: "Only group admins can change member roles.",
      });
    }

    let memberIndex = group.members.findIndex(
      (m) => normalizeMemberUserId(m) === targetUserId
    );
    if (memberIndex === -1) {
      memberIndex = group.members.findIndex(
        (m) => (m as any)._id?.toString() === targetUserId
      );
    }
    if (memberIndex === -1) {
      const memberUserIds = group.members.map((m) => normalizeMemberUserId(m)).filter(Boolean);
      console.log("[updateMemberRole] targetUserId:", targetUserId, "groupMemberUserIds:", memberUserIds);
      return res.status(404).json({
        success: false,
        message: "User is not a member of this group.",
      });
    }

    const currentRole = normalizeRole(group.members[memberIndex].role);
    const adminCount = group.members.filter((m) => m.role === "admin").length;

    if (currentRole === "admin" && roleStr !== "admin" && adminCount === 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot demote the only admin. Assign another admin first.",
      });
    }

    group.members[memberIndex].role = roleStr as AllowedRole;
    await group.save();

    const updatedGroup = await CommunityGroup.findById(groupId)
      .populate("members.user", "name email phoneNumber avatar")
      .select("members");

    if (!updatedGroup) {
      return res.status(500).json({
        success: false,
        message: "Member role updated but failed to retrieve group.",
      });
    }

    const updatedMember = updatedGroup.members[memberIndex];

    return res.status(200).json({
      success: true,
      message: "Member role updated successfully.",
      data: {
        user: updatedMember?.user,
        role: updatedMember?.role,
        joinedAt: updatedMember?.joinedAt,
      },
    });
  } catch (err: any) {
    console.error("Error updating member role:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};


export const getGroupMembers = async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50, role, search } = req.query;

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid group ID." });
    }

    // Validate pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ success: false, message: "Page must be a positive integer." });
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ success: false, message: "Limit must be between 1 and 100." });
    }

    const groupDoc = await CommunityGroup.findById(groupId).select("members");
    if (!groupDoc) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }
    await ensurePlatformAdminsAreGroupAdmins(groupDoc);

    const memberIdToUserId = new Map<string, string>();
    for (const m of groupDoc.members) {
      const mid = (m as any)._id?.toString();
      const uid = normalizeMemberUserId(m);
      if (mid && uid) memberIdToUserId.set(mid, uid);
    }

    const group = await CommunityGroup.findById(groupId)
      .populate("members.user", "name email phoneNumber avatar")
      .select("members");

    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // Filter out members whose User no longer exists (deleted from User collection)
    let members = filterMembersWithExistingUsers(group.members ?? []);

    if (role) {
      const allowedRoles = ["user", "admin", "member", "moderator", "expert"];
      const requestedRole = role as string;
      if (allowedRoles.includes(requestedRole)) {
        members = members.filter((m) => m.role === requestedRole);
      }
    }

    if (search && typeof search === "string") {
      const searchTerm = search.toLowerCase();
      members = members.filter((m) => {
        const u = m.user as any;
        if (!u) return false;
        const name = u.name?.toLowerCase?.() ?? "";
        const email = u.email?.toLowerCase?.() ?? "";
        const phone = u.phoneNumber?.toLowerCase?.() ?? "";
        return name.includes(searchTerm) || email.includes(searchTerm) || phone.includes(searchTerm);
      });
    }

    // Paginate
    const total = members.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedMembers = members.slice(startIndex, startIndex + limitNum);

    const totalPages = Math.ceil(total / limitNum);

    const membersWithUserId = paginatedMembers.map((m) => {
      const plain = (m as any).toObject ? (m as any).toObject() : { ...(m as any) };
      const memberId = plain._id?.toString?.() ?? (m as any)._id?.toString?.();
      const uidFromPopulated = (plain.user?._id ?? (m as any).user?._id)?.toString?.();
      const userId =
        normalizeMemberUserId(m) ??
        (memberId ? memberIdToUserId.get(memberId) : null) ??
        uidFromPopulated ??
        null;
      const name = (plain.user?.name ?? (m as any).user?.name) ?? null;
      return { ...plain, userId, name };
    });

    return res.status(200).json({
      success: true,
      message: "Members retrieved successfully.",
      data: {
        members: membersWithUserId,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMembers: total,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (err: any) {
    console.error("Error fetching group members:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    // Assuming you have a User model
    const users = await User.find({})
      .select("name email phoneNumber avatar role createdAt updatedAt"); // only required fields  
    return res.status(200).json({
      success: true,
      message: "Users retrieved successfully.",
      data: users,
    });
  } catch (err: any) {
    console.error("Error fetching users:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getUserGroups = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id?.toString();

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({
        success: false,
        message: "User authentication required."
      });
    }

    // Find all groups where the user is a member, sorted by order then createdAt
    const groups = await CommunityGroup.find({
      "members.user": new mongoose.Types.ObjectId(userId)
    })
      .select("_id name description coverImage order members createdAt updatedAt")
      .sort({ order: 1, createdAt: 1 })
      .populate("createdBy", "name email phoneNumber avatar");

    // Format response with membership details
    const formattedGroups = groups.map(group => formatGroupForResponse(group, userId));

    return res.status(200).json({
      success: true,
      message: "User groups retrieved successfully.",
      data: {
        groups: formattedGroups,
        groupIds: formattedGroups.map(g => g._id.toString()) // For easy socket room joining
      }
    });
  } catch (err: any) {
    console.error("Error fetching user groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error. Please try again later.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};