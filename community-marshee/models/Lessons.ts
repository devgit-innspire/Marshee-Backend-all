import mongoose, { model, Schema } from "mongoose";
import { ILesson, LessonStatus, LessonType } from "../types/grow.types";

// 🔹 Content Block Schema
const ContentBlockSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["heading", "paragraph", "highlight", "list"],
      required: true,
    },

    // Common fields
    text: { type: String },

    // For heading
    level: {
      type: Number,
      enum: [1, 2, 3],
    },

    // For highlight card (like "Key Takeaways")
    title: { type: String },

    items: [
      {
        text: String,
      },
    ],

    // UI customization
    bgColor: { type: String },   // e.g. "#FFF4E5"
    textColor: { type: String }, // optional
    icon: { type: String },      // optional (for UI)
  },
  { _id: false }
);

const QuizOptionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const QuizQuestionSchema = new Schema(
  {
    question: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      enum: ["single", "multiple"],
      required: true,
      default: "single",
    },
    options: {
      type: [QuizOptionSchema],
      default: [],
    },
    correctOptionIndexes: {
      type: [Number],
      default: [],
    },
    explanation: { type: String, trim: true },
  },
  { _id: false }
);

const LessonSchema = new Schema<ILesson>(
  {
    module: { type: Schema.Types.ObjectId, ref: "Module", required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },

    videoUrl: { type: String, trim: true },

    thumbnail: { type: String },

    duration: { type: Number, required: true, min: 1 },

    type: {
      type: String,
      enum: Object.values(LessonType),
      default: LessonType.Video,
      required: true,
      index: true,
    },

    order: { type: Number, required: true, min: 1 },

    // 🔥 MAIN PART (Flexible Content)
    content: [ContentBlockSchema],

    // Quiz content (supports single-choice and multiple-choice questions)
    quiz: [QuizQuestionSchema],

    slug: { type: String, unique: true, sparse: true, index: true },

    status: {
      type: String,
      enum: ["active", "hidden"] satisfies LessonStatus[],
      default: "active",
      index: true,
    },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// 🔥 Validation
LessonSchema.pre("validate", function (this: ILesson, next) {
  if (this.type === LessonType.Video) {
    if (!this.videoUrl || !this.videoUrl.trim()) {
      return next(new Error("videoUrl is required for VIDEO lessons."));
    }
  }

  if (this.type === LessonType.Quiz) {
    if (!Array.isArray(this.quiz) || this.quiz.length === 0) {
      return next(new Error("quiz is required for QUIZ lessons."));
    }

    for (const [qIndex, q] of this.quiz.entries()) {
      const options = Array.isArray(q.options) ? q.options : [];
      const correctIndexes = Array.isArray(q.correctOptionIndexes) ? q.correctOptionIndexes : [];
      if (!q.question || !q.question.trim()) {
        return next(new Error(`quiz[${qIndex}].question is required.`));
      }
      if (options.length < 2) {
        return next(new Error(`quiz[${qIndex}] must have at least 2 options.`));
      }
      if (correctIndexes.length < 1) {
        return next(new Error(`quiz[${qIndex}] must have at least 1 correct option index.`));
      }
      if (q.questionType === "single" && correctIndexes.length !== 1) {
        return next(new Error(`quiz[${qIndex}] single-choice question must have exactly 1 correct option index.`));
      }
      if (q.questionType === "multiple" && correctIndexes.length < 1) {
        return next(new Error(`quiz[${qIndex}] multiple-choice question must have 1 or more correct option indexes.`));
      }
      const hasInvalidIndex = correctIndexes.some((idx: number) => !Number.isInteger(idx) || idx < 0 || idx >= options.length);
      if (hasInvalidIndex) {
        return next(new Error(`quiz[${qIndex}] has invalid correctOptionIndexes.`));
      }
    }
  }

  next();
});

LessonSchema.index({ module: 1, order: 1, isDeleted: 1 });

export const Lesson =
  (mongoose.models.Lesson as mongoose.Model<ILesson>) ||
  model<ILesson>("Lesson", LessonSchema);