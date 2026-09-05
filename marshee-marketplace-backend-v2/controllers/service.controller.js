const { Service, Subscription, SERVICE_TYPES } = require("../models/service.model");
const mongoose = require("mongoose");
const { StatusCodes } = require('http-status-codes');
const Pet = require("../models/pet.model");
const { isValidIndianPincode } = require("../utils/pincodeGeocoder");

// Helper function to generate slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^\w ]+/g, "")
    .replace(/ +/g, "-");
};

const normalizeDateOnly = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
};

const reserveMatchingCalendarSlot = (slots = [], selectedSlot) => {
  const selectedDate = normalizeDateOnly(selectedSlot?.date);
  if (!selectedDate) return false;

  const slotIndex = slots.findIndex((slot) => {
    const slotDate = normalizeDateOnly(slot?.date);
    return (
      slotDate === selectedDate &&
      slot?.startTime === selectedSlot?.startTime &&
      slot?.endTime === selectedSlot?.endTime
    );
  });

  if (slotIndex === -1) return false;

  const slot = slots[slotIndex];
  if (!slot.isAvailable) return false;

  const maxBookings = slot.maxBookings || 1;
  const bookedCount = slot.bookedCount || 0;
  if (bookedCount >= maxBookings) return false;

  slot.bookedCount = bookedCount + 1;
  if (slot.bookedCount >= maxBookings) slot.isAvailable = false;
  return true;
};

const findUserPetForBooking = async (petId, userId) => {
  return Pet.findOne({
    _id: petId,
    $or: [{ owner: userId }, { coOwners: userId }]
  }).lean();
};

const PET_CAKE_CUSTOMIZATION_GROUPS = [
  { key: "shapeOptions", title: "Shape", inputType: "single", isRequired: true },
  { key: "baseFrostingColourOptions", title: "Base Frosting Colour", inputType: "single", isRequired: true },
  { key: "fondantDetailingColourOptions", title: "Fondant Detailing Colour(s)", inputType: "multiple", isRequired: true },
  { key: "allergiesOrPreferencesOptions", title: "Allergies or Preferences", inputType: "multiple", isRequired: false },
  { key: "fillingOptions", title: "Filling", inputType: "dropdown", isRequired: false },
  { key: "cookiesAroundCakeOptions", title: "Cookies Around The Cake", inputType: "dropdown", isRequired: false },
  { key: "signature3DDoggieCakeTopperOptions", title: "Signature 3D Doggie Cake Topper", inputType: "dropdown", isRequired: false },
  { key: "happyBirthdayPetNameTextOptions", title: "Happy Birthday Pet Name Text", inputType: "single", isRequired: true },
  { key: "addOnOptions", title: "Add Ons", inputType: "multiple", isRequired: false }
];

const normalizePetCakeOptions = (options = []) => {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option && typeof option === "object" && String(option.name || "").trim())
    .map((option) => ({
      ...option,
      name: String(option.name).trim(),
      value: String(option.value || option.name || "").trim() || undefined
    }));
};

const normalizePetCakeConfig = (cake = {}) => {
  if (!cake || typeof cake !== "object") return cake;

  const normalizedCake = { ...cake };
  const existingFields = Array.isArray(normalizedCake.customizationFields)
    ? normalizedCake.customizationFields.map((field) => ({ ...field }))
    : [];

  const existingKeys = new Set(
    existingFields
      .map((field) => String(field?.id || "").trim().toLowerCase())
      .filter(Boolean)
  );

  for (const group of PET_CAKE_CUSTOMIZATION_GROUPS) {
    normalizedCake[group.key] = normalizePetCakeOptions(normalizedCake[group.key]);
    if (!normalizedCake[group.key].length || existingKeys.has(group.key.toLowerCase())) continue;

    existingFields.push({
      id: group.key,
      title: group.title,
      inputType: group.inputType,
      isRequired: group.isRequired,
      options: normalizedCake[group.key]
    });
    existingKeys.add(group.key.toLowerCase());
  }

  normalizedCake.customizationFields = existingFields;
  return normalizedCake;
};

const toPetCakeId = (value, fallback) => String(value ?? fallback);

const toSelectionIds = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
};

const calculatePetCakeCustomizationAmount = (cakeConfig = {}, ingredients = {}, customizationSelections = {}) => {
  let total = 0;

  const ingredientSections = Array.isArray(cakeConfig?.ingredientSections) ? cakeConfig.ingredientSections : [];
  for (let secIdx = 0; secIdx < ingredientSections.length; secIdx += 1) {
    const section = ingredientSections[secIdx] || {};
    const sectionId = toPetCakeId(section?.id, secIdx);
    const pickedIds = toSelectionIds(ingredients?.[sectionId]);
    if (!pickedIds.length) continue;

    const options = Array.isArray(section?.options) ? section.options : [];
    for (let optIdx = 0; optIdx < options.length; optIdx += 1) {
      const option = options[optIdx] || {};
      const optionId = toPetCakeId(option?.id, optIdx);
      if (pickedIds.includes(optionId)) {
        total += Number(option?.additionalPrice || 0);
      }
    }
  }

  const fields = Array.isArray(cakeConfig?.customizationFields) ? cakeConfig.customizationFields : [];
  for (let fieldIdx = 0; fieldIdx < fields.length; fieldIdx += 1) {
    const field = fields[fieldIdx] || {};
    const fieldId = toPetCakeId(field?.id, `field-${fieldIdx}`);
    const pickedIds = toSelectionIds(customizationSelections?.[fieldId]);
    if (!pickedIds.length) continue;

    const options = Array.isArray(field?.options) ? field.options : [];
    for (let optIdx = 0; optIdx < options.length; optIdx += 1) {
      const option = options[optIdx] || {};
      const optionId = toPetCakeId(option?.id ?? option?.value, `opt-${optIdx}`);
      if (pickedIds.includes(optionId)) {
        total += Number(option?.additionalPrice || 0);
      }
    }
  }

  return total;
};

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const routeFromCities = (fromCity, toCity) => {
  const from = normalizeText(fromCity);
  const to = normalizeText(toCity);
  if (!from || !to) return "";
  return `${from}->${to}`;
};

const scoreFareRule = (rule, context) => {
  if (rule?.isActive === false) return -1;

  let score = 0;
  const ruleFrom = normalizeText(rule?.fromCity);
  const ruleTo = normalizeText(rule?.toCity);
  const ruleRouteKey = normalizeText(rule?.routeKey);
  const ruleMode = normalizeText(rule?.travelMode);
  const rulePetType = normalizeText(rule?.petType);

  if (ruleRouteKey) {
    if (ruleRouteKey !== context.routeKey) return -1;
    score += 60;
  } else {
    if (ruleFrom) {
      if (ruleFrom !== context.fromCity) return -1;
      score += 20;
    }
    if (ruleTo) {
      if (ruleTo !== context.toCity) return -1;
      score += 20;
    }
  }

  if (ruleMode) {
    if (ruleMode !== context.travelMode) return -1;
    score += 20;
  }

  if (rulePetType && rulePetType !== "all") {
    if (rulePetType !== context.petType) return -1;
    score += 10;
  }

  const minDistance = parseOptionalNumber(rule?.minDistanceKm);
  const maxDistance = parseOptionalNumber(rule?.maxDistanceKm);
  if (context.distanceKm !== null) {
    if (minDistance !== null && context.distanceKm < minDistance) return -1;
    if (maxDistance !== null && context.distanceKm > maxDistance) return -1;
    if (minDistance !== null || maxDistance !== null) score += 5;
  }

  if (rule?.isDefault) score += 1;
  return score;
};

const resolveRelocationFare = (serviceDoc, query = {}) => {
  if (serviceDoc?.serviceType !== "relocation") return null;

  const relocation = serviceDoc?.relocation || {};
  const fareRules = Array.isArray(relocation?.fareRules) ? relocation.fareRules : [];
  const dynamicEnabled = Boolean(relocation?.fareConfig?.enableDynamicFare);
  const basePricing = serviceDoc?.pricing ? { ...serviceDoc.pricing } : null;

  const context = {
    fromCity: normalizeText(query?.fromCity),
    toCity: normalizeText(query?.toCity),
    travelMode: normalizeText(query?.travelMode),
    petType: normalizeText(query?.petType || "dog"),
    distanceKm: parseOptionalNumber(query?.distanceKm),
  };
  context.routeKey = routeFromCities(context.fromCity, context.toCity);

  if (!dynamicEnabled || fareRules.length === 0) {
    return {
      basePricing,
      resolvedPricing: basePricing,
      matchedRule: null,
      dynamicApplied: false,
    };
  }

  let bestRule = null;
  let bestScore = -1;
  for (const rule of fareRules) {
    const score = scoreFareRule(rule, context);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  if (!bestRule || !bestRule?.pricing) {
    return {
      basePricing,
      resolvedPricing: basePricing,
      matchedRule: null,
      dynamicApplied: false,
    };
  }

  const petCount = Math.max(1, Number(query?.petCount) || 1);
  const perAdditionalPetCharge =
    Number(bestRule?.perAdditionalPetCharge) ||
    Number(relocation?.fareConfig?.chargePerAdditionalPet) ||
    0;
  const additionalPets = Math.max(0, petCount - 1);
  const addOn = additionalPets * perAdditionalPetCharge;
  const resolvedPricing = {
    mrp: Number(bestRule.pricing?.mrp || 0) + addOn,
    listPrice: Number(bestRule.pricing?.listPrice || 0) + addOn,
    currency: bestRule.pricing?.currency || basePricing?.currency || "INR",
    billingUnit: bestRule.pricing?.billingUnit || basePricing?.billingUnit || "one-time"
  };

  return {
    basePricing,
    resolvedPricing,
    matchedRule: {
      code: bestRule.code,
      fromCity: bestRule.fromCity,
      toCity: bestRule.toCity,
      routeKey: bestRule.routeKey,
      travelMode: bestRule.travelMode,
      petType: bestRule.petType,
      perAdditionalPetCharge,
    },
    dynamicApplied: true,
  };
};

/**
 * POST /api/v1/services/:id/relocation/quote
 * Compatibility endpoint for relocation booking UIs.
 * Pricing is on-demand and therefore this endpoint returns advisory metadata
 * instead of a computed fare quote.
 */
exports.getRelocationQuote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "Invalid service id" });
    }

    const service = await Service.findById(id).lean();
    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, error: "Service not found" });
    }
    if (service.serviceType !== "relocation") {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "Service is not a relocation service" });
    }

    const body = req.body || {};
    const pickupPincode = String(body?.pickup?.pincode || "").trim();
    const dropPincode = String(body?.drop?.pincode || "").trim();
    const travelMode = normalizeText(body?.travelMode || "road");
    const petType = normalizeText(body?.petType || "dog");
    const petCount = Math.max(1, Number(body?.petCount) || 1);
    const isPickupPincodeValid = pickupPincode ? isValidIndianPincode(pickupPincode) : false;
    const isDropPincodeValid = dropPincode ? isValidIndianPincode(dropPincode) : false;
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        serviceId: String(service._id),
        travelMode,
        petType,
        petCount,
        pickup: {
          pincode: pickupPincode || "",
          city: "",
          state: "",
          lat: null,
          lng: null,
          addressLine: body?.pickup?.addressLine || ""
        },
        drop: {
          pincode: dropPincode || "",
          city: "",
          state: "",
          lat: null,
          lng: null,
          addressLine: body?.drop?.addressLine || ""
        },
        distanceKm: null,
        pricing: null,
        basePricing: service?.pricing || null,
        dynamicApplied: false,
        matchedRule: null,
        breakdown: null,
        onDemand: true,
        message: "Relocation request captured. Pricing is on demand and will be shared after pickup/drop review.",
        pincodeValidation: {
          pickup: isPickupPincodeValid,
          drop: isDropPincodeValid
        }
      }
    });
  } catch (err) {
    console.error("getRelocationQuote error:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err?.message || "Failed to compute relocation quote"
    });
  }
};

// Book relocation service directly (without cart/checkout flow)
exports.bookRelocationService = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serviceId } = req.params;
    const {
      owner = {},
      trip = {},
      pet = {},
      requirements = {},
      notes
    } = req.body || {};

    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ success: false, error: "Authentication required" });
    }
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "Invalid serviceId" });
    }

    const service = await Service.findOne({ _id: serviceId, serviceType: "relocation", isActive: true });
    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, error: "Active relocation service not found" });
    }

    const pickupLocation = String(trip?.pickupLocation || "").trim();
    const dropLocation = String(trip?.dropLocation || "").trim();
    const pickupPostalCode = String(trip?.pickupPostalCode || "").trim();
    const dropPostalCode = String(trip?.dropPostalCode || "").trim();
    const travelMode = normalizeText(trip?.travelMode || "road");
    const pickupDate = trip?.pickupDate ? new Date(trip.pickupDate) : null;

    if (!pickupLocation) return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "pickupLocation is required" });
    if (!dropLocation) return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "dropLocation is required" });
    if (!isValidIndianPincode(pickupPostalCode)) return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "pickupPostalCode must be a valid 6-digit pincode" });
    if (!isValidIndianPincode(dropPostalCode)) return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "dropPostalCode must be a valid 6-digit pincode" });
    if (!pickupDate || Number.isNaN(pickupDate.getTime())) return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "pickupDate is required and must be valid" });
    if (!["road", "train", "air", "multimodal"].includes(travelMode)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, error: "travelMode must be one of: road, train, air, multimodal" });
    }

    const relocationBooking = {
      owner: {
        userId,
        fullName: String(owner?.fullName || "").trim() || undefined,
        phoneNumber: String(owner?.phoneNumber || "").trim() || undefined,
        email: String(owner?.email || "").trim() || undefined
      },
      trip: {
        fromCity: String(trip?.fromCity || pickupLocation).trim(),
        toCity: String(trip?.toCity || dropLocation).trim(),
        pickupLocation,
        pickupCity: String(trip?.pickupCity || pickupLocation).trim(),
        pickupPostalCode,
        dropLocation,
        dropCity: String(trip?.dropCity || dropLocation).trim(),
        dropPostalCode,
        pickupDate,
        preferredPickupTime: String(trip?.preferredPickupTime || "").trim() || undefined,
        travelMode
      },
      pet: {
        petId: pet?.petId && mongoose.Types.ObjectId.isValid(pet.petId) ? pet.petId : undefined,
        useCustomPetDetails: Boolean(pet?.useCustomPetDetails),
        petType: String(pet?.petType || "dog").trim(),
        petName: String(pet?.petName || "").trim() || undefined,
        breed: String(pet?.breed || "").trim() || undefined,
        weightKg: pet?.weightKg !== undefined && pet?.weightKg !== null && pet?.weightKg !== "" ? Number(pet.weightKg) : undefined
      },
      requirements: {
        crateRequired: Boolean(requirements?.crateRequired),
        insuranceRequired: Boolean(requirements?.insuranceRequired),
        documentsProvided: Boolean(requirements?.documentsProvided),
        specialInstructions: String(requirements?.specialInstructions || "").trim() || undefined
      },
      status: "requested"
    };

    const booking = await Subscription.create({
      user: userId,
      service: service._id,
      quantity: 1,
      selectedTime: pickupDate,
      frequency: "one-time",
      paymentStatus: "pending",
      amountPaid: 0,
      status: "pending",
      notes: String(notes || "").trim() || undefined,
      relocationBooking
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Your relocation service is booked successfully.",
      data: booking
    });
  } catch (err) {
    console.error("bookRelocationService error:", err);
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err?.message || "Failed to book relocation service"
    });
  }
};

// Create a new service
exports.createService = async (req, res) => {
  try {
    const serviceData = req.body;

    // Generate slug if not provided
    if (!serviceData.slug && serviceData.name) {
      serviceData.slug = generateSlug(serviceData.name);
    }

    // Validate serviceType
    if (serviceData.serviceType && !SERVICE_TYPES.includes(serviceData.serviceType)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: `Invalid serviceType. Must be one of: ${SERVICE_TYPES.join(', ')}`
      });
    }

    const service = new Service(serviceData);
    await service.save();

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Service created successfully',
      data: service
    });
  } catch (err) {
    console.error('Error creating service:', err);
    
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Create a pet nutritionist service (typed helper endpoint)
exports.createPetNutritionistService = async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.serviceType = "pet-nutritionist";
    payload.category = payload.category || "Pet Nutritionist";

    // Generate slug if not provided
    if (!payload.slug && payload.name) {
      payload.slug = generateSlug(payload.name);
    }

    // Basic guardrails for a complete nutritionist record
    if (!payload.partner || !payload.partner.name) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "partner.name is required"
      });
    }

    if (!payload.pricing || payload.pricing.listPrice === undefined || payload.pricing.mrp === undefined) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "pricing.mrp and pricing.listPrice are required"
      });
    }

    const hasLegacyExpert = Boolean(payload?.nutritionist?.expertName);
    const hasExpertsArray = Array.isArray(payload?.nutritionist?.experts) && payload.nutritionist.experts.length > 0;

    if (!payload.nutritionist || (!hasLegacyExpert && !hasExpertsArray)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "nutritionist.expertName or nutritionist.experts[0].name is required"
      });
    }

    const service = new Service(payload);
    await service.save();

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet nutritionist service created successfully",
      data: service
    });
  } catch (err) {
    console.error("Error creating pet nutritionist service:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Validation failed",
        details: errors
      });
    }

    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Book a pet nutritionist slot with full intake details
exports.bookPetNutritionistService = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serviceId } = req.params;
    const {
      expertName,
      consultationType = "video",
      slot,
      petDetails = {},
      quantity = 1,
      frequency = "one-time",
      notes
    } = req.body;

    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error: "Authentication required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Invalid serviceId"
      });
    }

    if (!slot?.date || !slot?.startTime || !slot?.endTime) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "slot.date, slot.startTime and slot.endTime are required"
      });
    }

    const service = await Service.findOne({
      _id: serviceId,
      serviceType: "pet-nutritionist",
      isActive: true
    });

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Active pet nutritionist service not found"
      });
    }

    const experts = Array.isArray(service.nutritionist?.experts) ? service.nutritionist.experts : [];
    let selectedExpert = null;
    let resolvedExpertName = expertName;

    if (experts.length > 0) {
      if (!expertName) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: "expertName is required to choose a nutritionist"
        });
      }

      selectedExpert = experts.find(
        (expert) => String(expert.name || "").toLowerCase() === String(expertName).toLowerCase()
      );

      if (!selectedExpert) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: "Selected expertName does not exist in this service"
        });
      }

      resolvedExpertName = selectedExpert.name;
    } else if (service.nutritionist?.expertName) {
      resolvedExpertName = service.nutritionist.expertName;
    }

    if (!resolvedExpertName) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "No nutritionist expert is configured for this service"
      });
    }

    const reservedFromExpert = selectedExpert
      ? reserveMatchingCalendarSlot(selectedExpert.calendarAvailability, slot)
      : false;
    const reservedFromService = reserveMatchingCalendarSlot(service.nutritionist?.calendarAvailability, slot);

    if (!reservedFromExpert && !reservedFromService) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Selected slot is unavailable for booking"
      });
    }

    await service.save();

    const selectedTime = new Date(slot.date);
    const safeQuantity = Math.max(1, Number(quantity) || 1);
    const baseUnitPrice = Number(service.pricing?.listPrice || 0);
    const customizationUnitPrice = calculatePetCakeCustomizationAmount(
      service?.cake || {},
      ingredients,
      customizationSelections
    );
    const unitPrice = baseUnitPrice + customizationUnitPrice;
    const amountPaid = unitPrice * safeQuantity;
    const normalizedPetCakeBooking = {
      petId: pet._id,
      petName: pet.name,
      cakeTypeId,
      cakeTypeName,
      ingredients: ingredients && typeof ingredients === "object" ? ingredients : undefined,
      customization: {
        size: customization?.size,
        shape: customization?.shape,
        message: customization?.message,
        themeStyle: customization?.themeStyle
      },
      customizationSelections: customizationSelections && typeof customizationSelections === "object"
        ? customizationSelections
        : undefined,
      pricing: {
        baseUnitPrice,
        customizationUnitPrice,
        unitPrice
      },
      notes
    };

    const booking = await Subscription.create({
      user: userId,
      service: service._id,
      quantity: safeQuantity,
      selectedTime: Number.isNaN(selectedTime.getTime()) ? undefined : selectedTime,
      frequency,
      paymentStatus: "pending",
      amountPaid,
      status: "pending",
      notes,
      nutritionBooking: {
        expertName: resolvedExpertName,
        consultationType,
        slot: {
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone: slot.timezone || "Asia/Kolkata"
        },
        petDetails: {
          petInformation: petDetails.petInformation,
          petType: petDetails.petType,
          petBreed: petDetails.petBreed,
          ageYears: petDetails.ageYears,
          ageMonths: petDetails.ageMonths,
          weightKg: petDetails.weightKg,
          activeness: petDetails.activeness,
          currentDiet: petDetails.currentDiet,
          healthAllergies: petDetails.healthAllergies,
          medicalConditions: petDetails.medicalConditions,
          expectedImprovements: petDetails.expectedImprovements,
          notes: petDetails.notes
        }
      }
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet nutritionist booking created successfully",
      data: booking
    });
  } catch (err) {
    console.error("Error booking pet nutritionist service:", err);
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Create a pet communicator service (typed helper endpoint)
exports.createPetCommunicatorService = async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.serviceType = "pet-communicator";
    payload.category = payload.category || "Pet Communicator";

    if (!payload.slug && payload.name) {
      payload.slug = generateSlug(payload.name);
    }

    if (!payload.partner || !payload.partner.name) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "partner.name is required"
      });
    }

    if (!payload.pricing || payload.pricing.listPrice === undefined || payload.pricing.mrp === undefined) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "pricing.mrp and pricing.listPrice are required"
      });
    }

    const hasExpertsArray = Array.isArray(payload?.communicator?.experts) && payload.communicator.experts.length > 0;

    if (!payload.communicator || !hasExpertsArray) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "communicator.experts with at least one expert is required"
      });
    }

    const hasMissingExpertName = payload.communicator.experts.some((expert) => !String(expert?.name || "").trim());
    const hasMissingExpertImage = payload.communicator.experts.some((expert) => !String(expert?.image || "").trim());

    if (hasMissingExpertName) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Every communicator expert must include name"
      });
    }

    if (hasMissingExpertImage) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Every communicator expert must include image"
      });
    }

    const service = new Service(payload);
    await service.save();

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet communicator service created successfully",
      data: service
    });
  } catch (err) {
    console.error("Error creating pet communicator service:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Validation failed",
        details: errors
      });
    }

    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Get pet communicator services
exports.getPetCommunicatorServices = async (req, res) => {
  req.params.serviceType = "pet-communicator";
  return exports.getServicesByType(req, res);
};

// Get a single pet communicator service by id or slug
exports.getPetCommunicatorServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId
      ? { _id: id, serviceType: "pet-communicator" }
      : { slug: id, serviceType: "pet-communicator" };

    const service = await Service.findOne(query)
      .populate("partner.partnerId", "name email phone website")
      .populate("createdBy", "name email")
      .lean();

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Pet communicator service not found"
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      data: service
    });
  } catch (err) {
    console.error("Error fetching pet communicator service:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Book a pet communicator slot
exports.bookPetCommunicatorService = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serviceId } = req.params;
    const {
      petId,
      expertName,
      consultationType = "chat",
      slot,
      concerns,
      quantity = 1,
      frequency = "one-time",
      notes
    } = req.body;

    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error: "Authentication required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Invalid serviceId"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(petId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Valid petId is required"
      });
    }

    if (!slot?.date || !slot?.startTime || !slot?.endTime) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "slot.date, slot.startTime and slot.endTime are required"
      });
    }

    const service = await Service.findOne({
      _id: serviceId,
      serviceType: "pet-communicator",
      isActive: true
    });

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Active pet communicator service not found"
      });
    }

    const pet = await findUserPetForBooking(petId, userId);
    if (!pet) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        error: "Selected pet does not exist or does not belong to this user"
      });
    }

    const experts = Array.isArray(service.communicator?.experts) ? service.communicator.experts : [];
    let selectedExpert = null;
    let resolvedExpertName = expertName;

    if (experts.length > 0) {
      if (!expertName) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: "expertName is required to choose a communicator"
        });
      }

      selectedExpert = experts.find(
        (expert) => String(expert.name || "").toLowerCase() === String(expertName).toLowerCase()
      );

      if (!selectedExpert) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: "Selected expertName does not exist in this service"
        });
      }

      resolvedExpertName = selectedExpert.name;
    } else if (service.communicator?.expertName) {
      resolvedExpertName = service.communicator.expertName;
    }

    if (!resolvedExpertName) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "No pet communicator expert is configured for this service"
      });
    }

    const reservedFromExpert = selectedExpert
      ? reserveMatchingCalendarSlot(selectedExpert.calendarAvailability, slot)
      : false;
    const reservedFromService = reserveMatchingCalendarSlot(service.communicator?.calendarAvailability, slot);

    if (!reservedFromExpert && !reservedFromService) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Selected slot is unavailable for booking"
      });
    }

    await service.save();

    const selectedTime = new Date(slot.date);
    const safeQuantity = Math.max(1, Number(quantity) || 1);
    const baseUnitPrice = Number(service.pricing?.listPrice || 0);
    const customizationUnitPrice = calculatePetCakeCustomizationAmount(
      service?.cake || {},
      ingredients,
      customizationSelections
    );
    const unitPrice = baseUnitPrice + customizationUnitPrice;
    const amountPaid = unitPrice * safeQuantity;
    const normalizedPetCakeBooking = {
      petId: pet._id,
      petName: pet.name,
      cakeTypeId,
      cakeTypeName,
      ingredients: ingredients && typeof ingredients === "object" ? ingredients : undefined,
      customization: {
        size: customization?.size,
        shape: customization?.shape,
        message: customization?.message,
        themeStyle: customization?.themeStyle
      },
      customizationSelections: customizationSelections && typeof customizationSelections === "object"
        ? customizationSelections
        : undefined,
      pricing: {
        baseUnitPrice,
        customizationUnitPrice,
        unitPrice
      },
      notes
    };

    const booking = await Subscription.create({
      user: userId,
      service: service._id,
      quantity: safeQuantity,
      selectedTime: Number.isNaN(selectedTime.getTime()) ? undefined : selectedTime,
      frequency,
      paymentStatus: "pending",
      amountPaid,
      status: "pending",
      notes,
      communicatorBooking: {
        petId: pet._id,
        petName: pet.name,
        expertName: resolvedExpertName,
        consultationType,
        slot: {
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone: slot.timezone || "Asia/Kolkata"
        },
        concerns,
        notes
      }
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet communicator booking created successfully",
      data: booking
    });
  } catch (err) {
    console.error("Error booking pet communicator service:", err);
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Create a pet cake service (typed helper endpoint)
exports.createPetCakeService = async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.serviceType = "pet-cake";
    payload.category = payload.category || "Pet Cake";
    payload.cake = normalizePetCakeConfig(payload.cake);

    if (!payload.slug && payload.name) {
      payload.slug = generateSlug(payload.name);
    }

    if (!payload.partner || !payload.partner.name) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "partner.name is required"
      });
    }

    if (!payload.pricing || payload.pricing.listPrice === undefined || payload.pricing.mrp === undefined) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "pricing.mrp and pricing.listPrice are required"
      });
    }

    const hasCakeTypes = Array.isArray(payload?.cake?.cakeTypes) && payload.cake.cakeTypes.length > 0;
    if (!payload.cake || !hasCakeTypes) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "cake.cakeTypes with at least one item is required"
      });
    }

    const service = new Service(payload);
    await service.save();

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet cake service created successfully",
      data: service
    });
  } catch (err) {
    console.error("Error creating pet cake service:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Validation failed",
        details: errors
      });
    }

    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Get pet cake services
exports.getPetCakeServices = async (req, res) => {
  req.params.serviceType = "pet-cake";
  return exports.getServicesByType(req, res);
};

// Get a single pet cake service by id or slug
exports.getPetCakeServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId
      ? { _id: id, serviceType: "pet-cake" }
      : { slug: id, serviceType: "pet-cake" };

    const service = await Service.findOne(query)
      .populate("partner.partnerId", "name email phone website")
      .populate("createdBy", "name email")
      .lean();

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Pet cake service not found"
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      data: service
    });
  } catch (err) {
    console.error("Error fetching pet cake service:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Book pet cake service
exports.bookPetCakeService = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { serviceId } = req.params;
    const {
      petId,
      cakeTypeId,
      cakeTypeName,
      ingredients = {},
      customization = {},
      customizationSelections = {},
      quantity = 1,
      frequency = "one-time",
      notes
    } = req.body;

    if (!userId) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error: "Authentication required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Invalid serviceId"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(petId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Valid petId is required"
      });
    }

    if (!String(cakeTypeName || "").trim() && !String(cakeTypeId || "").trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "cakeTypeId or cakeTypeName is required"
      });
    }

    const service = await Service.findOne({
      _id: serviceId,
      serviceType: "pet-cake",
      isActive: true
    });

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Active pet cake service not found"
      });
    }

    const pet = await findUserPetForBooking(petId, userId);
    if (!pet) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        error: "Selected pet does not exist or does not belong to this user"
      });
    }

    const safeQuantity = Math.max(1, Number(quantity) || 1);
    const baseUnitPrice = Number(service.pricing?.listPrice || 0);
    const customizationUnitPrice = calculatePetCakeCustomizationAmount(
      service?.cake || {},
      ingredients,
      customizationSelections
    );
    const unitPrice = baseUnitPrice + customizationUnitPrice;
    const amountPaid = unitPrice * safeQuantity;
    const normalizedPetCakeBooking = {
      petId: pet._id,
      petName: pet.name,
      cakeTypeId,
      cakeTypeName,
      ingredients: ingredients && typeof ingredients === "object" ? ingredients : undefined,
      customization: {
        size: customization?.size,
        shape: customization?.shape,
        message: customization?.message,
        themeStyle: customization?.themeStyle
      },
      customizationSelections: customizationSelections && typeof customizationSelections === "object"
        ? customizationSelections
        : undefined,
      pricing: {
        baseUnitPrice,
        customizationUnitPrice,
        unitPrice
      },
      notes
    };

    const booking = await Subscription.create({
      user: userId,
      service: service._id,
      quantity: safeQuantity,
      frequency,
      paymentStatus: "pending",
      amountPaid,
      status: "pending",
      notes,
      petCakeBooking: normalizedPetCakeBooking,
      bookingPayload: {
        selectedDate: null,
        notes,
        petCakeBooking: normalizedPetCakeBooking
      }
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Pet cake booking created successfully",
      data: booking
    });
  } catch (err) {
    console.error("Error booking pet cake service:", err);
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Get all services with advanced filtering, pagination, and sorting
exports.getServices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      serviceType,
      category,
      city,
      state,
      isActive,
      isVerified,
      minPrice,
      maxPrice,
      partnerId,
      tags
    } = req.query;

    // Build filter object
    const filter = {};

    // Search filter
    if (search) {
      filter.$text = { $search: search };
    }

    // Service type filter
    if (serviceType) {
      if (SERVICE_TYPES.includes(serviceType)) {
        filter.serviceType = serviceType;
      } else {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: `Invalid serviceType. Must be one of: ${SERVICE_TYPES.join(', ')}`
        });
      }
    }

    // Category filter
    if (category) {
      filter.category = category;
    }

    // Location filters
    if (city) {
      filter['locationInfo.city'] = { $regex: city, $options: 'i' };
    }
    if (state) {
      filter['locationInfo.state'] = { $regex: state, $options: 'i' };
    }

    // Status filters
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    if (isVerified !== undefined) {
      filter.isVerified = isVerified === 'true';
    }

    // Price range filter
    if (minPrice || maxPrice) {
      filter['pricing.listPrice'] = {};
      if (minPrice) filter['pricing.listPrice'].$gte = parseFloat(minPrice);
      if (maxPrice) filter['pricing.listPrice'].$lte = parseFloat(maxPrice);
    }

    // Partner filter
    if (partnerId) {
      if (mongoose.Types.ObjectId.isValid(partnerId)) {
        filter['partner.partnerId'] = partnerId;
      }
    }

    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      filter.tags = { $in: tagArray.map(tag => tag.trim()) };
    }

    // Build sort object
    let sort = {};
    if (search) {
      sort.score = { $meta: 'textScore' };
    }
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let services = await Service.find(filter)
      .populate('partner.partnerId', 'name email phone')
      .populate('createdBy', 'name email')
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Remove duplicates by _id (safeguard against any edge cases)
    const seenIds = new Set();
    services = services.filter(service => {
      const id = service._id?.toString();
      if (seenIds.has(id)) {
        console.warn(`Duplicate service detected and removed: ${id}`);
        return false;
      }
      seenIds.add(id);
      return true;
    });

    // Get total count
    const total = await Service.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    const currentPageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const hasNextPage = currentPageNum < totalPages;
    const hasPrevPage = currentPageNum > 1;

    res.status(StatusCodes.OK).json({
      success: true,
      data: services,
      pagination: {
        current: currentPageNum,
        next: hasNextPage ? currentPageNum + 1 : null,
        previous: hasPrevPage ? currentPageNum - 1 : null,
        pages: totalPages,
        total,
        limit: limitNum,
        hasNext: hasNextPage,
        hasPrev: hasPrevPage,
        // Helper for infinite scroll
        itemsLoaded: services.length,
        itemsRemaining: Math.max(0, total - (currentPageNum * limitNum))
      }
    });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Get single service by ID or slug
exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if id is valid ObjectId or slug
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId ? { _id: id } : { slug: id };

    const service = await Service.findOne(query)
      .populate('partner.partnerId', 'name email phone website')
      .populate('createdBy', 'name email');

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Service not found"
      });
    }

    const serviceObj = service.toObject();

    res.status(StatusCodes.OK).json({
      success: true,
      data: serviceObj
    });
  } catch (err) {
    console.error('Error fetching service:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Get services by serviceType
exports.getServicesByType = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      city,
      minPrice,
      maxPrice
    } = req.query;

    // Validate serviceType
    if (!SERVICE_TYPES.includes(serviceType)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: `Invalid serviceType. Must be one of: ${SERVICE_TYPES.join(', ')}`
      });
    }

    const filter = {
      serviceType,
      isActive: true
    };

    // Additional filters
    if (city) {
      filter['locationInfo.city'] = { $regex: city, $options: 'i' };
    }

    if (minPrice || maxPrice) {
      filter['pricing.listPrice'] = {};
      if (minPrice) filter['pricing.listPrice'].$gte = parseFloat(minPrice);
      if (maxPrice) filter['pricing.listPrice'].$lte = parseFloat(maxPrice);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const services = await Service.find(filter)
      .populate('partner.partnerId', 'name email phone')
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Service.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(StatusCodes.OK).json({
      success: true,
      data: services,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      filter: {
        serviceType
      }
    });
  } catch (err) {
    console.error('Error fetching services by type:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Get pet nutritionist services
exports.getPetNutritionistServices = async (req, res) => {
  req.params.serviceType = "pet-nutritionist";
  return exports.getServicesByType(req, res);
};

// Get services by category
exports.getServicesByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      serviceType,
      city
    } = req.query;

    const filter = {
      category: { $regex: category, $options: 'i' },
      isActive: true
    };

    if (serviceType && SERVICE_TYPES.includes(serviceType)) {
      filter.serviceType = serviceType;
    }

    if (city) {
      filter['locationInfo.city'] = { $regex: city, $options: 'i' };
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const services = await Service.find(filter)
      .populate('partner.partnerId', 'name email phone')
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Service.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(StatusCodes.OK).json({
      success: true,
      data: services,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      filter: {
        category
      }
    });
  } catch (err) {
    console.error('Error fetching services by category:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Search services (text search)
exports.searchServices = async (req, res) => {
  try {
    const {
      q,
      page = 1,
      limit = 20,
      serviceType,
      city,
      minPrice,
      maxPrice
    } = req.query;

    if (!q || q.length < 2) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    const filter = {
      $text: { $search: q },
      isActive: true
    };

    if (serviceType && SERVICE_TYPES.includes(serviceType)) {
      filter.serviceType = serviceType;
    }

    if (city) {
      filter['locationInfo.city'] = { $regex: city, $options: 'i' };
    }

    if (minPrice || maxPrice) {
      filter['pricing.listPrice'] = {};
      if (minPrice) filter['pricing.listPrice'].$gte = parseFloat(minPrice);
      if (maxPrice) filter['pricing.listPrice'].$lte = parseFloat(maxPrice);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const services = await Service.find(filter, { score: { $meta: 'textScore' } })
      .populate('partner.partnerId', 'name email phone')
      .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Service.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(StatusCodes.OK).json({
      success: true,
      data: services,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      search: {
        query: q,
        totalResults: total
      }
    });
  } catch (err) {
    console.error('Error searching services:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Get services near a location (geospatial query)
exports.getServicesNearby = async (req, res) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 10000, // in meters, default 10km
      page = 1,
      limit = 20,
      serviceType
    } = req.query;

    if (!longitude || !latitude) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'longitude and latitude are required'
      });
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);

    if (isNaN(lng) || isNaN(lat)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid longitude or latitude values'
      });
    }

    const filter = {
      'locationInfo.location': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          },
          $maxDistance: parseFloat(maxDistance)
        }
      },
      isActive: true
    };

    if (serviceType && SERVICE_TYPES.includes(serviceType)) {
      filter.serviceType = serviceType;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const services = await Service.find(filter)
      .populate('partner.partnerId', 'name email phone')
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await Service.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(StatusCodes.OK).json({
      success: true,
      data: services,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      location: {
        coordinates: [lng, lat],
        maxDistance: parseFloat(maxDistance)
      }
    });
  } catch (err) {
    console.error('Error fetching nearby services:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Update a service
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Generate slug if name is updated
    if (updateData.name && !updateData.slug) {
      updateData.slug = generateSlug(updateData.name);
    }

    // Validate serviceType if provided
    if (updateData.serviceType && !SERVICE_TYPES.includes(updateData.serviceType)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: `Invalid serviceType. Must be one of: ${SERVICE_TYPES.join(', ')}`
      });
    }

    const service = await Service.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('partner.partnerId', 'name email phone')
      .populate('createdBy', 'name email');

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Service not found"
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Service updated successfully',
      data: service
    });
  } catch (err) {
    console.error('Error updating service:', err);
    
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: err.message
    });
  }
};

// Delete a service (soft delete by setting isActive to false)
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!service) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "Service not found"
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Service deleted successfully"
    });
  } catch (err) {
    console.error('Error deleting service:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};

// Get service statistics
exports.getServiceStats = async (req, res) => {
  try {
    const totalServices = await Service.countDocuments();
    const activeServices = await Service.countDocuments({ isActive: true });
    const verifiedServices = await Service.countDocuments({ isVerified: true });

    // Service type breakdown
    const typeStats = await Service.aggregate([
      {
        $group: {
          _id: '$serviceType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Category breakdown
    const categoryStats = await Service.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        overview: {
          total: totalServices,
          active: activeServices,
          verified: verifiedServices,
          inactive: totalServices - activeServices
        },
        typeBreakdown: typeStats,
        categoryBreakdown: categoryStats
      }
    });
  } catch (err) {
    console.error('Error fetching service stats:', err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: err.message
    });
  }
};
