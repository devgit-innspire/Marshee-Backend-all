import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middlewares/auth";
import ModerationReport, { ModerationReportStatus, ReportTargetType } from "../models/ModerationReport";
import Post from "../models/Post";
import Comment from "../models/Comment";
import User from "../models/User";

/** Include whole `profile` — do not mix `profile` and `profile.avatar` (MongoDB path collision). */
const USER_FIELDS = "name email phoneNumber profile role firebaseUID";

const getCurrentUserId = (req: AuthRequest): string | null => {
  const user = req.user as any;
  if (!user) return null;
  return user._id?.toString?.() || user.id?.toString?.() || null;
};

const syncCommentsCount = async (postId: mongoose.Types.ObjectId) => {
  const total = await Comment.countDocuments({ post: postId, isDeleted: false });
  await Post.findByIdAndUpdate(postId, { commentsCount: total });
};

/** Stricter than ObjectId.isValid (rejects non-canonical 12-byte strings). */
const isCanonicalObjectIdString = (id: string): boolean =>
  /^[a-fA-F0-9]{24}$/.test(id) && mongoose.Types.ObjectId.isValid(id);

function mapUserDoc(u: any): Record<string, unknown> | null {
  if (!u) return null;
  if (u instanceof mongoose.Types.ObjectId) {
    return { _id: u.toString() };
  }
  if (!u._id) return null;
  const avatar = u.profile?.avatar ?? u.avatar;
  return {
    _id: String(u._id),
    name: u.name,
    email: u.email,
    phoneNumber: u.phoneNumber,
    avatar: typeof avatar === "string" ? avatar : undefined,
  };
}

function formatReportDoc(doc: any): Record<string, unknown> {
  const o = doc.toObject ? doc.toObject() : doc;
  const reporter = mapUserDoc(o.reporter);
  const reportedUser = mapUserDoc(o.reportedUser);
  const reviewedBy = o.reviewedBy ? mapUserDoc(o.reviewedBy) : undefined;

  const base: Record<string, unknown> = {
    _id: String(o._id),
    targetType: o.targetType,
    reporter,
    reportedUser,
    reason: o.reason,
    description: o.description,
    status: o.status,
    reviewedBy: reviewedBy || undefined,
    reviewedAt: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : undefined,
    adminNotes: o.adminNotes,
    resolutionAction: o.resolutionAction,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
    updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : undefined,
  };

  if (o.post && typeof o.post === "object" && o.post._id) {
    const p = o.post;
    base.post = {
      _id: String(p._id),
      caption: p.caption,
      postType: p.postType,
      status: p.status,
      isDeleted: p.isDeleted,
    };
  }
  if (o.comment && typeof o.comment === "object" && o.comment._id) {
    const c = o.comment;
    const postRef = c.post;
    const postIdFromComment =
      postRef != null
        ? String(typeof postRef === "object" && postRef && "_id" in postRef ? (postRef as { _id: unknown })._id : postRef)
        : undefined;
    const postIdFromReport =
      o.post != null
        ? String(typeof o.post === "object" && o.post && "_id" in o.post ? (o.post as { _id: unknown })._id : o.post)
        : undefined;
    base.comment = {
      _id: String(c._id),
      text: c.text || c.content,
      postId: postIdFromComment || postIdFromReport,
    };
  }

  return base;
}

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

export const reportUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { reportedUserId, reason, description } = req.body as {
      reportedUserId?: string;
      reason?: string;
      description?: string;
    };

    if (!reportedUserId || !isCanonicalObjectIdString(reportedUserId)) {
      return res.status(400).json({ success: false, message: "Valid reportedUserId is required." });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Reason is required." });
    }

    if (reportedUserId === userId) {
      return res.status(400).json({ success: false, message: "You cannot report yourself." });
    }

    const reported = await User.findById(reportedUserId).select("_id");
    if (!reported) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const existing = await ModerationReport.findOne({
      reporter: userId,
      targetType: "user",
      reportedUser: reportedUserId,
      status: "pending",
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "You already have a pending report for this user.",
      });
    }

    const descStored =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : undefined;

    const report = await ModerationReport.create({
      targetType: "user" as ReportTargetType,
      reporter: new mongoose.Types.ObjectId(userId),
      reportedUser: new mongoose.Types.ObjectId(reportedUserId),
      reason: reason.trim(),
      description: descStored,
      status: "pending",
    });

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[moderation] user report saved _id=${String(report._id)} db=${mongoose.connection.db?.databaseName ?? "?"} collection=moderationreports`
      );
    }

    let populated;
    try {
      populated = await ModerationReport.findById(report._id)
        .populate("reporter", USER_FIELDS)
        .populate("reportedUser", USER_FIELDS);
    } catch (popErr: any) {
      console.error("reportUser populate warning (document saved):", popErr?.message || popErr);
      populated = await ModerationReport.findById(report._id);
    }

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      data: formatReportDoc(populated!),
    });
  } catch (err: any) {
    console.error("reportUser error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit report.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const reportPost = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { postId, reason, description } = req.body as {
      postId?: string;
      reason?: string;
      description?: string;
    };

    if (!postId || !isCanonicalObjectIdString(String(postId).trim())) {
      return res.status(400).json({ success: false, message: "Valid postId is required." });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Reason is required." });
    }

    const post = await Post.findOne({ _id: String(postId).trim(), isDeleted: false });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const authorId = post.user?.toString() || post.author?.toString();
    if (authorId === userId) {
      return res.status(400).json({ success: false, message: "You cannot report your own post." });
    }

    const postIdStr = String(postId).trim();

    const existing = await ModerationReport.findOne({
      reporter: userId,
      targetType: "post",
      post: postIdStr,
      status: "pending",
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "You already have a pending report for this post.",
      });
    }

    const descStored =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : undefined;

    const report = await ModerationReport.create({
      targetType: "post",
      reporter: new mongoose.Types.ObjectId(userId),
      reportedUser: post.user || post.author,
      post: post._id,
      reason: reason.trim(),
      description: descStored,
      status: "pending",
    });

    // Do not change the post: only admins may hide/delete via moderation actions.

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[moderation] post report saved _id=${String(report._id)} postId=${postIdStr} db=${mongoose.connection.db?.databaseName ?? "?"} collection=moderationreports`
      );
    }

    let populated;
    try {
      populated = await ModerationReport.findById(report._id)
        .populate("reporter", USER_FIELDS)
        .populate("reportedUser", USER_FIELDS)
        .populate("post", "caption postType status isDeleted");
    } catch (popErr: any) {
      console.error("reportPost populate warning (document saved):", popErr?.message || popErr);
      populated = await ModerationReport.findById(report._id);
    }

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      data: formatReportDoc(populated!),
    });
  } catch (err: any) {
    console.error("reportPost error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit report.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const reportComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { commentId, reason, description } = req.body as {
      commentId?: string;
      reason?: string;
      description?: string;
    };

    const commentIdStr = typeof commentId === "string" ? commentId.trim() : "";
    if (!commentIdStr || !isCanonicalObjectIdString(commentIdStr)) {
      return res.status(400).json({ success: false, message: "Valid commentId is required." });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Reason is required." });
    }

    const comment = await Comment.findOne({ _id: commentIdStr, isDeleted: false });
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }

    if (comment.user.toString() === userId) {
      return res.status(400).json({ success: false, message: "You cannot report your own comment." });
    }

    const existing = await ModerationReport.findOne({
      reporter: userId,
      targetType: "comment",
      comment: commentIdStr,
      status: "pending",
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "You already have a pending report for this comment.",
      });
    }

    const descStored =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : undefined;

    const report = await ModerationReport.create({
      targetType: "comment",
      reporter: new mongoose.Types.ObjectId(userId),
      reportedUser: comment.user,
      post: comment.post,
      comment: comment._id,
      reason: reason.trim(),
      description: descStored,
      status: "pending",
    });

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[moderation] comment report saved _id=${String(report._id)} commentId=${commentIdStr} db=${mongoose.connection.db?.databaseName ?? "?"} collection=moderationreports`
      );
    }

    let populated;
    try {
      populated = await ModerationReport.findById(report._id)
        .populate("reporter", USER_FIELDS)
        .populate("reportedUser", USER_FIELDS)
        .populate("post", "caption postType status isDeleted")
        .populate("comment", "text content post");
    } catch (popErr: any) {
      console.error("reportComment populate warning (document saved):", popErr?.message || popErr);
      populated = await ModerationReport.findById(report._id);
    }

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      data: formatReportDoc(populated!),
    });
  } catch (err: any) {
    console.error("reportComment error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit report.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const listReportsForAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      targetType,
      userId: reportedUserFilter,
    } = req.query;

    const pagination = parsePagination(page, limit);
    if (!pagination) {
      return res.status(400).json({ success: false, message: "Invalid pagination." });
    }

    const match: Record<string, unknown> = {};
    if (typeof status === "string" && status.trim()) {
      const s = status.trim() as ModerationReportStatus;
      if (["pending", "reviewed", "resolved", "dismissed"].includes(s)) {
        match.status = s;
      }
    }
    if (typeof targetType === "string" && targetType.trim()) {
      const t = targetType.trim() as ReportTargetType;
      if (["user", "post", "comment"].includes(t)) {
        match.targetType = t;
      }
    }
    if (typeof reportedUserFilter === "string" && mongoose.Types.ObjectId.isValid(reportedUserFilter)) {
      match.reportedUser = new mongoose.Types.ObjectId(reportedUserFilter);
    }

    const total = await ModerationReport.countDocuments(match);

    const docs = await ModerationReport.find(match)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .populate("reporter", USER_FIELDS)
      .populate("reportedUser", USER_FIELDS)
      .populate("reviewedBy", USER_FIELDS)
      .populate("post", "caption postType status isDeleted")
      .populate({
        path: "comment",
        select: "text content post",
        populate: { path: "post", select: "caption _id" },
      });

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    const reports = docs.map((d) => formatReportDoc(d));

    return res.status(200).json({
      success: true,
      message: "Reports retrieved successfully.",
      data: {
        reports,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalReports: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    console.error("listReportsForAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to list reports.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

type AdminAction =
  | "dismiss"
  | "resolve"
  | "mark_reviewed"
  | "hide_post"
  | "delete_post"
  | "delete_comment";

export const adminUpdateReport = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = getCurrentUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid report id." });
    }

    const { action, adminNotes } = req.body as { action?: AdminAction; adminNotes?: string };

    const allowed: AdminAction[] = [
      "dismiss",
      "resolve",
      "mark_reviewed",
      "hide_post",
      "delete_post",
      "delete_comment",
    ];
    if (!action || !allowed.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Use one of: ${allowed.join(", ")}.`,
      });
    }

    const report = await ModerationReport.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    const notes = typeof adminNotes === "string" ? adminNotes.trim() : "";

    if (action === "dismiss") {
      report.status = "dismissed";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "dismiss";
    } else if (action === "resolve") {
      report.status = "resolved";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "resolve";
    } else if (action === "mark_reviewed") {
      report.status = "reviewed";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "mark_reviewed";
    } else if (action === "hide_post") {
      if (report.targetType !== "post" || !report.post) {
        return res.status(400).json({ success: false, message: "This action applies only to post reports." });
      }
      const post = await Post.findOne({ _id: report.post, isDeleted: false });
      if (!post) {
        return res.status(404).json({ success: false, message: "Post not found or already removed." });
      }
      post.status = "hidden";
      await post.save();
      report.status = "resolved";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "hide_post";
    } else if (action === "delete_post") {
      if (report.targetType !== "post" || !report.post) {
        return res.status(400).json({ success: false, message: "This action applies only to post reports." });
      }
      const post = await Post.findOne({ _id: report.post, isDeleted: false });
      if (!post) {
        return res.status(404).json({ success: false, message: "Post not found or already removed." });
      }
      post.isDeleted = true;
      post.status = "hidden";
      await post.save();
      await Comment.updateMany({ post: post._id, isDeleted: false }, { $set: { isDeleted: true } });
      await Post.findByIdAndUpdate(post._id, { commentsCount: 0 });
      report.status = "resolved";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "delete_post";
    } else if (action === "delete_comment") {
      if (report.targetType !== "comment" || !report.comment) {
        return res.status(400).json({ success: false, message: "This action applies only to comment reports." });
      }
      const comment = await Comment.findOne({ _id: report.comment, isDeleted: false });
      if (!comment) {
        return res.status(404).json({ success: false, message: "Comment not found or already removed." });
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
      report.status = "resolved";
      report.reviewedBy = new mongoose.Types.ObjectId(adminId);
      report.reviewedAt = new Date();
      report.adminNotes = notes || report.adminNotes;
      report.resolutionAction = "delete_comment";
    }

    await report.save();

    const populated = await ModerationReport.findById(report._id)
      .populate("reporter", USER_FIELDS)
      .populate("reportedUser", USER_FIELDS)
      .populate("reviewedBy", USER_FIELDS)
      .populate("post", "caption postType status isDeleted")
      .populate("comment", "text content post");

    return res.status(200).json({
      success: true,
      message: "Report updated successfully.",
      data: formatReportDoc(populated!),
    });
  } catch (err: any) {
    console.error("adminUpdateReport error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update report.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const suspendUserAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = getCurrentUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { userId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid user id is required." });
    }

    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (target.role === "admin") {
      return res.status(403).json({ success: false, message: "Cannot suspend an admin user." });
    }

    const { reason, suspendUntil } = req.body as { reason?: string; suspendUntil?: string };
    const suspensionReason = typeof reason === "string" && reason.trim() ? reason.trim() : "Violation of community guidelines";

    let until: Date;
    if (typeof suspendUntil === "string" && suspendUntil.trim()) {
      const parsed = new Date(suspendUntil);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid suspendUntil date." });
      }
      until = parsed;
    } else {
      until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    target.isSuspended = true;
    target.suspendedUntil = until;
    target.suspensionReason = suspensionReason;
    target.suspendedBy = new mongoose.Types.ObjectId(adminId);
    target.suspendedAt = new Date();
    await target.save();

    return res.status(200).json({
      success: true,
      message: "User suspended successfully.",
      data: {
        userId: String(target._id),
        userName: target.name || target.phoneNumber || target.email || "User",
        suspendedAt: target.suspendedAt?.toISOString(),
        suspendedUntil: until.toISOString(),
        suspensionReason,
      },
    });
  } catch (err: any) {
    console.error("suspendUserAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to suspend user.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const listSuspendedUsersAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const users = await User.find({
      isSuspended: true,
      $or: [{ suspendedUntil: { $exists: false } }, { suspendedUntil: { $gt: now } }],
    })
      .select("name email phoneNumber role isSuspended suspendedUntil suspensionReason suspendedAt suspendedBy")
      .populate("suspendedBy", "name email")
      .sort({ suspendedAt: -1 })
      .lean();

    const suspendedUsers = users.map((u: any) => ({
      userId: String(u._id),
      userName: u.name || u.phoneNumber || u.email || "User",
      phoneNumber: u.phoneNumber,
      email: u.email,
      role: u.role,
      suspendedAt: u.suspendedAt ? new Date(u.suspendedAt).toISOString() : undefined,
      suspendedUntil: u.suspendedUntil ? new Date(u.suspendedUntil).toISOString() : undefined,
      suspensionReason: u.suspensionReason,
      suspendedBy: u.suspendedBy
        ? { name: (u.suspendedBy as any).name, email: (u.suspendedBy as any).email }
        : null,
    }));

    return res.status(200).json({
      success: true,
      message: "Suspended users retrieved successfully.",
      data: {
        count: suspendedUsers.length,
        suspendedUsers,
      },
    });
  } catch (err: any) {
    console.error("listSuspendedUsersAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to list suspended users.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const unsuspendUserAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Valid user id is required." });
    }

    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    target.isSuspended = false;
    target.suspendedUntil = undefined;
    target.suspensionReason = undefined;
    target.suspendedBy = undefined;
    target.suspendedAt = undefined;
    await target.save();

    return res.status(200).json({
      success: true,
      message: "User unsuspended successfully.",
      data: {
        userId: String(target._id),
        userName: target.name || target.phoneNumber || target.email || "User",
      },
    });
  } catch (err: any) {
    console.error("unsuspendUserAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to unsuspend user.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};
