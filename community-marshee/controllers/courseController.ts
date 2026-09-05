import { Response } from "express";
import mongoose from "mongoose";
import { Course } from "../models/Course";
import { Module } from "../models/Module";
import { Lesson } from "../models/Lessons";
import { CourseProgress } from "../models/CourseProgress";
import { Article } from "../models/Article";
import { Webinar } from "../models/Webinar";
import { AuthRequest } from "../middlewares/auth";
import { getCurrentUserId, isAdminUser } from "../utils/growAdmin";

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type GrowSearchSourceType = "course" | "article" | "webinar";

const SEARCH_TYPE_VALUES: GrowSearchSourceType[] = ["course", "article", "webinar"];
const SEARCH_SORT_VALUES = ["latest", "oldest", "title_asc", "title_desc", "duration_asc", "duration_desc"] as const;
type GrowSearchSort = (typeof SEARCH_SORT_VALUES)[number];

const toLowerString = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const buildSearchDateRange = (
  rawTime: unknown,
  rawFrom: unknown,
  rawTo: unknown
): { start?: Date; end?: Date; error?: string; resolvedTime: string } => {
  const now = new Date();
  const time = toLowerString(rawTime) || "all";
  const from = typeof rawFrom === "string" && rawFrom.trim() ? new Date(rawFrom) : undefined;
  const to = typeof rawTo === "string" && rawTo.trim() ? new Date(rawTo) : undefined;

  if (from && Number.isNaN(from.getTime())) {
    return { error: "from must be a valid ISO date string.", resolvedTime: time };
  }
  if (to && Number.isNaN(to.getTime())) {
    return { error: "to must be a valid ISO date string.", resolvedTime: time };
  }
  if (from && to && from > to) {
    return { error: "from cannot be greater than to.", resolvedTime: time };
  }

  if (from || to) return { start: from, end: to, resolvedTime: "custom" };
  if (time === "all") return { resolvedTime: "all" };

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const addDays = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  if (time === "today") return { start: startOfToday, end: now, resolvedTime: "today" };
  if (time === "7d") return { start: addDays(7), end: now, resolvedTime: "7d" };
  if (time === "30d") return { start: addDays(30), end: now, resolvedTime: "30d" };
  if (time === "90d") return { start: addDays(90), end: now, resolvedTime: "90d" };
  if (time === "this_month") return { start: startOfMonth, end: now, resolvedTime: "this_month" };
  if (time === "this_year") return { start: startOfYear, end: now, resolvedTime: "this_year" };
  if (time === "upcoming") return { start: now, resolvedTime: "upcoming" };
  if (time === "past") return { end: now, resolvedTime: "past" };

  return {
    error: "time must be one of all|today|7d|30d|90d|this_month|this_year|upcoming|past.",
    resolvedTime: time,
  };
};

const buildGrowSearchSortStage = (sortValue: GrowSearchSort) => {
  if (sortValue === "oldest") return { searchableDate: 1, _id: 1 };
  if (sortValue === "title_asc") return { sortTitle: 1, _id: -1 };
  if (sortValue === "title_desc") return { sortTitle: -1, _id: -1 };
  if (sortValue === "duration_asc") return { durationValue: 1, searchableDate: -1, _id: -1 };
  if (sortValue === "duration_desc") return { durationValue: -1, searchableDate: -1, _id: -1 };
  return { searchableDate: -1, _id: -1 };
};

const appendDateRangeToMatch = (match: Record<string, any>, field: string, start?: Date, end?: Date) => {
  if (!start && !end) return;
  match[field] = {
    ...(start ? { $gte: start } : {}),
    ...(end ? { $lte: end } : {}),
  };
};

const getCourseLessonIds = async (courseId: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> => {
  const modules = await Module.find({ course: courseId, isDeleted: false, status: "active" }).select("_id").lean();
  if (!modules.length) return [];
  const moduleIds = modules.map((m: any) => m._id as mongoose.Types.ObjectId);

  const lessons = await Lesson.find({ module: { $in: moduleIds }, isDeleted: false, status: "active" })
    .select("_id module")
    .lean();
  return lessons.map((l: any) => l._id as mongoose.Types.ObjectId);
};

const buildProgressPayload = async (
  userId: string,
  courseId: mongoose.Types.ObjectId
) => {
  const [course, progressDoc, lessonIds] = await Promise.all([
    Course.findOne({ _id: courseId, isDeleted: false, status: "active" }).lean(),
    CourseProgress.findOne({ user: userId, course: courseId }).lean(),
    getCourseLessonIds(courseId),
  ]);

  if (!course) return null;

  const totalLessons = lessonIds.length;
  const lessonIdSet = new Set(lessonIds.map((id: mongoose.Types.ObjectId) => id.toString()));
  const completedLessons = (progressDoc?.completedLessons || []).filter((id: any) => lessonIdSet.has(id.toString()));
  const completedCount = completedLessons.length;
  const progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedCount / totalLessons) * 100)) : 0;
  const isCompleted = totalLessons > 0 && completedCount >= totalLessons;

  return {
    courseId: course._id,
    enrolled: Boolean(progressDoc),
    totalLessons,
    completedCount,
    completedLessons,
    currentLesson: progressDoc?.currentLesson,
    progressPercent,
    isCompleted,
    enrolledAt: progressDoc?.enrolledAt,
    completedAt: progressDoc?.completedAt,
    lastAccessedAt: progressDoc?.lastAccessedAt,
  };
};

export const createCourse = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: "Admin privileges required." });
    }

    const {
      title,
      description,
      thumbnail,
      level,
      duration,
      featuresOfCourse,
      instructor,
    } = req.body as {
      title?: string;
      description?: string;
      thumbnail?: string;
      level?: string;
      duration?: number;
      featuresOfCourse?: string[];
      instructor?: { name?: string; image?: string; role?: string };
    };

    if (!title || typeof title !== "string") return res.status(400).json({ success: false, message: "title is required." });
    if (!description || typeof description !== "string") return res.status(400).json({ success: false, message: "description is required." });
    if (!thumbnail || typeof thumbnail !== "string") return res.status(400).json({ success: false, message: "thumbnail is required." });
    if (!level || typeof level !== "string") return res.status(400).json({ success: false, message: "level is required." });
    if (typeof duration !== "number" || duration < 1) return res.status(400).json({ success: false, message: "duration must be >= 1." });
    if (!instructor?.name || !instructor?.image || !instructor?.role) {
      return res.status(400).json({ success: false, message: "instructor.name/image/role are required." });
    }

    const course = await Course.create({
      title: title.trim(),
      description: description.trim(),
      thumbnail: thumbnail.trim(),
      level: level.toLowerCase().trim(),
      duration,
      featuresOfCourse: Array.isArray(featuresOfCourse)
        ? featuresOfCourse
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      instructor: {
        name: instructor.name.trim(),
        image: instructor.image.trim(),
        role: instructor.role.trim(),
      },
    });

    return res.status(201).json({ success: true, message: "Course created successfully.", data: course });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to create course.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getCourses = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, sort = "latest", level } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) return res.status(400).json({ success: false, message: "Invalid pagination values." });

    const match: Record<string, any> = { isDeleted: false, status: "active" };
    if (typeof level === "string" && level.trim()) match.level = level.toLowerCase().trim();

    const sortValue = String(sort).toLowerCase();
    // Mongoose sort typing can be too strict; this cast keeps runtime behavior unchanged.
    const sortStage: any = sortValue === "oldest" ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };

    const total = await Course.countDocuments(match);
    const courses = await Course.find(match)
      .sort(sortStage)
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .lean();

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Courses fetched successfully.",
      data: {
        courses,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalCourses: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch courses.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const searchGrowContent = async (req: AuthRequest, res: Response) => {
  try {
    const { q = "", type = "all", level, category, live, sort = "latest", time = "all", from, to, page = 1, limit = 12 } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) return res.status(400).json({ success: false, message: "Invalid pagination values." });

    const query = typeof q === "string" ? q.trim() : "";
    const safeRegex = query ? new RegExp(escapeRegex(query), "i") : null;
    const requestedType = String(type).toLowerCase();
    const allowedTypes = ["all", ...SEARCH_TYPE_VALUES];
    if (!allowedTypes.includes(requestedType)) {
      return res.status(400).json({ success: false, message: "type must be one of all|course|article|webinar." });
    }

    const sortValue = String(sort).toLowerCase();
    if (!SEARCH_SORT_VALUES.includes(sortValue as GrowSearchSort)) {
      return res.status(400).json({
        success: false,
        message: "sort must be one of latest|oldest|title_asc|title_desc|duration_asc|duration_desc.",
      });
    }

    const dateRange = buildSearchDateRange(time, from, to);
    if (dateRange.error) {
      return res.status(400).json({ success: false, message: dateRange.error });
    }

    const includeTypes: GrowSearchSourceType[] =
      requestedType === "all" ? SEARCH_TYPE_VALUES : [requestedType as GrowSearchSourceType];
    const includeCourse = includeTypes.includes("course");
    const includeArticle = includeTypes.includes("article");
    const includeWebinar = includeTypes.includes("webinar");

    const courseMatch: Record<string, any> = { isDeleted: false, status: "active" };
    const articleMatch: Record<string, any> = { isDeleted: false, status: "active" };
    const webinarMatch: Record<string, any> = { isDeleted: false, status: "active" };

    if (safeRegex) {
      courseMatch.$or = [{ title: safeRegex }, { description: safeRegex }, { "instructor.name": safeRegex }];
      articleMatch.$or = [{ title: safeRegex }, { description: safeRegex }, { "author.name": safeRegex }];
      webinarMatch.$or = [{ title: safeRegex }, { description: safeRegex }, { "speaker.name": safeRegex }];
    }

    if (typeof level === "string" && level.trim()) courseMatch.level = level.toLowerCase().trim();
    if (typeof category === "string" && category.trim()) articleMatch.category = category.toLowerCase().trim();
    if (typeof live === "string") webinarMatch.isLive = live === "true";

    appendDateRangeToMatch(courseMatch, "createdAt", dateRange.start, dateRange.end);
    appendDateRangeToMatch(articleMatch, "createdAt", dateRange.start, dateRange.end);
    appendDateRangeToMatch(webinarMatch, "date", dateRange.start, dateRange.end);

    const buildSourcePipeline = (source: GrowSearchSourceType): any[] => {
      if (source === "course") {
        return [
          { $match: courseMatch },
          {
            $project: {
              _id: 1,
              itemType: { $literal: "course" },
              title: "$title",
              subtitle: "$description",
              image: "$thumbnail",
              meta: { $concat: [{ $ifNull: ["$level", ""] }, " • ", { $toString: { $ifNull: ["$duration", 0] } }, " min"] },
              searchableDate: { $ifNull: ["$createdAt", new Date(0)] },
              durationValue: { $ifNull: ["$duration", 0] },
              sortTitle: { $toLower: { $ifNull: ["$title", ""] } },
              level: "$level",
              category: null,
              isLive: null,
              readTime: null,
              duration: "$duration",
            },
          },
        ];
      }

      if (source === "article") {
        return [
          { $match: articleMatch },
          {
            $project: {
              _id: 1,
              itemType: { $literal: "article" },
              title: "$title",
              subtitle: "$description",
              image: "$coverImage",
              meta: {
                $concat: [{ $ifNull: ["$category", ""] }, " • ", { $toString: { $ifNull: ["$readTime", 0] } }, " min read"],
              },
              searchableDate: { $ifNull: ["$createdAt", new Date(0)] },
              durationValue: { $ifNull: ["$readTime", 0] },
              sortTitle: { $toLower: { $ifNull: ["$title", ""] } },
              level: null,
              category: "$category",
              isLive: null,
              readTime: "$readTime",
              duration: null,
            },
          },
        ];
      }

      return [
        { $match: webinarMatch },
        {
          $project: {
            _id: 1,
            itemType: { $literal: "webinar" },
            title: "$title",
            subtitle: "$description",
            image: "$coverImage",
            meta: {
              $concat: [
                { $cond: [{ $eq: ["$isLive", true] }, "Live", "Recorded"] },
                " • ",
                { $toString: { $ifNull: ["$duration", 0] } },
                " min",
              ],
            },
            searchableDate: { $ifNull: ["$date", new Date(0)] },
            durationValue: { $ifNull: ["$duration", 0] },
            sortTitle: { $toLower: { $ifNull: ["$title", ""] } },
            level: null,
            category: null,
            isLive: "$isLive",
            readTime: null,
            duration: "$duration",
          },
        },
      ];
    };

    const modelBySource: Record<GrowSearchSourceType, any> = {
      course: Course,
      article: Article,
      webinar: Webinar,
    };

    const [primarySource, ...secondarySources] = includeTypes;
    const primaryModel = modelBySource[primarySource];
    const pipeline: any[] = [...buildSourcePipeline(primarySource)];

    for (const source of secondarySources) {
      pipeline.push({
        $unionWith: {
          coll: modelBySource[source].collection.name,
          pipeline: buildSourcePipeline(source),
        },
      });
    }

    pipeline.push(
      { $sort: buildGrowSearchSortStage(sortValue as GrowSearchSort) },
      {
        $facet: {
          results: [
            { $skip: pagination.skip },
            { $limit: pagination.limitNum },
            { $project: { durationValue: 0, sortTitle: 0 } },
          ],
          totals: [{ $count: "totalResults" }],
          countsByType: [{ $group: { _id: "$itemType", count: { $sum: 1 } } }],
        },
      }
    );

    const [aggregated] = await primaryModel.aggregate(pipeline).allowDiskUse(true);
    const results = Array.isArray(aggregated?.results) ? aggregated.results : [];
    const totalResults = Number(aggregated?.totals?.[0]?.totalResults || 0);
    const totalPages = Math.ceil(totalResults / pagination.limitNum) || 1;
    const typeCounts = Array.isArray(aggregated?.countsByType)
      ? aggregated.countsByType.reduce(
          (acc: Record<string, number>, item: { _id: string; count: number }) => ({ ...acc, [item._id]: item.count }),
          {}
        )
      : {};

    return res.status(200).json({
      success: true,
      message: "Grow search results fetched successfully.",
      data: {
        results,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalResults,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
        filters: {
          q: query,
          type: requestedType,
          sort: sortValue,
          time: dateRange.resolvedTime,
          from: dateRange.start,
          to: dateRange.end,
          level: typeof level === "string" ? level : undefined,
          category: typeof category === "string" ? category : undefined,
          live: typeof live === "string" ? live : undefined,
        },
        countsByType: {
          all: totalResults,
          course: Number(typeCounts.course || 0),
          article: Number(typeCounts.article || 0),
          webinar: Number(typeCounts.webinar || 0),
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to search grow content.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getCourseById = async (req: AuthRequest, res: Response) => {
  try {
    const { courseId } = req.params;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course id." });
    }

    const course = await Course.findOne({ _id: courseId, isDeleted: false, status: "active" }).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });
    const modules = await Module.find({ course: courseId, isDeleted: false, status: "active" })
      .sort({ order: 1, createdAt: 1 } as any)
      .lean();

    const moduleIds = modules.map((m: any) => m._id);
    const lessons = moduleIds.length
      ? await Lesson.find({ module: { $in: moduleIds }, isDeleted: false, status: "active" })
          .sort({ order: 1, createdAt: 1 } as any)
          .lean()
      : [];

    const lessonsByModule = new Map<string, any[]>();
    lessons.forEach((l: any) => {
      const mid = l.module?.toString?.() ?? String(l.module);
      const list = lessonsByModule.get(mid) ?? [];
      list.push(l);
      lessonsByModule.set(mid, list);
    });

    const modulesWithLessons = modules.map((m: any) => ({
      ...m,
      lessons: lessonsByModule.get(m._id.toString()) ?? [],
    }));

    return res.status(200).json({
      success: true,
      message: "Course fetched successfully.",
      data: {
        ...course,
        modules: modulesWithLessons,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch course.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateCourse = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid course id." });

    const course = await Course.findById(id);
    if (!course || course.isDeleted) return res.status(404).json({ success: false, message: "Course not found." });

    const body = req.body as Partial<{
      title: string;
      description: string;
      thumbnail: string;
      level: string;
      duration: number;
      featuresOfCourse: string[];
      instructor: { name: string; image: string; role: string };
      status: "active" | "hidden";
    }>;

    if (typeof body.title === "string") course.title = body.title.trim();
    if (typeof body.description === "string") course.description = body.description.trim();
    if (typeof body.thumbnail === "string") course.thumbnail = body.thumbnail.trim();
    if (typeof body.level === "string") course.level = body.level.toLowerCase().trim() as any;
    if (typeof body.duration === "number") course.duration = body.duration;
    if (Array.isArray(body.featuresOfCourse)) {
      course.featuresOfCourse = body.featuresOfCourse
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (body.instructor) {
      if (!body.instructor.name || !body.instructor.image || !body.instructor.role) {
        return res.status(400).json({ success: false, message: "instructor.name/image/role are required." });
      }
      course.instructor = {
        name: body.instructor.name.trim(),
        image: body.instructor.image.trim(),
        role: body.instructor.role.trim(),
      } as any;
    }
    if (body.status) course.status = body.status;

    await course.save();
    return res.status(200).json({ success: true, message: "Course updated successfully.", data: course });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update course.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteCourse = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid course id." });

    const course = await Course.findById(id);
    if (!course || course.isDeleted) return res.status(404).json({ success: false, message: "Course not found." });

    // Soft-delete cascade: modules -> lessons.
    const modules = await Module.find({ course: course._id, isDeleted: false }).select("_id").lean();
    const moduleIds = modules.map((m: any) => m._id as mongoose.Types.ObjectId);

    await Course.findByIdAndUpdate(course._id, { isDeleted: true, status: "hidden" });

    await Module.updateMany(
      { course: course._id, _id: { $in: moduleIds } },
      { isDeleted: true, status: "hidden" }
    );
    await Lesson.updateMany(
      { module: { $in: moduleIds }, isDeleted: false },
      { isDeleted: true, status: "hidden" }
    );

    return res.status(200).json({
      success: true,
      message: "Course deleted successfully.",
      data: { courseId: course._id, modulesDeleted: moduleIds.length },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete course.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const enrollInCourse = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const { courseId } = req.params;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course id." });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const course = await Course.findOne({ _id: courseObjectId, isDeleted: false, status: "active" }).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });

    const existing = await CourseProgress.findOne({ user: userId, course: courseObjectId });
    if (!existing) {
      await CourseProgress.create({
        user: new mongoose.Types.ObjectId(userId),
        course: courseObjectId,
      });
    }

    const progress = await buildProgressPayload(userId, courseObjectId);

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Already enrolled in course." : "Course enrolled successfully.",
      data: progress,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to enroll in course.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getMyCourseProgress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const progressDocs = await CourseProgress.find({ user: userId })
      .sort({ lastAccessedAt: -1 })
      .populate("course", "title thumbnail level duration status isDeleted")
      .lean();

    const data = progressDocs
      .filter((doc: any) => doc?.course && doc.course.status === "active" && !doc.course.isDeleted)
      .map((doc: any) => ({
        courseId: doc.course._id,
        course: doc.course,
        completedLessons: doc.completedLessons,
        currentLesson: doc.currentLesson,
        progressPercent: doc.progressPercent ?? 0,
        isCompleted: Boolean(doc.isCompleted),
        enrolledAt: doc.enrolledAt,
        completedAt: doc.completedAt,
        lastAccessedAt: doc.lastAccessedAt,
      }));

    return res.status(200).json({
      success: true,
      message: "Course progress fetched successfully.",
      data,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch course progress.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getCourseProgress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const { courseId } = req.params;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course id." });
    }

    const progress = await buildProgressPayload(userId, new mongoose.Types.ObjectId(courseId));
    if (!progress) return res.status(404).json({ success: false, message: "Course not found." });

    return res.status(200).json({
      success: true,
      message: "Course progress fetched successfully.",
      data: progress,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch course progress.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const markLessonCompleted = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const { courseId, lessonId } = req.params;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course id." });
    }
    if (!lessonId || !mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ success: false, message: "Invalid lesson id." });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const lessonObjectId = new mongoose.Types.ObjectId(lessonId);

    const [course, moduleIds] = await Promise.all([
      Course.findOne({ _id: courseObjectId, isDeleted: false, status: "active" }).lean(),
      Module.find({ course: courseObjectId, isDeleted: false, status: "active" }).select("_id").lean(),
    ]);
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });
    const moduleIdValues = moduleIds.map((m: any) => m._id);
    const lesson = await Lesson.findOne({
      _id: lessonObjectId,
      module: { $in: moduleIdValues },
      isDeleted: false,
      status: "active",
    }).lean();
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found in this course." });
    }

    const progressDoc =
      (await CourseProgress.findOne({ user: userId, course: courseObjectId })) ||
      (await CourseProgress.create({
        user: new mongoose.Types.ObjectId(userId),
        course: courseObjectId,
      }));

    const alreadyCompleted = progressDoc.completedLessons.some((id) => id.toString() === lessonObjectId.toString());
    if (!alreadyCompleted) progressDoc.completedLessons.push(lessonObjectId);
    progressDoc.currentLesson = lessonObjectId;
    progressDoc.lastAccessedAt = new Date();

    const totalLessons = await Lesson.countDocuments({
      module: { $in: moduleIdValues },
      isDeleted: false,
      status: "active",
    });
    const completedCount = progressDoc.completedLessons.length;
    progressDoc.progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedCount / totalLessons) * 100)) : 0;
    progressDoc.isCompleted = totalLessons > 0 && completedCount >= totalLessons;
    progressDoc.completedAt = progressDoc.isCompleted ? new Date() : undefined;

    await progressDoc.save();

    return res.status(200).json({
      success: true,
      message: alreadyCompleted ? "Lesson was already completed." : "Lesson marked as completed.",
      data: {
        courseId: courseObjectId,
        lessonId: lessonObjectId,
        totalLessons,
        completedCount,
        progressPercent: progressDoc.progressPercent,
        isCompleted: progressDoc.isCompleted,
        currentLesson: progressDoc.currentLesson,
        completedLessons: progressDoc.completedLessons,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark lesson completed.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const removeCompletedLesson = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const { courseId, lessonId } = req.params;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: "Invalid course id." });
    }
    if (!lessonId || !mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ success: false, message: "Invalid lesson id." });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const lessonObjectId = new mongoose.Types.ObjectId(lessonId);

    const [course, moduleIds] = await Promise.all([
      Course.findOne({ _id: courseObjectId, isDeleted: false, status: "active" }).lean(),
      Module.find({ course: courseObjectId, isDeleted: false, status: "active" }).select("_id").lean(),
    ]);
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });

    const moduleIdValues = moduleIds.map((m: any) => m._id);
    const lesson = await Lesson.findOne({
      _id: lessonObjectId,
      module: { $in: moduleIdValues },
      isDeleted: false,
      status: "active",
    }).lean();
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found in this course." });
    }

    const progressDoc = await CourseProgress.findOne({ user: userId, course: courseObjectId });
    if (!progressDoc) {
      return res.status(404).json({ success: false, message: "You are not enrolled in this course." });
    }

    const beforeCount = progressDoc.completedLessons.length;
    progressDoc.completedLessons = progressDoc.completedLessons.filter(
      (id) => id.toString() !== lessonObjectId.toString()
    );
    const removed = beforeCount !== progressDoc.completedLessons.length;

    if (progressDoc.currentLesson?.toString() === lessonObjectId.toString()) {
      progressDoc.currentLesson = undefined;
    }
    progressDoc.lastAccessedAt = new Date();

    const totalLessons = await Lesson.countDocuments({
      module: { $in: moduleIdValues },
      isDeleted: false,
      status: "active",
    });
    const completedCount = progressDoc.completedLessons.length;
    progressDoc.progressPercent = totalLessons > 0 ? Math.min(100, Math.round((completedCount / totalLessons) * 100)) : 0;
    progressDoc.isCompleted = totalLessons > 0 && completedCount >= totalLessons;
    progressDoc.completedAt = progressDoc.isCompleted ? progressDoc.completedAt || new Date() : undefined;

    await progressDoc.save();

    return res.status(200).json({
      success: true,
      message: removed ? "Completed lesson removed successfully." : "Lesson was not marked as completed.",
      data: {
        courseId: courseObjectId,
        lessonId: lessonObjectId,
        totalLessons,
        completedCount,
        progressPercent: progressDoc.progressPercent,
        isCompleted: progressDoc.isCompleted,
        currentLesson: progressDoc.currentLesson,
        completedLessons: progressDoc.completedLessons,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to remove completed lesson.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

