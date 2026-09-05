// controllers/postController.ts
import { Response } from "express";
import mongoose from "mongoose";
import Post, { PostPriority, PostType } from "../models/Post";
import Comment from "../models/Comment";
import "../models/Pet";
import { AuthRequest } from "../middlewares/auth";
import { createNotification } from "../services/notificationService";

const ALLOWED_POST_TYPES: PostType[] = [
  "ADVICE",
  "HELP",
  "INFO",
  "PET_MOMENT",
  "QUESTION",
  "GENERAL",
];
const ALLOWED_PRIORITIES: PostPriority[] = ["LOW", "MEDIUM", "HIGH"];

const getCurrentUserId = (req: AuthRequest): string | null => {
  const user = req.user as any;
  if (!user) return null;
  return user._id?.toString?.() || user.id?.toString?.() || null;
};

const isAdminUser = (req: AuthRequest): boolean => {
  const user = req.user as any;
  return user?.role === "admin";
};

const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

const canPopulatePet = (): boolean => mongoose.modelNames().includes("Pet");
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createPost = async (req: AuthRequest, res: Response) => {
  try {
    console.log("createPost", req.body);
    const userId = getCurrentUserId(req);
    console.log("userId", userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { pet, caption, media, postType, tags, priority, location } = req.body as {
      pet?: string;
      caption?: string;
      media?: { url: string; type: "image" | "video" }[];
      postType?: PostType;
      tags?: string[];
      priority?: PostPriority;
      location?: string;
    };

    if (!postType || !ALLOWED_POST_TYPES.includes(postType)) {
      return res.status(400).json({ success: false, message: "Invalid post type." });
    }

    const safeMedia = Array.isArray(media) ? media : [];
    console.log("safeMedia", safeMedia);
    if ((!caption || caption.trim().length === 0) && safeMedia.length === 0) {
      return res.status(400).json({ success: false, message: "Post must have caption or media." });
    }

    const hasInvalidMedia = safeMedia.some(
      (item) => !item?.url || !["image", "video"].includes(item.type)
    );
    if (hasInvalidMedia) {
      return res.status(400).json({ success: false, message: "Invalid media payload." });
    }

    if (postType === "HELP" && priority && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority value." });
    }
    console.log("postType", postType);
    console.log("priority", priority);
    console.log("location", location);
    console.log("tags", tags);
    console.log("pet", pet);


    const post = await Post.create({
      user: new mongoose.Types.ObjectId(userId),
      author: new mongoose.Types.ObjectId(userId),
      pet: pet && mongoose.Types.ObjectId.isValid(pet) ? new mongoose.Types.ObjectId(pet) : undefined,
      caption: caption?.trim(),
      media: safeMedia,
      postType,
      tags: normalizeTags(tags),
      priority: postType === "HELP" ? priority || "MEDIUM" : undefined,
      location: typeof location === "string" ? location.trim() : undefined,
    });
    console.log("post", post);

    let populatedQuery = Post.findById(post._id)
      .populate("user", "name email phoneNumber avatar")
      .populate("author", "name email phoneNumber avatar");
    if (canPopulatePet()) {
      populatedQuery = populatedQuery.populate("pet");
    }
    const populated = await populatedQuery;

    return res.status(201).json({
      success: true,
      message: "Post created successfully.",
      data: populated,
    });
  } catch (error: any) {
    console.error("createPost error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create post.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get Posts with pagination and filtering
export const getPosts = async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      postType,
      filter,
      petId,
      tag,
      tags,
      search,
      q,
      query: searchTerm,
      sort = "latest",
    } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) {
      return res.status(400).json({ success: false, message: "Invalid pagination values." });
    }

    const match: Record<string, any> = { isDeleted: false, status: "active" };
    if (typeof petId === "string" && mongoose.Types.ObjectId.isValid(petId)) {
      match.pet = new mongoose.Types.ObjectId(petId);
    }
    const rawType =
      (typeof postType === "string" && postType.trim()) ||
      (typeof type === "string" && type.trim()) ||
      (typeof filter === "string" && filter.trim()) ||
      "";
    const normalizedType = rawType.toUpperCase();
    if (normalizedType && normalizedType !== "ALL" && normalizedType !== "ALL_TAGS") {
      if (ALLOWED_POST_TYPES.includes(normalizedType as PostType)) {
        match.postType = normalizedType;
      } else {
        // Also allow filtering by single tag via `filter` when not a postType.
        match.tags = normalizedType.toLowerCase();
      }
    }

    const normalizedTagList: string[] = [];
    if (typeof tag === "string" && tag.trim()) normalizedTagList.push(tag.trim().toLowerCase());
    if (typeof tags === "string" && tags.trim()) {
      normalizedTagList.push(
        ...tags
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      );
    }
    if (normalizedTagList.length === 1) {
      match.tags = normalizedTagList[0];
    } else if (normalizedTagList.length > 1) {
      match.tags = { $in: Array.from(new Set(normalizedTagList)) };
    }

    const rawSearch =
      (typeof search === "string" && search.trim()) ||
      (typeof q === "string" && q.trim()) ||
      (typeof searchTerm === "string" && searchTerm.trim()) ||
      "";
    if (rawSearch) {
      const safeSearch = escapeRegex(rawSearch);
      const searchRegex = new RegExp(safeSearch, "i");
      match.$or = [{ caption: searchRegex }, { tags: searchRegex }, { location: searchRegex }];
    }

    const rawSort = typeof sort === "string" ? sort.trim() : "latest";
    const sortValue = rawSort.toLowerCase();
    const sortStage: Record<string, 1 | -1> =
      sortValue === "mostliked" || sortValue === "likes"
        ? { likesCount: -1, createdAt: -1, _id: -1 }
        : sortValue === "engagement" || sortValue === "mostengagement"
          ? { engagementScore: -1, createdAt: -1, _id: -1 }
          : sortValue === "oldest" || sortValue === "older"
            ? { createdAt: 1, _id: 1 }
            : { createdAt: -1, _id: -1 };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          likesCount: { $size: "$likes" },
          engagementScore: { $add: [{ $size: "$likes" }, "$commentsCount"] },
          priorityRank: {
            $cond: [
              { $and: [{ $eq: ["$postType", "HELP"] }, { $eq: ["$priority", "HIGH"] }] },
              1,
              0,
            ],
          },
        },
      },
      { $sort: sortStage },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          posts: [{ $skip: pagination.skip }, { $limit: pagination.limitNum }],
        },
      },
    ];

    const [result] = await Post.aggregate(pipeline);
    const total = result?.metadata?.[0]?.total || 0;
    const postIds: mongoose.Types.ObjectId[] = (result?.posts || []).map(
      (post: { _id: mongoose.Types.ObjectId }) => post._id
    );

    // FIX: Only query if there are posts
    if (postIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Posts fetched successfully.",
        data: {
          posts: [],
          pagination: {
            currentPage: pagination.pageNum,
            totalPages: 1,
            totalPosts: 0,
            hasNext: false,
            hasPrev: false,
            limit: pagination.limitNum,
          },
        },
      });
    }

    // FIX: Properly chain the populate methods
    let query = Post.find({ _id: { $in: postIds } })
      .populate("user", "name email phoneNumber avatar")
      .populate("author", "name email phoneNumber avatar")
      .populate("pet", "name breed imageUrl")
      .populate("bestComment");
    
    const populated = await query;



    // Maintain original order from aggregation
    const postOrder = new Map(postIds.map((id, idx) => [id.toString(), idx]));
    const posts = populated.sort((a, b) => (postOrder.get(a.id) || 0) - (postOrder.get(b.id) || 0));

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Posts fetched successfully.",
      data: {
        posts,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalPosts: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    console.error("getPosts error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch posts.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getPostById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid post id." });
    }
    let postQuery = Post.findOne({ _id: id, isDeleted: false, status: "active" })
      .populate("user", "name email phoneNumber avatar")
      .populate("author", "name email phoneNumber avatar")
      .populate("bestComment");
    if (canPopulatePet()) {
      postQuery = postQuery.populate("pet");
    }
    const post = await postQuery;
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    return res.status(200).json({
      success: true,
      message: "Post fetched successfully.",
      data: post,
    });
  } catch (err: any) {
    console.error("getPostById error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch post.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getMyPosts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { page = 1, limit = 10, sort = "latest" } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) {
      return res.status(400).json({ success: false, message: "Invalid pagination values." });
    }

    const sortValue = String(sort || "latest").toLowerCase();
    const sortStage: Record<string, 1 | -1> =
      sortValue === "oldest" || sortValue === "older" ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };

    const match: Record<string, any> = { user: new mongoose.Types.ObjectId(userId), isDeleted: false };
    const total = await Post.countDocuments(match);

    let query = Post.find(match)
      .sort(sortStage)
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .populate("user", "name email phoneNumber avatar")
      .populate("author", "name email phoneNumber avatar")
      .populate("bestComment");

    if (canPopulatePet()) query = query.populate("pet");
    const posts = await query;

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "My posts fetched successfully.",
      data: {
        posts,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalPosts: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    console.error("getMyPosts error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch your posts.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updatePost = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid post id." });
    }

    const post = await Post.findOne({ _id: id, isDeleted: false });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (!isAdminUser(req) && post.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only post owner or admin can update this post." });
    }

    const { pet, caption, media, postType, tags, priority, location, status } = req.body as {
      pet?: string | null;
      caption?: string;
      media?: { url: string; type: "image" | "video" }[];
      postType?: PostType;
      tags?: string[];
      priority?: PostPriority;
      location?: string | null;
      status?: "active" | "hidden" | "reported";
    };

    if (postType && !ALLOWED_POST_TYPES.includes(postType)) {
      return res.status(400).json({ success: false, message: "Invalid post type." });
    }
    if (priority && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority value." });
    }
    if (media) {
      const hasInvalidMedia = !Array.isArray(media) || media.some((item) => !item?.url || !["image", "video"].includes(item.type));
      if (hasInvalidMedia) {
        return res.status(400).json({ success: false, message: "Invalid media payload." });
      }
      post.media = media;
    }
    if (typeof caption === "string") post.caption = caption.trim();
    if (pet !== undefined) {
      if (pet === null || pet === "") post.pet = undefined;
      else if (!mongoose.Types.ObjectId.isValid(pet)) {
        return res.status(400).json({ success: false, message: "Invalid pet id." });
      } else {
        post.pet = new mongoose.Types.ObjectId(pet);
      }
    }
    if (postType) post.postType = postType;
    if (tags) post.tags = normalizeTags(tags);
    if (location !== undefined) post.location = typeof location === "string" ? location.trim() : undefined;
    if (status && isAdminUser(req)) post.status = status;

    const effectiveType = postType || post.postType;
    if (effectiveType === "HELP") {
      post.priority = priority || post.priority || "MEDIUM";
    } else {
      post.priority = undefined;
      post.isResolved = false;
      post.bestComment = undefined;
    }

    if ((!post.caption || post.caption.trim().length === 0) && (!post.media || post.media.length === 0)) {
      return res.status(400).json({ success: false, message: "Post must have caption or media." });
    }

    await post.save();
    let query = Post.findById(post._id)
      .populate("user", "name email phoneNumber avatar")
      .populate("author", "name email phoneNumber avatar")
      .populate("bestComment");
    if (canPopulatePet()) query = query.populate("pet");
    const populated = await query;

    return res.status(200).json({
      success: true,
      message: "Post updated successfully.",
      data: populated,
    });
  } catch (err: any) {
    console.error("updatePost error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update post.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deletePost = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid post id." });
    }

    const post = await Post.findOne({ _id: id, isDeleted: false });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (!isAdminUser(req) && post.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only post owner or admin can delete this post." });
    }

    post.isDeleted = true;
    post.status = "hidden";
    await post.save();
    await Comment.updateMany({ post: post._id, isDeleted: false }, { $set: { isDeleted: true } });
    await Post.findByIdAndUpdate(post._id, { commentsCount: 0 });

    return res.status(200).json({
      success: true,
      message: "Post deleted successfully.",
      data: { postId: post._id },
    });
  } catch (err: any) {
    console.error("deletePost error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete post.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const toggleLikePost = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid post id." });
    }

    const post = await Post.findOne({ _id: id, isDeleted: false, status: "active" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const alreadyLiked = post.likes.some((like) => like.toString() === userId);
    if (alreadyLiked) {
      post.likes = post.likes.filter((like) => like.toString() !== userId);
    } else {
      post.likes.push(new mongoose.Types.ObjectId(userId));
      if (post.user.toString() !== userId) {
        await createNotification({
          recipientId: post.user.toString(),
          actorId: userId,
          type: "like_post",
          postId: post.id,
        });
      }
    }
    await post.save();

    return res.status(200).json({
      success: true,
      message: alreadyLiked ? "Post unliked successfully." : "Post liked successfully.",
      data: { liked: !alreadyLiked, likesCount: post.likes.length, postId: post._id },
    });
  } catch (err: any) {
    console.error("toggleLikePost error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle like.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const resolveHelpPost = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid post id." });
    }

    const post = await Post.findOne({ _id: id, isDeleted: false, status: "active" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (post.postType !== "HELP") {
      return res.status(400).json({ success: false, message: "Only HELP posts can be resolved." });
    }
    if (post.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only post owner can resolve this post." });
    }

    post.isResolved = Boolean(req.body?.isResolved ?? true);
    if (!post.isResolved) {
      post.bestComment = undefined;
    }
    await post.save();
    return res.status(200).json({
      success: true,
      message: "Post resolution updated successfully.",
      data: post,
    });
  } catch (err: any) {
    console.error("resolveHelpPost error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update post resolution.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const setBestComment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { commentId } = req.body as { commentId?: string };
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(id) || !commentId || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid post/comment id." });
    }

    const post = await Post.findOne({ _id: id, isDeleted: false, status: "active" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (post.postType !== "HELP") {
      return res.status(400).json({ success: false, message: "Best comment is only valid for HELP posts." });
    }
    if (post.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only post owner can set best comment." });
    }

    const comment = await Comment.findOne({ _id: commentId, post: post._id, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found for this post." });
    }

    post.bestComment = comment._id as mongoose.Types.ObjectId;
    post.isResolved = true;
    await post.save();

    return res.status(200).json({
      success: true,
      message: "Best comment selected successfully.",
      data: post,
    });
  } catch (err: any) {
    console.error("setBestComment error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to set best comment.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};
