import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middlewares/auth";
import Post from "../models/Post";
import Comment from "../models/Comment";
import { createNotification } from "../services/notificationService";

const getCurrentUserId = (req: AuthRequest): string | null => {
  const user = req.user as any;
  if (!user) return null;
  return user._id?.toString?.() || user.id?.toString?.() || null;
};

const isAdminUser = (req: AuthRequest): boolean => {
  const user = req.user as any;
  return user?.role === "admin";
};

const syncCommentsCount = async (postId: mongoose.Types.ObjectId) => {
  const total = await Comment.countDocuments({ post: postId, isDeleted: false });
  await Post.findByIdAndUpdate(postId, { commentsCount: total });
};

const getPostOwnerId = (post: any): string | null => {
  return post?.user?.toString?.() || post?.author?.toString?.() || null;
};

export const addComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { postId, text } = req.body as { postId?: string; text?: string };
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Valid postId is required." });
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, message: "Comment text is required." });
    }

    const post = await Post.findOne({ _id: postId, isDeleted: false, status: "active" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const comment = await Comment.create({
      post: post._id,
      user: new mongoose.Types.ObjectId(userId),
      text: text.trim(),
      content: text.trim(),
    });

    await syncCommentsCount(post._id as mongoose.Types.ObjectId);

    const postOwnerId = getPostOwnerId(post);
    if (postOwnerId && postOwnerId !== userId) {
      await createNotification({
        recipientId: postOwnerId,
        actorId: userId,
        type: "reply_post",
          postId: post.id,
          commentId: comment.id,
      });
    }

    const populated = await Comment.findById(comment.id).populate("user", "name email phoneNumber avatar");
    return res.status(201).json({
      success: true,
      message: "Comment added successfully.",
      data: populated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to add comment.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const replyToComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { postId, parentCommentId, text } = req.body as {
      postId?: string;
      parentCommentId?: string;
      text?: string;
    };
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Valid postId is required." });
    }
    if (!parentCommentId || !mongoose.Types.ObjectId.isValid(parentCommentId)) {
      return res.status(400).json({ success: false, message: "Valid parentCommentId is required." });
    }
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, message: "Reply text is required." });
    }

    const [post, parent] = await Promise.all([
      Post.findOne({ _id: postId, isDeleted: false, status: "active" }),
      Comment.findOne({ _id: parentCommentId, post: postId, isDeleted: false }),
    ]);

    if (!post) return res.status(404).json({ success: false, message: "Post not found." });
    if (!parent) return res.status(404).json({ success: false, message: "Parent comment not found." });

    const comment = await Comment.create({
      post: post._id,
      user: new mongoose.Types.ObjectId(userId),
      parentComment: parent._id,
      text: text.trim(),
      content: text.trim(),
    });

    await syncCommentsCount(post._id as mongoose.Types.ObjectId);

    const parentOwnerId = parent.user.toString();
    const postOwnerId = getPostOwnerId(post);

    if (parentOwnerId !== userId) {
      await createNotification({
        recipientId: parentOwnerId,
        actorId: userId,
        type: "reply_comment",
        postId: post.id,
        commentId: comment.id,
      });
    }

    // Also notify the original post owner when someone comments/replies on their post.
    if (
      postOwnerId &&
      postOwnerId !== userId &&
      postOwnerId !== parentOwnerId
    ) {
      await createNotification({
        recipientId: postOwnerId,
        actorId: userId,
        type: "reply_post",
        postId: post.id,
        commentId: comment.id,
      });
    }

    const populated = await Comment.findById(comment.id)
      .populate("user", "name email phoneNumber avatar")
      .populate("parentComment", "text");

    return res.status(201).json({
      success: true,
      message: "Reply added successfully.",
      data: populated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to add reply.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getCommentsByPost = async (req: AuthRequest, res: Response) => {
  try {
    const { postId } = req.params;
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Valid post id is required." });
    }

    const post = await Post.findOne({ _id: postId, isDeleted: false, status: "active" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const comments = await Comment.find({ post: postId, isDeleted: false })
      .populate("user", "name email phoneNumber avatar")
      .sort({ createdAt: 1 })
      .lean();

    const byParent = new Map<string, any[]>();
    const roots: any[] = [];

    comments.forEach((comment) => {
      const parentId = comment.parentComment ? comment.parentComment.toString() : "";
      if (!parentId) {
        roots.push({ ...comment, replies: [] });
        return;
      }
      const siblings = byParent.get(parentId) || [];
      siblings.push({ ...comment, replies: [] });
      byParent.set(parentId, siblings);
    });

    const attachReplies = (nodes: any[]) => {
      nodes.forEach((node) => {
        node.replies = byParent.get(node._id.toString()) || [];
        attachReplies(node.replies);
      });
    };
    attachReplies(roots);

    return res.status(200).json({
      success: true,
      message: "Comments fetched successfully.",
      data: roots,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch comments.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getCommentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Valid comment id is required." });
    }

    const comment = await Comment.findOne({ _id: id, isDeleted: false })
      .populate("user", "name email phoneNumber avatar")
      .populate("parentComment", "text content");
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Comment fetched successfully.",
      data: comment,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch comment.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getMyComments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const comments = await Comment.find({ user: userId, isDeleted: false })
      .populate("user", "name email phoneNumber avatar")
      .populate("post", "caption postType media")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "My comments fetched successfully.",
      data: comments,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch your comments.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const updateComment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Valid comment id is required." });
    }

    const { text, content } = req.body as { text?: string; content?: string };
    const nextText = String(text ?? content ?? "").trim();
    if (!nextText) {
      return res.status(400).json({ success: false, message: "Comment text is required." });
    }

    const comment = await Comment.findOne({ _id: id, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }
    if (!isAdminUser(req) && comment.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only comment owner or admin can update this comment." });
    }

    comment.text = nextText;
    comment.content = nextText;
    await comment.save();

    const populated = await Comment.findById(comment._id)
      .populate("user", "name email phoneNumber avatar")
      .populate("parentComment", "text content");

    return res.status(200).json({
      success: true,
      message: "Comment updated successfully.",
      data: populated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update comment.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const deleteComment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Valid comment id is required." });
    }

    const comment = await Comment.findOne({ _id: id, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }
    if (!isAdminUser(req) && comment.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only comment owner or admin can delete this comment." });
    }

    const queue: mongoose.Types.ObjectId[] = [comment._id as mongoose.Types.ObjectId];
    const allIds: mongoose.Types.ObjectId[] = [];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      allIds.push(currentId);
      const children = await Comment.find({ parentComment: currentId, isDeleted: false }).select("_id");
      children.forEach((child) => queue.push(child._id as mongoose.Types.ObjectId));
    }

    await Comment.updateMany({ _id: { $in: allIds } }, { $set: { isDeleted: true } });
    await syncCommentsCount(comment.post as mongoose.Types.ObjectId);

    return res.status(200).json({
      success: true,
      message: "Comment deleted successfully.",
      data: { commentId: comment._id, deletedCount: allIds.length },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete comment.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
