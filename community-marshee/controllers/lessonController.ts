import { Response } from "express";
import mongoose from "mongoose";
import { Lesson } from "../models/Lessons";
import { Module } from "../models/Module";
import { CourseProgress } from "../models/CourseProgress";
import { AuthRequest } from "../middlewares/auth";
import { getCurrentUserId, isAdminUser } from "../utils/growAdmin";
import { LessonType } from "../types/grow.types";

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

const normalizeLessonType = (value: unknown): LessonType | null => {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase().trim();
  return (Object.values(LessonType) as string[]).includes(v) ? (v as LessonType) : null;
};

type LessonContentBlockInput = {
  type: "heading" | "paragraph" | "highlight" | "list";
  text?: string;
  level?: 1 | 2 | 3;
  title?: string;
  items?: Array<{ text?: string }>;
  bgColor?: string;
  textColor?: string;
  icon?: string;
};

type QuizQuestionInput = {
  question: string;
  questionType: "single" | "multiple";
  options: Array<{ text: string }>;
  correctOptionIndexes: number[];
  explanation?: string;
};

type QuizSubmissionInput = {
  questionIndex: number;
  selectedOptionIndexes: number[];
};

const normalizeContentBlocks = (content: unknown): LessonContentBlockInput[] => {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
    .map((block) => {
      const rawType = typeof block.type === "string" ? block.type.trim().toLowerCase() : "";
      if (!["heading", "paragraph", "highlight", "list"].includes(rawType)) return null;
      const normalized: LessonContentBlockInput = { type: rawType as LessonContentBlockInput["type"] };

      if (typeof block.text === "string") normalized.text = block.text.trim();
      if (typeof block.level === "number" && [1, 2, 3].includes(block.level)) normalized.level = block.level as 1 | 2 | 3;
      if (typeof block.title === "string") normalized.title = block.title.trim();
      if (Array.isArray(block.items)) {
        normalized.items = block.items
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({ text: typeof item.text === "string" ? item.text.trim() : "" }))
          .filter((item) => Boolean(item.text));
      }
      if (typeof block.bgColor === "string") normalized.bgColor = block.bgColor.trim();
      if (typeof block.textColor === "string") normalized.textColor = block.textColor.trim();
      if (typeof block.icon === "string") normalized.icon = block.icon.trim();

      return normalized;
    })
    .filter((block): block is LessonContentBlockInput => Boolean(block));
};

const normalizeQuizQuestions = (quiz: unknown): { data: QuizQuestionInput[]; error?: string } => {
  if (!Array.isArray(quiz)) return { data: [] };

  const normalized: QuizQuestionInput[] = [];
  for (let i = 0; i < quiz.length; i += 1) {
    const raw = quiz[i];
    if (!raw || typeof raw !== "object") return { data: [], error: `quiz[${i}] must be an object.` };
    const q = raw as Record<string, unknown>;
    const question = typeof q.question === "string" ? q.question.trim() : "";
    if (!question) return { data: [], error: `quiz[${i}].question is required.` };

    const questionType = typeof q.questionType === "string" ? q.questionType.trim().toLowerCase() : "single";
    if (!["single", "multiple"].includes(questionType)) {
      return { data: [], error: `quiz[${i}].questionType must be single or multiple.` };
    }

    if (!Array.isArray(q.options) || q.options.length < 2) {
      return { data: [], error: `quiz[${i}] must have at least 2 options.` };
    }
    const options = q.options
      .filter((opt): opt is Record<string, unknown> => Boolean(opt) && typeof opt === "object")
      .map((opt) => ({ text: typeof opt.text === "string" ? opt.text.trim() : "" }))
      .filter((opt) => Boolean(opt.text));
    if (options.length < 2) return { data: [], error: `quiz[${i}] must have at least 2 valid options.` };

    if (!Array.isArray(q.correctOptionIndexes) || q.correctOptionIndexes.length < 1) {
      return { data: [], error: `quiz[${i}] must have at least 1 correct option index.` };
    }
    const correctOptionIndexes = Array.from(new Set(q.correctOptionIndexes.map((x) => Number(x))))
      .filter((x) => Number.isInteger(x) && x >= 0 && x < options.length);
    if (correctOptionIndexes.length < 1) return { data: [], error: `quiz[${i}] has invalid correctOptionIndexes.` };
    if (questionType === "single" && correctOptionIndexes.length !== 1) {
      return { data: [], error: `quiz[${i}] single-choice must have exactly 1 correct option index.` };
    }

    normalized.push({
      question,
      questionType: questionType as "single" | "multiple",
      options,
      correctOptionIndexes,
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : undefined,
    });
  }
  return { data: normalized };
};

const serializeLesson = (lesson: any) => ({
  ...lesson,
  thumbnail: lesson?.thumbnail ?? null,
  content: Array.isArray(lesson?.content) ? lesson.content : [],
  quiz: Array.isArray(lesson?.quiz) ? lesson.quiz : [],
});

export const createLesson = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { moduleId, title, videoUrl, thumbnail, duration, type, order, content, quiz } = req.body as {
      moduleId?: string;
      title?: string;
      videoUrl?: string;
      thumbnail?: string;
      duration?: number;
      type?: string;
      order?: number;
      content?: unknown;
      quiz?: unknown;
    };

    if (!moduleId || !mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ success: false, message: "Valid moduleId is required." });
    }
    if (!title || typeof title !== "string") return res.status(400).json({ success: false, message: "title is required." });
    if (typeof duration !== "number" || duration < 1) return res.status(400).json({ success: false, message: "duration must be >= 1." });
    if (typeof order !== "number" || order < 1) return res.status(400).json({ success: false, message: "order must be >= 1." });

    const normalizedType = normalizeLessonType(type) ?? LessonType.Video;
    const normalizedVideoUrl = typeof videoUrl === "string" ? videoUrl.trim() : "";
    if (normalizedType === LessonType.Video && !normalizedVideoUrl) {
      return res.status(400).json({ success: false, message: "videoUrl is required for video lessons." });
    }
    const normalizedContent = normalizeContentBlocks(content);
    const normalizedQuiz = normalizeQuizQuestions(quiz);
    if (normalizedQuiz.error) return res.status(400).json({ success: false, message: normalizedQuiz.error });
    if (normalizedType === LessonType.Quiz && normalizedQuiz.data.length === 0) {
      return res.status(400).json({ success: false, message: "quiz is required for quiz lessons." });
    }

    const module = await Module.findOne({ _id: moduleId, isDeleted: false, status: "active" });
    if (!module) return res.status(404).json({ success: false, message: "Module not found." });

    const lesson = await Lesson.create({
      module: new mongoose.Types.ObjectId(moduleId),
      title: title.trim(),
      videoUrl: normalizedVideoUrl || undefined,
      thumbnail: typeof thumbnail === "string" ? thumbnail.trim() : undefined,
      duration,
      type: normalizedType,
      order,
      content: normalizedContent,
      quiz: normalizedQuiz.data,
    });

    return res.status(201).json({ success: true, message: "Lesson created successfully.", data: lesson });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to create lesson.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getLessons = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, moduleId } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) return res.status(400).json({ success: false, message: "Invalid pagination values." });

    const match: Record<string, any> = { isDeleted: false, status: "active" };
    if (typeof moduleId === "string" && moduleId.trim()) {
      if (!mongoose.Types.ObjectId.isValid(moduleId)) return res.status(400).json({ success: false, message: "Invalid moduleId." });
      match.module = new mongoose.Types.ObjectId(moduleId);
    }

    const total = await Lesson.countDocuments(match);
    const lessons = await Lesson.find(match)
      .sort({ order: 1, createdAt: 1 })
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .lean();
    const serializedLessons = lessons.map(serializeLesson);

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Lessons fetched successfully.",
      data: {
        lessons: serializedLessons,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalLessons: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch lessons.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getLessonById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid lesson id." });

    const lesson = await Lesson.findOne({ _id: id, isDeleted: false, status: "active" }).lean();
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found." });

    return res.status(200).json({ success: true, message: "Lesson fetched successfully.", data: serializeLesson(lesson) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch lesson.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateLesson = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid lesson id." });

    const lesson = await Lesson.findById(id);
    if (!lesson || lesson.isDeleted) return res.status(404).json({ success: false, message: "Lesson not found." });

    const body = req.body as Partial<{
      moduleId: string;
      title: string;
      videoUrl: string | null;
      thumbnail: string | null;
      duration: number;
      type: string;
      order: number;
      content: unknown;
      quiz: unknown;
      status: "active" | "hidden";
    }>;

    if (typeof body.title === "string") lesson.title = body.title.trim();
    if (typeof body.duration === "number") lesson.duration = body.duration;
    if (typeof body.order === "number") lesson.order = body.order;
    if (body.status) lesson.status = body.status;
    if (body.type) {
      const normalizedType = normalizeLessonType(body.type);
      if (!normalizedType) return res.status(400).json({ success: false, message: "Invalid type." });
      lesson.type = normalizedType;
    }
    if (body.moduleId) {
      if (!mongoose.Types.ObjectId.isValid(body.moduleId)) return res.status(400).json({ success: false, message: "Invalid moduleId." });
      lesson.module = new mongoose.Types.ObjectId(body.moduleId);
    }
    if (body.videoUrl !== undefined) {
      lesson.videoUrl = body.videoUrl === null ? undefined : String(body.videoUrl).trim();
    }
    if (body.thumbnail !== undefined) {
      lesson.thumbnail = body.thumbnail === null ? undefined : String(body.thumbnail).trim();
    }
    if (body.content !== undefined) {
      lesson.content = normalizeContentBlocks(body.content) as any;
    }
    if (body.quiz !== undefined) {
      const normalizedQuiz = normalizeQuizQuestions(body.quiz);
      if (normalizedQuiz.error) return res.status(400).json({ success: false, message: normalizedQuiz.error });
      lesson.quiz = normalizedQuiz.data as any;
    }
    if (lesson.type === LessonType.Video && (!lesson.videoUrl || !lesson.videoUrl.trim())) {
      return res.status(400).json({ success: false, message: "videoUrl is required for video lessons." });
    }
    if (lesson.type === LessonType.Quiz && (!Array.isArray(lesson.quiz) || lesson.quiz.length === 0)) {
      return res.status(400).json({ success: false, message: "quiz is required for quiz lessons." });
    }

    await lesson.save();
    return res.status(200).json({ success: true, message: "Lesson updated successfully.", data: lesson });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update lesson.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteLesson = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid lesson id." });

    const lesson = await Lesson.findById(id);
    if (!lesson || lesson.isDeleted) return res.status(404).json({ success: false, message: "Lesson not found." });

    lesson.isDeleted = true;
    lesson.status = "hidden";
    await lesson.save();

    return res.status(200).json({
      success: true,
      message: "Lesson deleted successfully.",
      data: { lessonId: lesson._id },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete lesson.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const submitQuizLesson = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Authentication required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lesson id." });
    }

    const { answers } = req.body as { answers?: unknown };
    if (!Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: "answers must be an array." });
    }

    const lesson = await Lesson.findOne({ _id: id, isDeleted: false, status: "active" }).lean();
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found." });
    if (lesson.type !== LessonType.Quiz) {
      return res.status(400).json({ success: false, message: "This lesson is not a quiz lesson." });
    }

    const quiz = Array.isArray(lesson.quiz) ? (lesson.quiz as QuizQuestionInput[]) : [];
    if (!quiz.length) {
      return res.status(400).json({ success: false, message: "Quiz questions are not configured for this lesson." });
    }

    const normalizedAnswers: QuizSubmissionInput[] = answers
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
      .map((a) => {
        const questionIndex = Number(a.questionIndex);
        const selectedOptionIndexes = Array.isArray(a.selectedOptionIndexes)
          ? Array.from(new Set(a.selectedOptionIndexes.map((x) => Number(x)).filter((x) => Number.isInteger(x))))
          : [];
        return { questionIndex, selectedOptionIndexes };
      })
      .filter((a) => Number.isInteger(a.questionIndex) && a.questionIndex >= 0);

    const answerMap = new Map<number, number[]>();
    normalizedAnswers.forEach((a) => answerMap.set(a.questionIndex, a.selectedOptionIndexes));

    const results = quiz.map((q, questionIndex) => {
      const selectedOptionIndexes = (answerMap.get(questionIndex) || []).filter(
        (idx) => idx >= 0 && idx < q.options.length
      );
      const expected = [...q.correctOptionIndexes].sort((a, b) => a - b);
      const selected = [...selectedOptionIndexes].sort((a, b) => a - b);
      const isCorrect =
        expected.length === selected.length && expected.every((value, idx) => value === selected[idx]);
      return {
        questionIndex,
        question: q.question,
        questionType: q.questionType,
        selectedOptionIndexes: selected,
        correctOptionIndexes: q.correctOptionIndexes,
        isCorrect,
        explanation: q.explanation || null,
      };
    });

    const totalQuestions = quiz.length;
    const correctAnswers = results.filter((r) => r.isCorrect).length;
    const scorePercent = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const passed = scorePercent >= 70;
    const lessonObjectId = new mongoose.Types.ObjectId(id);

    const module = await Module.findOne({
      _id: lesson.module,
      isDeleted: false,
      status: "active",
    })
      .select("_id course")
      .lean();
    if (!module || !module.course) {
      return res.status(404).json({ success: false, message: "Module or course not found for this lesson." });
    }

    const courseObjectId = new mongoose.Types.ObjectId(module.course);
    const moduleIds = await Module.find({ course: courseObjectId, isDeleted: false, status: "active" })
      .select("_id")
      .lean();
    const moduleIdValues = moduleIds.map((m: any) => m._id);

    const progressDoc =
      (await CourseProgress.findOne({ user: userId, course: courseObjectId })) ||
      (await CourseProgress.create({
        user: new mongoose.Types.ObjectId(userId),
        course: courseObjectId,
      }));

    progressDoc.currentLesson = lessonObjectId;
    progressDoc.lastAccessedAt = new Date();

    const existingQuizResultIndex = (progressDoc.quizResults || []).findIndex(
      (q) => q.lesson?.toString() === lessonObjectId.toString()
    );
    const previousAttemptCount = existingQuizResultIndex >= 0 ? progressDoc.quizResults[existingQuizResultIndex].attemptCount || 1 : 0;
    const quizResultPayload = {
      lesson: lessonObjectId,
      totalQuestions,
      correctAnswers,
      wrongAnswers: totalQuestions - correctAnswers,
      scorePercent,
      passed,
      attemptedAt: new Date(),
      attemptCount: previousAttemptCount + 1,
      results: results.map((r) => ({
        questionIndex: r.questionIndex,
        selectedOptionIndexes: r.selectedOptionIndexes,
        correctOptionIndexes: r.correctOptionIndexes,
        isCorrect: r.isCorrect,
      })),
    };
    if (existingQuizResultIndex >= 0) {
      progressDoc.quizResults[existingQuizResultIndex] = quizResultPayload as any;
    } else {
      progressDoc.quizResults.push(quizResultPayload as any);
    }

    if (passed) {
      const alreadyCompleted = progressDoc.completedLessons.some((lessonId) => lessonId.toString() === lessonObjectId.toString());
      if (!alreadyCompleted) progressDoc.completedLessons.push(lessonObjectId);
    }

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
      message: "Quiz submitted successfully.",
      data: {
        lessonId: lesson._id,
        totalQuestions,
        correctAnswers,
        wrongAnswers: totalQuestions - correctAnswers,
        scorePercent,
        passed,
        results,
        progress: {
          courseId: courseObjectId,
          lessonId: lessonObjectId,
          totalLessons,
          completedCount,
          progressPercent: progressDoc.progressPercent,
          isCompleted: progressDoc.isCompleted,
          currentLesson: progressDoc.currentLesson,
          completedLessons: progressDoc.completedLessons,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to submit quiz.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

