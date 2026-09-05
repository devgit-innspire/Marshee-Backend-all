import { Response } from "express";
import mongoose from "mongoose";
import { Module } from "../models/Module";
import { Lesson } from "../models/Lessons";
import { Course } from "../models/Course";
import { AuthRequest } from "../middlewares/auth";
import { getCurrentUserId, isAdminUser } from "../utils/growAdmin";

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

export const createModule = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { courseId, title, order } = req.body as {
      courseId?: string;
      title?: string;
      order?: number;
    };

    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Valid courseId is required." });
    }
    if (!title || typeof title !== "string") return res.status(400).json({ success: false, message: "title is required." });
    if (typeof order !== "number" || order < 1) return res.status(400).json({ success: false, message: "order must be >= 1." });

    const course = await Course.findOne({ _id: courseId, isDeleted: false, status: "active" });
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });

    const module = await Module.create({
      course: new mongoose.Types.ObjectId(courseId),
      title: title.trim(),
      order,
    });

    return res.status(201).json({ success: true, message: "Module created successfully.", data: module });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to create module.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getModules = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, courseId } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) return res.status(400).json({ success: false, message: "Invalid pagination values." });

    const match: Record<string, any> = { isDeleted: false, status: "active" };
    if (typeof courseId === "string" && courseId.trim()) {
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ success: false, message: "Invalid courseId." });
      }
      match.course = new mongoose.Types.ObjectId(courseId);
    }

    const total = await Module.countDocuments(match);
    const modules = await Module.find(match)
      .sort({ order: 1, createdAt: 1 })
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .lean();

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Modules fetched successfully.",
      data: {
        modules,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalModules: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch modules.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getModuleById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid module id." });

    const module = await Module.findOne({ _id: id, isDeleted: false, status: "active" }).lean();
    if (!module) return res.status(404).json({ success: false, message: "Module not found." });

    const lessons = await Lesson.find({ module: id, isDeleted: false, status: "active" })
      .sort({ order: 1, createdAt: 1 } as any)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Module fetched successfully.",
      data: {
        ...module,
        lessons,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch module.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateModule = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid module id." });

    const module = await Module.findById(id);
    if (!module || module.isDeleted) return res.status(404).json({ success: false, message: "Module not found." });

    const body = req.body as Partial<{ courseId: string; title: string; order: number; status: "active" | "hidden" }>;

    if (typeof body.title === "string") module.title = body.title.trim();
    if (typeof body.order === "number") module.order = body.order;
    if (body.status) module.status = body.status;
    if (body.courseId) {
      if (!mongoose.Types.ObjectId.isValid(body.courseId)) return res.status(400).json({ success: false, message: "Invalid courseId." });
      module.course = new mongoose.Types.ObjectId(body.courseId);
    }

    await module.save();
    return res.status(200).json({ success: true, message: "Module updated successfully.", data: module });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update module.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteModule = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid module id." });

    const module = await Module.findById(id);
    if (!module || module.isDeleted) return res.status(404).json({ success: false, message: "Module not found." });

    await Module.findByIdAndUpdate(module._id, { isDeleted: true, status: "hidden" });
    await Lesson.updateMany({ module: module._id, isDeleted: false }, { isDeleted: true, status: "hidden" });

    return res.status(200).json({
      success: true,
      message: "Module deleted successfully.",
      data: { moduleId: module._id },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete module.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

