import mongoose from "mongoose";

// These enums/types are shared across the “Grow” training models.
// Keep values stable because they are used in request payloads and MongoDB.

export enum LessonType {
  Video = "video",
  PDF = "pdf",
  Quiz = "quiz",
  Article = "article",
}

export enum CourseLevel {
  Beginner = "beginner",
  Intermediate = "intermediate",
  Advanced = "advanced",
}

export enum ArticleCategory {
  Featured = "featured",
  Learning = "learning",
  Tips = "tips",
  Updates = "updates",
}

export type LessonStatus = "active" | "hidden";
export type CourseStatus = "active" | "hidden";
export type WebinarStatus = "active" | "hidden";
export type ArticleStatus = "active" | "hidden";
export type ModuleStatus = "active" | "hidden";

export interface Speaker {
  name: string;
  image: string;
  role: string;
}

export interface WebinarSpeaker extends Speaker {}

export interface WebinarFeature {
  icon?: string;
  title: string;
  description?: string;
}

export interface IWebinar extends mongoose.Document {
  title: string;
  description: string;
  coverImage: string;
  date: Date;
  timezone: string;
  duration: number;
  isLive: boolean;
  speaker: WebinarSpeaker;
  seats: number;
  registeredCount: number;
  registrationUrl?: string;
  whatYouWillLearn: string[];
  eventDetails: WebinarFeature[];

  // Better UX: stable identifier for frontends/SEO.
  slug?: string;

  status: WebinarStatus;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface Instructor {
  name: string;
  image: string;
  role: string;
}

export interface ICourse extends mongoose.Document {
  title: string;
  description: string;
  thumbnail: string;
  level: CourseLevel;
  duration: number;
  instructor: Instructor;
  featuresOfCourse: string[];

  slug?: string;

  status: CourseStatus;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface IModule extends mongoose.Document {
  course: mongoose.Types.ObjectId;
  title: string;
  order: number;

  slug?: string;

  status: ModuleStatus;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface ILesson extends mongoose.Document {
  module: mongoose.Types.ObjectId;
  title: string;

  // VideoUrl is optional because not every lesson type is a video.
  videoUrl?: string;
  thumbnail?: string;

  content?: Array<{
    type: "heading" | "paragraph" | "highlight" | "list";
    text?: string;
    level?: 1 | 2 | 3;
    title?: string;
    items?: Array<{ text: string }>;
    bgColor?: string;
    textColor?: string;
    icon?: string;
  }>;

  quiz?: Array<{
    question: string;
    questionType: "single" | "multiple";
    options: Array<{ text: string }>;
    correctOptionIndexes: number[];
    explanation?: string;
  }>;

  duration: number;
  type: LessonType;
  order: number;

  slug?: string;

  status: LessonStatus;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleAuthor {
  name: string;
  image: string;
  role: string;
}

export interface IArticle extends mongoose.Document {
  title: string;
  description: string;
  // Legacy plain content (kept for backward compatibility)
  content?: string;
  contentBlocks?: Array<{
    type: "heading" | "paragraph" | "highlight" | "list" | "photo";
    text?: string;
    level?: 1 | 2 | 3;
    title?: string;
    items?: Array<{ text: string }>;
    photos?: Array<{ url: string; caption?: string }>;
    bgColor?: string;
    textColor?: string;
    icon?: string;
  }>;
  coverImage: string;
  category: ArticleCategory;
  readTime: number;
  author: ArticleAuthor;
  isFeatured: boolean;

  slug?: string;

  status: ArticleStatus;
  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

