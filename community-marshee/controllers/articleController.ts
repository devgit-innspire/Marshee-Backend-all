import { Response } from "express";
import mongoose from "mongoose";
import { Article } from "../models/Article";
import { AuthRequest } from "../middlewares/auth";
import { getCurrentUserId, isAdminUser } from "../utils/growAdmin";

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

type ArticleContentBlockInput = {
  type: "heading" | "paragraph" | "highlight" | "list" | "photo";
  text?: string;
  level?: 1 | 2 | 3;
  title?: string;
  items?: Array<{ text: string }>;
  photos?: Array<{ url: string; caption?: string }>;
  bgColor?: string;
  textColor?: string;
  icon?: string;
};

const normalizeArticleContentBlocks = (contentBlocks: unknown): { data: ArticleContentBlockInput[]; error?: string } => {
  if (contentBlocks === undefined) return { data: [] };
  if (!Array.isArray(contentBlocks)) return { data: [], error: "contentBlocks must be an array." };

  const normalized: ArticleContentBlockInput[] = [];
  for (let i = 0; i < contentBlocks.length; i += 1) {
    const raw = contentBlocks[i];
    if (!raw || typeof raw !== "object") return { data: [], error: `contentBlocks[${i}] must be an object.` };
    const block = raw as Record<string, unknown>;
    const rawType = typeof block.type === "string" ? block.type.trim().toLowerCase() : "";
    if (!["heading", "paragraph", "highlight", "list", "photo"].includes(rawType)) {
      return { data: [], error: `contentBlocks[${i}].type is invalid.` };
    }

    const normalizedBlock: ArticleContentBlockInput = { type: rawType as ArticleContentBlockInput["type"] };
    if (typeof block.text === "string") normalizedBlock.text = block.text.trim();
    if (typeof block.level === "number" && [1, 2, 3].includes(block.level)) normalizedBlock.level = block.level as 1 | 2 | 3;
    if (typeof block.title === "string") normalizedBlock.title = block.title.trim();
    if (typeof block.bgColor === "string") normalizedBlock.bgColor = block.bgColor.trim();
    if (typeof block.textColor === "string") normalizedBlock.textColor = block.textColor.trim();
    if (typeof block.icon === "string") normalizedBlock.icon = block.icon.trim();

    if (Array.isArray(block.items)) {
      normalizedBlock.items = block.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ text: typeof item.text === "string" ? item.text.trim() : "" }))
        .filter((item) => Boolean(item.text));
    }

    if (Array.isArray(block.photos)) {
      normalizedBlock.photos = block.photos
        .filter((photo): photo is Record<string, unknown> => Boolean(photo) && typeof photo === "object")
        .map((photo) => ({
          url: typeof photo.url === "string" ? photo.url.trim() : "",
          caption: typeof photo.caption === "string" ? photo.caption.trim() : undefined,
        }))
        .filter((photo) => Boolean(photo.url));
    }

    if (normalizedBlock.type === "photo" && (!normalizedBlock.photos || normalizedBlock.photos.length === 0)) {
      return { data: [], error: `contentBlocks[${i}] of type photo must include photos.` };
    }

    normalized.push(normalizedBlock);
  }

  return { data: normalized };
};

const serializeArticle = (article: any) => ({
  ...article,
  content: typeof article?.content === "string" ? article.content : "",
  contentBlocks: Array.isArray(article?.contentBlocks) ? article.contentBlocks : [],
});

export const createArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const {
      title,
      description,
      content,
      contentBlocks,
      coverImage,
      category,
      readTime,
      author,
      isFeatured,
    } = req.body as {
      title?: string;
      description?: string;
      content?: string;
      contentBlocks?: unknown;
      coverImage?: string;
      category?: string;
      readTime?: number;
      author?: { name?: string; image?: string; role?: string };
      isFeatured?: boolean;
    };

    if (!title || typeof title !== "string") return res.status(400).json({ success: false, message: "title is required." });
    if (!description || typeof description !== "string") return res.status(400).json({ success: false, message: "description is required." });
    if (!coverImage || typeof coverImage !== "string") return res.status(400).json({ success: false, message: "coverImage is required." });
    if (!category || typeof category !== "string") return res.status(400).json({ success: false, message: "category is required." });
    if (typeof readTime !== "number" || readTime < 1) return res.status(400).json({ success: false, message: "readTime must be >= 1." });
    if (!author?.name || !author?.image || !author?.role) return res.status(400).json({ success: false, message: "author.name/image/role are required." });
    const normalizedBlocks = normalizeArticleContentBlocks(contentBlocks);
    if (normalizedBlocks.error) return res.status(400).json({ success: false, message: normalizedBlocks.error });
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    if (!normalizedContent && normalizedBlocks.data.length === 0) {
      return res.status(400).json({ success: false, message: "Either content or contentBlocks is required." });
    }

    const article = await Article.create({
      title: title.trim(),
      description: description.trim(),
      content: normalizedContent || undefined,
      contentBlocks: normalizedBlocks.data,
      coverImage: coverImage.trim(),
      category: category.toLowerCase().trim(),
      readTime,
      author: {
        name: author.name.trim(),
        image: author.image.trim(),
        role: author.role.trim(),
      },
      isFeatured: Boolean(isFeatured),
    });

    return res.status(201).json({ success: true, message: "Article created successfully.", data: serializeArticle(article.toObject()) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to create article.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getArticles = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, category, featured, sort = "latest", q } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) return res.status(400).json({ success: false, message: "Invalid pagination values." });

    const match: Record<string, any> = { isDeleted: false, status: "active" };

    if (typeof category === "string" && category.trim()) match.category = category.toLowerCase().trim();
    if (typeof featured === "string") match.isFeatured = featured === "true";

    if (typeof q === "string" && q.trim()) {
      const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rgx = new RegExp(safe, "i");
      match.$or = [
        { title: rgx },
        { description: rgx },
        { content: rgx },
        { "contentBlocks.text": rgx },
        { "contentBlocks.title": rgx },
        { "contentBlocks.items.text": rgx },
      ];
    }

    const sortValue = String(sort).toLowerCase();
    // Mongoose sort typing can be too strict; this cast keeps runtime behavior unchanged.
    const sortStage: any = sortValue === "oldest" ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };

    const total = await Article.countDocuments(match);
    const articles = await Article.find(match)
      .sort(sortStage)
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .lean();
    const serializedArticles = articles.map(serializeArticle);

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Articles fetched successfully.",
      data: {
        articles: serializedArticles,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalArticles: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch articles.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getArticleById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid article id." });

    const article = await Article.findOne({ _id: id, isDeleted: false, status: "active" }).lean();
    if (!article) return res.status(404).json({ success: false, message: "Article not found." });

    return res.status(200).json({ success: true, message: "Article fetched successfully.", data: serializeArticle(article) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch article.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getRelatedArticles = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 4 } = req.query;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid article id." });
    }

    const limitNum = Number(limit) || 4;
    if (limitNum < 1 || limitNum > 20) {
      return res.status(400).json({ success: false, message: "limit must be between 1 and 20." });
    }

    const currentArticle = await Article.findOne({ _id: id, isDeleted: false, status: "active" })
      .select("category")
      .lean();
    if (!currentArticle) return res.status(404).json({ success: false, message: "Article not found." });

    const relatedArticles = await Article.find({
      _id: { $ne: currentArticle._id },
      category: currentArticle.category,
      isDeleted: false,
      status: "active",
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limitNum)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Related articles fetched successfully.",
      data: relatedArticles.map(serializeArticle),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch related articles.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid article id." });

    const article = await Article.findById(id);
    if (!article || article.isDeleted) return res.status(404).json({ success: false, message: "Article not found." });

    const body = req.body as Partial<{
      title: string;
      description: string;
      content: string;
      contentBlocks: unknown;
      coverImage: string;
      category: string;
      readTime: number;
      author: { name: string; image: string; role: string };
      isFeatured: boolean;
      status: "active" | "hidden";
    }>;

    if (typeof body.title === "string") article.title = body.title.trim();
    if (typeof body.description === "string") article.description = body.description.trim();
    if (typeof body.content === "string") article.content = body.content.trim();
    if (body.contentBlocks !== undefined) {
      const normalizedBlocks = normalizeArticleContentBlocks(body.contentBlocks);
      if (normalizedBlocks.error) return res.status(400).json({ success: false, message: normalizedBlocks.error });
      article.contentBlocks = normalizedBlocks.data as any;
    }
    if (typeof body.coverImage === "string") article.coverImage = body.coverImage.trim();
    if (typeof body.category === "string") article.category = body.category.toLowerCase().trim() as any;
    if (typeof body.readTime === "number") article.readTime = body.readTime;
    if (typeof body.isFeatured === "boolean") article.isFeatured = body.isFeatured;
    if (body.author) {
      if (!body.author.name || !body.author.image || !body.author.role) {
        return res.status(400).json({ success: false, message: "author.name/image/role are required." });
      }
      article.author = {
        name: body.author.name.trim(),
        image: body.author.image.trim(),
        role: body.author.role.trim(),
      } as any;
    }
    if (body.status) article.status = body.status;
    const hasLegacyContent = typeof article.content === "string" && article.content.trim().length > 0;
    const hasBlocks = Array.isArray(article.contentBlocks) && article.contentBlocks.length > 0;
    if (!hasLegacyContent && !hasBlocks) {
      return res.status(400).json({ success: false, message: "Either content or contentBlocks is required." });
    }

    await article.save();
    return res.status(200).json({ success: true, message: "Article updated successfully.", data: serializeArticle(article.toObject()) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update article.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) return res.status(401).json({ success: false, message: "Authentication required." });
    if (!isAdminUser(req)) return res.status(403).json({ success: false, message: "Admin privileges required." });

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid article id." });

    const article = await Article.findById(id);
    if (!article || article.isDeleted) return res.status(404).json({ success: false, message: "Article not found." });

    article.isDeleted = true;
    article.status = "hidden";
    await article.save();

    return res.status(200).json({ success: true, message: "Article deleted successfully.", data: { articleId: article._id } });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete article.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

