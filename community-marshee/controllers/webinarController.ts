import { Response } from "express";
import mongoose from "mongoose";
import { Webinar } from "../models/Webinar";
import { WebinarRegistration } from "../models/WebinarRegistration";
import Pet from "../models/Pet";
import { AuthRequest } from "../middlewares/auth";
import { getCurrentUserId, isAdminUser } from "../utils/growAdmin";

const parsePagination = (page: unknown, limit: unknown) => {
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) return null;
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const normalizeEventDetails = (value: unknown): Array<{ icon?: string; title: string; description?: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      icon: typeof item.icon === "string" ? item.icon.trim() : undefined,
      title: typeof item.title === "string" ? item.title.trim() : "",
      description: typeof item.description === "string" ? item.description.trim() : undefined,
    }))
    .filter((item) => Boolean(item.title));
};

const serializeWebinar = (webinar: any) => {
  const { registrations, ...rest } = webinar || {};
  return {
  ...rest,
  timezone: typeof webinar?.timezone === "string" && webinar.timezone.trim() ? webinar.timezone : "UTC",
  registrationUrl: typeof webinar?.registrationUrl === "string" ? webinar.registrationUrl : "",
  whatYouWillLearn: Array.isArray(webinar?.whatYouWillLearn) ? webinar.whatYouWillLearn : [],
  eventDetails: Array.isArray(webinar?.eventDetails) ? webinar.eventDetails : [],
  registeredCount: typeof webinar?.registeredCount === "number" ? webinar.registeredCount : 0,
  registrationsCount: Array.isArray(registrations) ? registrations.length : 0,
  seatsRemaining:
    typeof webinar?.seats === "number" && typeof webinar?.registeredCount === "number"
      ? Math.max(0, webinar.seats - webinar.registeredCount)
      : webinar?.seats,
  };
};

export const createWebinar = async (req: AuthRequest, res: Response) => {
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
      coverImage,
      date,
      timezone,
      duration,
      isLive,
      speaker,
      seats,
      registrationUrl,
      whatYouWillLearn,
      eventDetails,
      registeredCount,
    } = req.body as {
      title?: string;
      description?: string;
      coverImage?: string;
      date?: string | Date;
      timezone?: string;
      duration?: number;
      isLive?: boolean;
      speaker?: { name?: string; image?: string; role?: string };
      seats?: number;
      registrationUrl?: string;
      whatYouWillLearn?: unknown;
      eventDetails?: unknown;
      registeredCount?: number;
    };

    if (!title || typeof title !== "string") {
      return res.status(400).json({ success: false, message: "title is required." });
    }
    if (!description || typeof description !== "string") {
      return res.status(400).json({ success: false, message: "description is required." });
    }
    if (!coverImage || typeof coverImage !== "string") {
      return res.status(400).json({ success: false, message: "coverImage is required." });
    }
    if (!date) {
      return res.status(400).json({ success: false, message: "date is required." });
    }
    if (typeof duration !== "number" || duration < 1) {
      return res.status(400).json({ success: false, message: "duration must be >= 1." });
    }
    if (typeof seats !== "number" || seats < 1) {
      return res.status(400).json({ success: false, message: "seats must be >= 1." });
    }
    if (registeredCount !== undefined && (typeof registeredCount !== "number" || registeredCount < 0)) {
      return res.status(400).json({ success: false, message: "registeredCount must be >= 0." });
    }
    if (!speaker?.name || !speaker?.image || !speaker?.role) {
      return res.status(400).json({ success: false, message: "speaker.name/image/role are required." });
    }
    const normalizedLearn = normalizeStringList(whatYouWillLearn);
    const normalizedEventDetails = normalizeEventDetails(eventDetails);

    const webinar = await Webinar.create({
      title: title.trim(),
      description: description.trim(),
      coverImage: coverImage.trim(),
      date: new Date(date),
      timezone: typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC",
      duration,
      isLive: Boolean(isLive),
      speaker: {
        name: speaker.name.trim(),
        image: speaker.image.trim(),
        role: speaker.role.trim(),
      },
      seats,
      registeredCount: typeof registeredCount === "number" ? registeredCount : 0,
      registrationUrl: typeof registrationUrl === "string" ? registrationUrl.trim() : undefined,
      whatYouWillLearn: normalizedLearn,
      eventDetails: normalizedEventDetails,
    });

    return res.status(201).json({
      success: true,
      message: "Webinar created successfully.",
      data: serializeWebinar(webinar.toObject()),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to create webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

/**
 * Webinars the authenticated user has registered for (WebinarRegistration.user).
 */
export const getMyWebinars = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { page = 1, limit = 20 } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) {
      return res.status(400).json({ success: false, message: "Invalid pagination values." });
    }

    const userId = req.user._id;

    const total = await WebinarRegistration.countDocuments({ user: userId });
    const registrations = await WebinarRegistration.find({ user: userId })
      .sort({ registeredAt: -1, _id: -1 })
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .populate("webinar")
      .lean();

    const webinars = registrations
      .map((row) => {
        const w = row.webinar;
        if (!w || typeof w !== "object" || !("_id" in w)) return null;
        return {
          registration: {
            webinarId: w._id,
            fullName: row.fullName,
            phoneNumber: row.phoneNumber || "",
            email: row.email || "",
            petNames: Array.isArray(row.petNames) ? row.petNames : [],
            registeredAt: row.registeredAt,
            source: row.source,
          },
          webinar: serializeWebinar(w),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Your webinars fetched successfully.",
      data: {
        webinars,
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalRegistrations: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch your webinars.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getWebinars = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, sort = "latest", live, q, upcoming, fromDate, toDate } = req.query;
    const pagination = parsePagination(page, limit);
    if (!pagination) {
      return res.status(400).json({ success: false, message: "Invalid pagination values." });
    }

    const match: Record<string, any> = { isDeleted: false, status: "active" };
    if (typeof live === "string") match.isLive = live === "true";
    if (typeof upcoming === "string") {
      match.date = { ...(match.date || {}), [upcoming === "true" ? "$gte" : "$lt"]: new Date() };
    }
    if (typeof fromDate === "string" && fromDate.trim()) {
      match.date = { ...(match.date || {}), $gte: new Date(fromDate) };
    }
    if (typeof toDate === "string" && toDate.trim()) {
      match.date = { ...(match.date || {}), $lte: new Date(toDate) };
    }
    if (typeof q === "string" && q.trim()) {
      const rgx = new RegExp(escapeRegex(q.trim()), "i");
      match.$or = [{ title: rgx }, { description: rgx }, { "speaker.name": rgx }];
    }

    const sortValue = String(sort).toLowerCase();
    // Mongoose sort typing can be too strict; this cast keeps runtime behavior unchanged.
    const sortStage: any =
      sortValue === "oldest" || sortValue === "date" ? { date: 1, _id: 1 } : { date: -1, _id: -1 };

    const total = await Webinar.countDocuments(match);
    const webinars = await Webinar.find(match)
      .sort(sortStage)
      .skip(pagination.skip)
      .limit(pagination.limitNum)
      .lean();

    const totalPages = Math.ceil(total / pagination.limitNum) || 1;
    return res.status(200).json({
      success: true,
      message: "Webinars fetched successfully.",
      data: {
        webinars: webinars.map(serializeWebinar),
        pagination: {
          currentPage: pagination.pageNum,
          totalPages,
          totalWebinars: total,
          hasNext: pagination.pageNum < totalPages,
          hasPrev: pagination.pageNum > 1,
          limit: pagination.limitNum,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch webinars.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getWebinarById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid webinar id." });
    }

    const webinar = await Webinar.findOne({ _id: id, isDeleted: false, status: "active" }).lean();
    if (!webinar) {
      return res.status(404).json({ success: false, message: "Webinar not found." });
    }

    const related = await Webinar.find({
      _id: { $ne: webinar._id },
      isDeleted: false,
      status: "active",
      isLive: webinar.isLive,
    })
      .sort({ date: 1, _id: 1 })
      .limit(4)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Webinar fetched successfully.",
      data: {
        webinar: serializeWebinar(webinar),
        related: related.map(serializeWebinar),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getWebinarBySlug = async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== "string" || !slug.trim()) {
      return res.status(400).json({ success: false, message: "Invalid webinar slug." });
    }

    const webinar = await Webinar.findOne({
      slug: slug.trim(),
      isDeleted: false,
      status: "active",
    }).lean();
    if (!webinar) {
      return res.status(404).json({ success: false, message: "Webinar not found." });
    }

    const related = await Webinar.find({
      _id: { $ne: webinar._id },
      isDeleted: false,
      status: "active",
      isLive: webinar.isLive,
    })
      .sort({ date: 1, _id: 1 })
      .limit(4)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Webinar fetched successfully.",
      data: {
        webinar: serializeWebinar(webinar),
        related: related.map(serializeWebinar),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const registerForWebinar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    const registrantUserId = req.user._id;

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid webinar id." });
    }

    const { fullName, phoneNumber, email, petNames } = req.body as {
      fullName?: string;
      phoneNumber?: string;
      email?: string;
      petNames?: string[] | string;
    };

    const webinarObjectId = new mongoose.Types.ObjectId(id);
    const webinar = await Webinar.findOne({
      _id: webinarObjectId,
      isDeleted: false,
      status: "active",
    });

    if (!webinar) {
      return res.status(404).json({ success: false, message: "Webinar not found." });
    }

    if (new Date(webinar.date).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "This webinar has already started or ended." });
    }

    let profileName = typeof fullName === "string" ? fullName.trim() : "";
    let profilePhone = typeof phoneNumber === "string" ? phoneNumber.trim() : "";
    let profileEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    let profilePetNames = Array.isArray(petNames)
      ? petNames.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : typeof petNames === "string"
      ? petNames.split(",").map((item) => item.trim()).filter(Boolean)
      : [];

    if (req.user) {
      profileName = profileName || (typeof req.user.name === "string" ? req.user.name.trim() : "");
      profilePhone = profilePhone || (typeof req.user.phoneNumber === "string" ? req.user.phoneNumber.trim() : "");
      profileEmail = profileEmail || (typeof req.user.email === "string" ? req.user.email.trim().toLowerCase() : "");
      if (!profilePetNames.length) {
        const userPets = await Pet.find({ owner: req.user._id }).select("name").lean();
        profilePetNames = userPets
          .map((pet: any) => (typeof pet?.name === "string" ? pet.name.trim() : ""))
          .filter(Boolean);
      }
    }

    if (!profileName) {
      return res.status(400).json({ success: false, message: "fullName is required." });
    }
    if (!profilePhone && !profileEmail) {
      return res.status(400).json({ success: false, message: "Provide at least one contact: phoneNumber or email." });
    }

    const alreadyRegistered = await WebinarRegistration.findOne({
      webinar: webinarObjectId,
      $or: [
        { user: registrantUserId },
        ...(profileEmail ? [{ email: profileEmail }] : []),
        ...(profilePhone ? [{ phoneNumber: profilePhone }] : []),
      ],
    }).lean();

    if (alreadyRegistered) {
      if (!alreadyRegistered.user) {
        const emailMatch =
          Boolean(profileEmail) &&
          typeof alreadyRegistered.email === "string" &&
          alreadyRegistered.email === profileEmail;
        const phoneMatch =
          Boolean(profilePhone) &&
          typeof alreadyRegistered.phoneNumber === "string" &&
          alreadyRegistered.phoneNumber === profilePhone;
        if (emailMatch || phoneMatch) {
          await WebinarRegistration.updateOne(
            { _id: alreadyRegistered._id },
            { $set: { user: registrantUserId, source: "user" } }
          );
        }
      }
      return res.status(200).json({
        success: true,
        message: "You are already registered for this webinar.",
        data: {
          webinar: serializeWebinar(webinar.toObject()),
          registration: {
            userId: registrantUserId.toString(),
            webinarId: webinar._id,
            fullName: profileName,
            phoneNumber: profilePhone || "",
            email: profileEmail || "",
            petNames: profilePetNames,
            registeredAt: alreadyRegistered.registeredAt,
          },
        },
      });
    }

    const createdRegistration = await WebinarRegistration.create({
      webinar: webinarObjectId,
      user: registrantUserId,
      fullName: profileName,
      phoneNumber: profilePhone || undefined,
      email: profileEmail || undefined,
      petNames: profilePetNames,
      source: "user",
      registeredAt: new Date(),
    });

    const updatedWebinar = await Webinar.findOneAndUpdate(
      {
        _id: webinarObjectId,
        isDeleted: false,
        status: "active",
        $expr: { $lt: ["$registeredCount", "$seats"] },
      },
      { $inc: { registeredCount: 1 } },
      { new: true }
    );

    if (!updatedWebinar) {
      await WebinarRegistration.findByIdAndDelete(createdRegistration._id);
      return res.status(409).json({ success: false, message: "No seats available for this webinar." });
    }

    return res.status(200).json({
      success: true,
      message: "Webinar registration successful.",
      data: {
        webinar: serializeWebinar(updatedWebinar.toObject()),
        registration: {
          userId: registrantUserId.toString(),
          webinarId: webinarObjectId,
          fullName: profileName,
          phoneNumber: profilePhone || "",
          email: profileEmail || "",
          petNames: profilePetNames,
          registeredAt: createdRegistration.registeredAt,
          registrationUrl: updatedWebinar.registrationUrl || "",
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to register for webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateWebinar = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: "Admin privileges required." });
    }

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid webinar id." });
    }

    const webinar = await Webinar.findById(id);
    if (!webinar || webinar.isDeleted) {
      return res.status(404).json({ success: false, message: "Webinar not found." });
    }

    const body = req.body as Partial<{
      title: string;
      description: string;
      coverImage: string;
      date: string | Date;
      timezone: string;
      duration: number;
      isLive: boolean;
      speaker: { name: string; image: string; role: string };
      seats: number;
      registrationUrl: string;
      whatYouWillLearn: unknown;
      eventDetails: unknown;
      registeredCount: number;
      status: "active" | "hidden";
      isDeleted: boolean;
    }>;

    if (typeof body.title === "string") webinar.title = body.title.trim();
    if (typeof body.description === "string") webinar.description = body.description.trim();
    if (typeof body.coverImage === "string") webinar.coverImage = body.coverImage.trim();
    if (body.date) webinar.date = new Date(body.date);
    if (typeof body.timezone === "string") webinar.timezone = body.timezone.trim() || "UTC";
    if (typeof body.duration === "number") webinar.duration = body.duration;
    if (typeof body.isLive === "boolean") webinar.isLive = body.isLive;
    if (typeof body.seats === "number") webinar.seats = body.seats;
    if (typeof body.registeredCount === "number" && body.registeredCount >= 0) webinar.registeredCount = body.registeredCount;
    if (typeof body.registrationUrl === "string") webinar.registrationUrl = body.registrationUrl.trim();
    if (body.whatYouWillLearn !== undefined) webinar.whatYouWillLearn = normalizeStringList(body.whatYouWillLearn);
    if (body.eventDetails !== undefined) webinar.eventDetails = normalizeEventDetails(body.eventDetails) as any;
    if (body.speaker) {
      if (!body.speaker.name || !body.speaker.image || !body.speaker.role) {
        return res.status(400).json({ success: false, message: "speaker.name/image/role are required." });
      }
      webinar.speaker = {
        name: body.speaker.name.trim(),
        image: body.speaker.image.trim(),
        role: body.speaker.role.trim(),
      };
    }
    if (body.status) webinar.status = body.status;

    await webinar.save();

    return res.status(200).json({
      success: true,
      message: "Webinar updated successfully.",
      data: serializeWebinar(webinar.toObject()),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to update webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const deleteWebinar = async (req: AuthRequest, res: Response) => {
  try {
    if (!getCurrentUserId(req)) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: "Admin privileges required." });
    }

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid webinar id." });
    }

    const webinar = await Webinar.findById(id);
    if (!webinar || webinar.isDeleted) {
      return res.status(404).json({ success: false, message: "Webinar not found." });
    }

    webinar.isDeleted = true;
    webinar.status = "hidden";
    await webinar.save();

    return res.status(200).json({
      success: true,
      message: "Webinar deleted successfully.",
      data: { webinarId: webinar._id },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete webinar.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

