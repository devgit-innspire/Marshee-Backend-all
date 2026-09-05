import mongoose, { model, Schema } from "mongoose";

export interface ICourseProgress extends mongoose.Document {
  user: mongoose.Types.ObjectId;
  course: mongoose.Types.ObjectId;
  completedLessons: mongoose.Types.ObjectId[];
  currentLesson?: mongoose.Types.ObjectId;
  progressPercent: number;
  isCompleted: boolean;
  quizResults: Array<{
    lesson: mongoose.Types.ObjectId;
    totalQuestions: number;
    correctAnswers: number;
    wrongAnswers: number;
    scorePercent: number;
    passed: boolean;
    attemptedAt: Date;
    attemptCount: number;
    results: Array<{
      questionIndex: number;
      selectedOptionIndexes: number[];
      correctOptionIndexes: number[];
      isCorrect: boolean;
    }>;
  }>;
  enrolledAt: Date;
  completedAt?: Date;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CourseProgressSchema = new Schema<ICourseProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    completedLessons: [{ type: Schema.Types.ObjectId, ref: "Lesson" }],
    currentLesson: { type: Schema.Types.ObjectId, ref: "Lesson" },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    isCompleted: { type: Boolean, default: false, index: true },
    quizResults: [
      {
        lesson: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
        totalQuestions: { type: Number, required: true, min: 0 },
        correctAnswers: { type: Number, required: true, min: 0 },
        wrongAnswers: { type: Number, required: true, min: 0 },
        scorePercent: { type: Number, required: true, min: 0, max: 100 },
        passed: { type: Boolean, required: true },
        attemptedAt: { type: Date, required: true, default: Date.now },
        attemptCount: { type: Number, required: true, min: 1, default: 1 },
        results: [
          {
            questionIndex: { type: Number, required: true, min: 0 },
            selectedOptionIndexes: [{ type: Number, min: 0 }],
            correctOptionIndexes: [{ type: Number, min: 0 }],
            isCorrect: { type: Boolean, required: true },
          },
        ],
      },
    ],
    enrolledAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    lastAccessedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

CourseProgressSchema.index({ user: 1, course: 1 }, { unique: true });
CourseProgressSchema.index({ user: 1, lastAccessedAt: -1 });

export const CourseProgress =
  (mongoose.models.CourseProgress as mongoose.Model<ICourseProgress>) ||
  model<ICourseProgress>("CourseProgress", CourseProgressSchema);

