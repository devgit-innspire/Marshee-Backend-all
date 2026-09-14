const Product = require("../models/product.model");
const Partner = require("../models/partner.model");
const Pet = require("../models/pet.model");
const { default: mongoose } = require("mongoose");
const { getEmbedding, getConfig, buildSourceHash } = require("../utils/ai/embeddings");
const { buildPetProfileText } = require("../utils/ai/textBuilders");
const { cosineSimilarity } = require("../utils/ai/similarity");
const { sendZapierEmail } = require("../utils/zapierEmailService");
const Review = require("../models/review.model");
const PopularSearch = require("../models/popularSearch.model");
const { isStaff, hasPermission } = require('../utils/roles');

const MAX_POPULAR_SEARCH_QUERY_LEN = 120;
const MIN_POPULAR_SEARCH_QUERY_LEN = 2;
/** Quick-search autocomplete: only log at this length to limit noise */
const MIN_POPULAR_SEARCH_QUICK_LEN = 3;

function normalizePopularSearchKey(q) {
  if (typeof q !== "string") return "";
  const t = q.trim().replace(/\s+/g, " ").toLowerCase();
  return t.slice(0, MAX_POPULAR_SEARCH_QUERY_LEN);
}

/**
 * Upserts popularity for a search string. Non-blocking callers should wrap in setImmediate.
 */
async function recordPopularSearchQuery(rawQuery) {
  const key = normalizePopularSearchKey(rawQuery);
  if (key.length < MIN_POPULAR_SEARCH_QUERY_LEN) return;
  const display = String(rawQuery)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_POPULAR_SEARCH_QUERY_LEN);
  try {
    await PopularSearch.findOneAndUpdate(
      { normalizedQuery: key },
      {
        $inc: { searchCount: 1 },
        $set: { lastSearchedAt: new Date(), displayQuery: display },
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.warn("recordPopularSearchQuery failed:", e.message);
  }
}

// Helper function to generate unique product ID
const generateProductId = async () => {
  const lastProduct = await Product.findOne().sort({ createdAt: -1 });
  if (!lastProduct) return "PROD001";
  const lastId = lastProduct.productId.replace("PROD", "");
  return `PROD${String(parseInt(lastId) + 1).padStart(3, "0")}`;
};

// Helper function to generate variant ID
const generateVariantId = (productId, index) => {
  return `${productId}-${String(index + 1).padStart(3, "0")}`;
};

// Helper function to generate slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^\w ]+/g, "")
    .replace(/ +/g, "-");
};

// Helper function to parse CSV-like strings
const parseCSVString = (str) => {
  if (!str) return [];
  return str
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item);
};

// Helper function to parse images (supports pipe-separated, comma-separated, or array)
const parseImages = (images) => {
  if (!images) return [];
  if (Array.isArray(images)) return images;
  if (typeof images === 'string') {
    return images.split(/[|,]/).map(img => img.trim()).filter(img => img);
  }
  return [];
};

const normalizeRating = (rating) => {
  const n = Number(rating);
  if (!Number.isFinite(n)) return null;
  // Accept only whole-star ratings (1..5) for distribution consistency
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
};

// Helper function to parse age group
const parseAgeGroup = (ageGroup) => {
  if (!ageGroup) return { lifeStages: ["All Ages"] };

  const lifeStagesMap = {
    puppy: "Puppy",
    junior: "Junior",
    adult: "Adult",
    mature: "Mature",
    senior: "Senior",
    "all ages": "All Ages",
    "all life stages": "All Ages",
  };

  const stages = ageGroup
    .toLowerCase()
    .split("|")
    .map((stage) => {
      const trimmed = stage.trim();
      return (
        lifeStagesMap[trimmed] ||
        trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
      );
    })
    .filter((stage) => stage);

  return { lifeStages: stages.length > 0 ? stages : ["All Ages"] };
};

// Helper function to parse breed sizes
const parseBreedSizes = (breedSize) => {
  if (!breedSize) return { breedSizes: ["All Sizes"] };

  const sizesMap = {
    mini: "Mini",
    small: "Small",
    medium: "Medium",
    large: "Large",
    giant: "Giant",
    "all sizes": "All Sizes",
    "all breed sizes": "All Sizes",
  };

  const sizes = breedSize
    .toLowerCase()
    .split("|")
    .map((size) => {
      const trimmed = size.trim();
      return (
        sizesMap[trimmed] || trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
      );
    })
    .filter((size) => size);

  return { breedSizes: sizes.length > 0 ? sizes : ["All Sizes"] };
};

/**
 * Normalize frontend submitData payload into the flat/snake_case shape expected by addProduct.
 * Call this when req.body.submitData is present (e.g. JSON from frontend form).
 */
function normalizeSubmitData(sd) {
  if (!sd || typeof sd !== 'object') return {};
  const lifeStages = sd.petDetails?.ageSuitability?.lifeStages;
  const breedSizes = sd.petDetails?.weightSuitability?.breedSizes;
  return {
    name: sd.name,
    sku: sd.sku ?? '',
    hsn_code: sd.hsnCode ?? '',
    description: sd.description?.full,
    description_short: sd.description?.short,
    ingredients: sd.ingredients,
    manufacturer: sd.manufacturingDetails?.manufacturer,
    country_of_origin: sd.manufacturingDetails?.countryOfOrigin,
    license_numbers_fssai: sd.manufacturingDetails?.license_numbers?.fssai,
    super_category: sd.category?.superCategory,
    service_category: sd.category?.serviceCategory,
    sub_category: sd.category?.subCategory,
    brand: sd.brand,
    partner: sd.partner,
    price_currency: sd.pricing?.currency ?? 'INR',
    price_mrp: sd.pricing?.basePrice,
    price_selling: sd.pricing?.basePrice,
    // Variant stock is authoritative; keep this only for backward compatibility with older forms.
    stock_quantity: sd.inventory?.aggregatedStock?.total,
    is_available: sd.status?.isActive,
    status: sd.status?.approval?.status ?? 'draft',
    product_type: sd.petDetails?.dietaryInfo?.type ?? 'Regular',
    pet_type: sd.petDetails?.targetPet,
    age_group: Array.isArray(lifeStages) ? lifeStages.join('|') : lifeStages,
    breed_size: Array.isArray(breedSizes) ? breedSizes.join('|') : breedSizes,
    tags: Array.isArray(sd.tags) ? sd.tags.join('|') : sd.tags,
    nutrition_protein_percent: sd.nutrition?.protein_percent,
    nutrition_fat_percent: sd.nutrition?.fat_percent,
    nutrition_fiber_percent: sd.nutrition?.fiber_percent,
    nutrition_moisture_percent: sd.nutrition?.moisture_percent,
    nutrition_calories_per_100g: sd.nutrition?.calories_per_100g,
    variants: sd.variants,
    gtin: sd.gtin ?? '',
    recommendations: sd.recommendations,
  };
}

/**
 * The fields that decide what a product sells for, and what a partner earns on
 * it. Changing any of these is a "rate change" and needs `products.pricing`.
 */
const PRICE_FIELDS = ['listPrice', 'mrp', 'discounted', 'costPrice'];
const COMMISSION_FIELDS = ['percentage', 'value'];

/** Variants may arrive as a JSON string from multipart form posts. */
function parseVariantPayload(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }
  }
  return Array.isArray(list) ? list : null;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * True when `updateData` would change any price or commission on `product`.
 *
 * Compares incoming values against the stored variant rather than simply
 * checking whether a price field was present: dashboards routinely re-post the
 * whole product unchanged, and blocking that would make the product form
 * unusable for anyone without pricing rights.
 */
function attemptsPricingChange(product, updateData) {
  const incoming = parseVariantPayload(updateData?.variants);
  if (!incoming) return false;

  const existingById = new Map((product.variants || []).map((v) => [String(v.variantId), v]));

  return incoming.some((v) => {
    const existing = v?.variantId ? existingById.get(String(v.variantId)) : null;

    // A brand-new variant carrying any price is itself a rate change.
    if (!existing) {
      const price = v?.price || {};
      const commission = v?.commission || {};
      return (
        PRICE_FIELDS.some((f) => num(price[f]) !== null) ||
        COMMISSION_FIELDS.some((f) => num(commission[f]) !== null)
      );
    }

    const priceChanged = PRICE_FIELDS.some((f) => {
      const next = num(v?.price?.[f]);
      if (next === null) return false; // not supplied — not a change
      return next !== num(existing?.price?.[f]);
    });

    const commissionChanged = COMMISSION_FIELDS.some((f) => {
      const next = num(v?.commission?.[f]);
      if (next === null) return false;
      return next !== num(existing?.commission?.[f]);
    });

    return priceChanged || commissionChanged;
  });
}

/** True when a create payload sets any price or commission at all. */
function setsAnyPricing(body) {
  const incoming = parseVariantPayload(body?.variants);
  if (!incoming) return false;
  return incoming.some((v) => {
    const price = v?.price || {};
    const commission = v?.commission || {};
    return (
      PRICE_FIELDS.some((f) => num(price[f]) !== null) ||
      COMMISSION_FIELDS.some((f) => num(commission[f]) !== null)
    );
  });
}

const PRICING_DENIED =
  'You do not have permission to set or change pricing. Required: products.pricing. Ask an admin to grant it.';

const addProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Support frontend payload wrapped in submitData
    let body = req.body || {};
    if (body.submitData) {
      body = { ...normalizeSubmitData(body.submitData), ...body };
      delete body.submitData;
    }

    // Same checkpoint as on update — otherwise someone barred from changing
    // rates could simply create the product at whatever price they liked.
    if (isStaff(req.user) && !hasPermission(req.user, 'products.pricing') && setsAnyPricing(body)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: PRICING_DENIED });
    }

    const {
      // Basic product info
      product_id,
      sku,
      brand, // now expecting ObjectId
      name,
      description,
      description_short,

      // Category info
      super_category, // now expecting ObjectId
      service_category, // now expecting ObjectId
      sub_category, // now expecting ObjectId

      // Pet details
      pet_type,
      age_group,
      age_min,   // ageSuitability.min (months)
      age_max,   // ageSuitability.max (months)
      weight_min,   // weightSuitability.min (kg)
      weight_max,   // weightSuitability.max (kg)
      breed_size,
      ingredients,
      produt_type,

      // Variant info
      variant_id,
      flavour,
      weight_g,
      length_cm,
      width_cm,
      height_cm,
      images, // images as string (pipe-separated or comma-separated)

      // Pricing
      price_currency,
      price_mrp,
      price_selling,

      // Inventory
      stock_quantity,
      is_available,

      // Safety
      safety_allergens,
      safety_age_restrictions,
      safety_weight_restrictions,
      safety_health_warnings,

      // Nutrition
      nutrition_protein_percent,
      nutrition_fat_percent,
      nutrition_fiber_percent,
      nutrition_moisture_percent,
      nutrition_calories_per_100g,

      // Business data
      business_popularity_score,
      business_avg_rating,
      business_total_reviews,
      business_margin_percent,
      business_is_premium,

      // Manufacturing
      manufacturer,
      country_of_origin,
      license_numbers_fssai,

      // Additional
      tags,
      status,
      product_type,
      created_at,
      updated_at,
      hsn_code, // HSN Code
      gtin, // GTIN Code

      // Relations
      partner, // now expecting ObjectId
      recommendations, // now expecting { related: [], crossSell: [], upSell: [] } with ObjectIds
      approvedBy, // user who approved (ObjectId)

      // Multiple variants support
      variants, // array of variant objects
    } = body;


    console.log('req.body', req.body);
    
    // Validate required fields
    if (
      !name ||
      !brand ||
      !super_category ||
      !service_category ||
      !sub_category ||
      !pet_type
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Name, brand, super_category, category, sub_category, and pet_type are required",
      });
    }

    // Generate product ID if not provided
    const productId = product_id || (await generateProductId());

    // Check if product with same SKU or productId already exists
    const existingProduct = await Product.findOne({
      $or: [{ productId }, { sku: sku || productId }],
    });

    if (existingProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Product with this ID or SKU already exists",
      });
    }

    // Parse tags and other CSV-like fields
    const parsedTags = parseCSVString(tags);
    const parsedIngredients = parseCSVString(ingredients);
    const ageSuitability = parseAgeGroup(age_group);
    const weightSuitability = parseBreedSizes(breed_size);
    
    // Parse images using helper function
    const parsedImages = parseImages(images);

    // Helper function to parse category IDs - simplified version
    const parseCategoryId = (categoryValue) => {
      if (!categoryValue) return null;

      // If it's already a valid ObjectId string, return it
      if (mongoose.Types.ObjectId.isValid(categoryValue)) {
        return categoryValue;
      }

      // Handle array of ObjectIds (for superCategory)
      if (Array.isArray(categoryValue)) {
        return categoryValue
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      }

      // Handle string that might be JSON
      if (typeof categoryValue === 'string') {
        try {
          // Remove extra quotes if present
          let cleanedValue = categoryValue.trim();
          if (cleanedValue.startsWith('"') && cleanedValue.endsWith('"')) {
            cleanedValue = cleanedValue.slice(1, -1);
          }

          // Try to parse as JSON
          const parsed = JSON.parse(cleanedValue);

          // Handle nested arrays: [[id1, id2]] -> [id1, id2]
          if (Array.isArray(parsed)) {
            if (parsed.length > 0 && Array.isArray(parsed[0])) {
              return parsed[0]
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            }
            // Handle regular array: [id1, id2]
            return parsed
              .filter(id => mongoose.Types.ObjectId.isValid(id))
              .map(id => new mongoose.Types.ObjectId(id));
          }

          // If it's a single value, validate and return
          if (mongoose.Types.ObjectId.isValid(parsed)) {
            return new mongoose.Types.ObjectId(parsed);
          }
        } catch (e) {
          // If parsing fails, try as direct ObjectId string
          if (mongoose.Types.ObjectId.isValid(categoryValue)) {
            return new mongoose.Types.ObjectId(categoryValue);
          }
        }
      }

      return null;
    };

    // Parse category IDs properly
    const parsedSuperCategory = parseCategoryId(super_category);
    const parsedServiceCategory = parseCategoryId(service_category);
    const parsedSubCategory = parseCategoryId(sub_category);

    // Validate that we have valid ObjectIds for categories
    const validateObjectId = (id, fieldName) => {
      if (Array.isArray(id)) {
        return id.every(item => mongoose.Types.ObjectId.isValid(item));
      }
      return mongoose.Types.ObjectId.isValid(id);
    };

    if (!validateObjectId(parsedSuperCategory, 'superCategory')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid superCategory ID(s): ${parsedSuperCategory}`
      });
    }

    if (!validateObjectId(parsedServiceCategory, 'serviceCategory')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid serviceCategory ID: ${parsedServiceCategory}`
      });
    }

    if (!validateObjectId(parsedSubCategory, 'subCategory')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid subCategory ID: ${parsedSubCategory}`
      });
    }

    // Partner: store Partner _id (business profile), not User _id. Resolve Partner by user, or by email and backfill.
    let partnerIdForProduct = partner;
    if (req.user && req.user.role === "partner") {
      let partnerProfile = await Partner.findOne({ user: req.user._id }).session(session);
      if (!partnerProfile && req.user.email) {
        partnerProfile = await Partner.findOne({ 'contact.email': req.user.email }).session(session);
        if (partnerProfile) {
          partnerProfile.user = req.user._id;
          await partnerProfile.save({ session });
        }
      }
      if (partnerProfile) partnerIdForProduct = partnerProfile._id;
    }

    // Build product
    const productData = {
      productId,
      sku: sku || productId,
      gtin: gtin || "",
      hsnCode: hsn_code || "",
      name,
      slug: generateSlug(name),
      description: {
        full: description || `${name} - Premium pet food`,
        short:
          description_short ||
          (description
            ? description.substring(0, 150) + "..."
            : `${name} - Premium quality`),
      },
      ingredients: parsedIngredients.join(", "),

      manufacturingDetails: {
        manufacturer: manufacturer || "",
        countryOfOrigin: country_of_origin || "India",
        license_numbers: {
          fssai: license_numbers_fssai || "",
        },
        dispatch: {
          city: "",
          state: "",
          pinCode: "",
        },
      },

      category: {
        superCategory: Array.isArray(parsedSuperCategory) ? parsedSuperCategory : [parsedSuperCategory], // Ensure it's an array
        serviceCategory: parsedServiceCategory,
        subCategory: parsedSubCategory,
      },

      brand, // directly use ID
      partner: partnerIdForProduct, // Partner _id (business profile), not User _id

      pricing: {
        basePrice: parseFloat(price_selling) || parseFloat(price_mrp) || 0,
        currency: price_currency || "INR",
        tax: {
          rate: 18,
          inclusive: true,
        },
      },

      inventory: {
        sku: sku || productId,
        managementType: "product",
        aggregatedStock: {
          total: parseInt(stock_quantity) || 0,
          reserved: 0,
        },
      },

      petDetails: {
        targetPet: pet_type,
        productType: product_type || "",
        ageSuitability: {
          min: age_min != null && age_min !== '' ? Number(age_min) : undefined,
          max: age_max != null && age_max !== '' ? Number(age_max) : undefined,
          lifeStages: ageSuitability.lifeStages,
        },
        weightSuitability: {
          min: weight_min != null && weight_min !== '' ? Number(weight_min) : undefined,
          max: weight_max != null && weight_max !== '' ? Number(weight_max) : undefined,
          breedSizes: weightSuitability.breedSizes,
        },
        breeds: [],
        healthConditions: [],
        dietaryInfo: {
          type: "Regular",
          features: [],
          preferences: [],
        },
        healthBenefits: [],
      },

      defaultMedia: {
        thumbnail: { url: "", alt: `${name} thumbnail` },
        featuredImage: { url: "", alt: `${name} featured image` },
      },

      variants: [],
      attributes: new Map(),

      status: {
        isActive: is_available !== undefined ? Boolean(is_available) : true,
        isFeatured: false,
        approval: {
          // Only admin can create as approved; partner or unauthenticated always draft
          status: (isStaff(req.user) && status === "active") ? "approved" : "draft",
          approvedBy: approvedBy || null,
          notes: "",
        },
        inventory: parseInt(stock_quantity) > 0 ? "in_stock" : "out_of_stock",
      },

      dimensions: {
        weight_g: parseInt(weight_g) || 0,
        length_cm: parseInt(length_cm) || 0,
        width_cm: parseInt(width_cm) || 0,
        height_cm: parseInt(height_cm) || 0,
      },

      safety: {
        allergens: safety_allergens || "",
        age_restrictions: safety_age_restrictions || "",
        weight_restrictions: safety_weight_restrictions || "",
        health_warnings: safety_health_warnings || "",
      },

      nutrition: {
        protein_percent: parseFloat(nutrition_protein_percent) || 0,
        fat_percent: parseFloat(nutrition_fat_percent) || 0,
        fiber_percent: parseFloat(nutrition_fiber_percent) || 0,
        moisture_percent: parseFloat(nutrition_moisture_percent) || 0,
        calories_per_100g: parseFloat(nutrition_calories_per_100g) || 0,
      },

      business_data: {
        popularity_score: parseInt(business_popularity_score) || 0,
        avg_rating: parseFloat(business_avg_rating) || 0,
        total_reviews: parseInt(business_total_reviews) || 0,
        margin_percent: parseFloat(business_margin_percent) || 0,
        is_premium: Boolean(business_is_premium) || false,
      },

      ratings: {
        average: parseFloat(business_avg_rating) || 0,
        count: parseInt(business_total_reviews) || 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },

      tags: parsedTags,

      seo: {
        title: name,
        metaDescription: description
          ? description.substring(0, 160)
          : `${name} - Premium pet food`,
        keywords: parsedTags,
        canonical: "",
        robots: "index,follow",
      },

      recommendations: recommendations || {
        related: [],
        crossSell: [],
        upSell: [],
      },
    };

    // Override timestamps if provided
    if (created_at) productData.createdAt = new Date(created_at);
    if (updated_at) productData.updatedAt = new Date(updated_at);

    // Process variants - support both multiple variants array and single default variant
    let totalStock = 0;
    let totalReserved = 0;

    // Normalize variants: may arrive as JSON string (from multipart) or as array
    let variantList = variants;
    if (typeof variants === 'string') {
      try {
        const parsed = JSON.parse(variants);
        if (Array.isArray(parsed)) {
          variantList = parsed;
        }
      } catch (e) {
        console.warn('[addProduct] failed to parse variants JSON:', e.message);
      }
    }

    if (variantList && Array.isArray(variantList) && variantList.length > 0) {
      // Validate variants before processing
      const variantSkus = new Set();
      
      for (let i = 0; i < variantList.length; i++) {
        const variantData = variantList[i];
        
        // Validate variant structure
        if (!variantData || typeof variantData !== 'object') {
          await session.abortTransaction();
          await session.endSession();
          return res.status(400).json({
            success: false,
            message: `Variant ${i + 1} must be a valid object`
          });
        }
        
        // Validate price - at least one price field must be present
        const hasPrice = variantData.price?.listPrice || 
                        variantData.price?.discounted || 
                        variantData.price?.mrp ||
                        variantData.listPrice ||
                        variantData.discounted ||
                        variantData.mrp ||
                        variantData.price_selling ||
                        price_selling;
        
        if (!hasPrice && !price_selling && !price_mrp) {
          await session.abortTransaction();
          await session.endSession();
          return res.status(400).json({
            success: false,
            message: `Variant ${i + 1} must have at least one price field (listPrice, discounted, mrp, or price_selling)`
          });
        }
        
        // Check SKU uniqueness within variants
        const variantSku = variantData.sku || `${sku || productId}-${String(i + 1).padStart(3, "0")}`;
        if (variantSkus.has(variantSku)) {
          await session.abortTransaction();
          await session.endSession();
          return res.status(400).json({
            success: false,
            message: `Variant SKU ${variantSku} already exists in this product`
          });
        }
        variantSkus.add(variantSku);
      }
      
      // Process multiple variants
      variantList.forEach((variantData, index) => {
        console.log('[addProduct] processing variant', index, {
          mediaImages: variantData?.media?.images,
          imagesField: variantData?.images
        });

        // Resolve images from media.images, images field, or product-level images
        let variantImages = [];
        if (Array.isArray(variantData?.media?.images)) {
          variantImages = variantData.media.images
            .map((img) => {
              if (!img) return null;
              if (typeof img === 'string') return img;
              if (typeof img === 'object' && 'url' in img) return img.url;
              return null;
            })
            .filter(Boolean);
        }
        if (!variantImages.length && variantData.images) {
          variantImages = parseImages(variantData.images);
        }
        if (!variantImages.length) {
          variantImages = parsedImages;
        }

        console.log('[addProduct] variant', index, 'resolved images:', variantImages);

        // Parse attributes if provided as object or Map
        let variantAttributes = new Map();
        if (variantData.attributes) {
          if (variantData.attributes instanceof Map) {
            variantAttributes = variantData.attributes;
          } else if (typeof variantData.attributes === 'object') {
            Object.keys(variantData.attributes).forEach(key => {
              variantAttributes.set(key, variantData.attributes[key]);
            });
          }
        }

        const variant = {
          variantId: variantData.variantId || generateVariantId(productId, index),
          sku: variantData.sku || `${sku || productId}-${String(index + 1).padStart(3, "0")}`,
          name: variantData.name || `${name} - ${index + 1}`,
          price: {
            listPrice: parseFloat(variantData.price?.listPrice || variantData.listPrice || variantData.price_selling || price_selling || 0),
            mrp: parseFloat(variantData.price?.mrp || variantData.mrp || variantData.price_mrp || price_mrp || 0),
            discounted: parseFloat(variantData.price?.discounted || variantData.discounted || variantData.price_selling || price_selling || 0),
            costPrice: parseFloat(variantData.price?.costPrice || variantData.costPrice || 0),
          },
          commission: variantData.commission || {},
          stock: {
            quantity: parseInt(variantData.stock?.quantity || variantData.stock_quantity || variantData.quantity || 0),
            reserved: parseInt(variantData.stock?.reserved || variantData.reserved || 0),
            lowStockThreshold: parseInt(variantData.stock?.lowStockThreshold || variantData.lowStockThreshold || 5),
          },
          dimensions: {
            weight: parseInt(variantData.dimensions?.weight || variantData.weight || variantData.weight_g || weight_g || 0),
            length: parseInt(variantData.dimensions?.length || variantData.length || variantData.length_cm || length_cm || 0),
            width: parseInt(variantData.dimensions?.width || variantData.width || variantData.width_cm || width_cm || 0),
            height: parseInt(variantData.dimensions?.height || variantData.height || variantData.height_cm || height_cm || 0),
          },
          attributes: Object.fromEntries(variantAttributes),
          media: {
            images: variantImages,
            video: variantData.media?.video || variantData.video || "",
          },
        };

        totalStock += variant.stock.quantity;
        totalReserved += variant.stock.reserved;
        productData.variants.push(variant);
      });
    } else {
      // Create default variant (backward compatibility)
      const defaultVariant = {
        variantId: variant_id || generateVariantId(productId, 0),
        sku: sku ? `${sku}-001` : `${productId}-001`,
        name: `${name} - Default Variant`,
        price: {
          listPrice: parseFloat(price_selling) || parseFloat(price_mrp) || 0,
          mrp: parseFloat(price_mrp) || 0,
          discounted: parseFloat(price_selling) || 0,
          costPrice: 0,
        },
        stock: {
          quantity: parseInt(stock_quantity) || 0,
          reserved: 0,
        },
        dimensions: {
          weight: parseInt(weight_g) || 0,
          length: parseInt(length_cm) || 0,
          width: parseInt(width_cm) || 0,
          height: parseInt(height_cm) || 0,
        },
        attributes: { flavour: flavour || 'Default' },
        media: {
          images: parsedImages,
          video: ""
        },
      };

      totalStock = defaultVariant.stock.quantity;
      totalReserved = defaultVariant.stock.reserved;
      productData.variants.push(defaultVariant);
    }

    // aggregatedStock is auto-computed on Product save (cached sum of variant stocks)
    // Authoritative stock remains per-variant.

    // Inventory status derived from variant availability (best-effort summary)
    const maxAvailable = (productData.variants || []).reduce((m, v) => {
      const qty = Number(v?.stock?.quantity ?? 0);
      return qty > m ? qty : m;
    }, 0);
    if (maxAvailable <= 0) productData.status.inventory = 'out_of_stock';
    else {
      const anyAboveThreshold = (productData.variants || []).some(v => {
        const qty = Number(v?.stock?.quantity ?? 0);
        const th = Number(v?.stock?.lowStockThreshold ?? 5);
        return qty > th;
      });
      productData.status.inventory = anyAboveThreshold ? 'in_stock' : 'low_stock';
    }

    // Save
    const product = new Product(productData);

    await product.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Product added successfully",
      data: product,
    });
  } catch (error) {
    console.error('[addProduct] error:', error.message, error.stack);
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: "Error adding product",
      error: error.message,
    });
  } finally {
    // Ensure session is always closed
    await session.endSession();
  }
};

/** Escape user input before it is used inside a RegExp. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Populate chain shared by the product list queries. */
const withProductPopulates = (query) => query
    .populate('brand', 'name logo')
    .populate('category.superCategory', 'name')
    .populate('category.serviceCategory', 'name')
    .populate('category.subCategory', 'name')
    .populate('partner', 'name email');

/**
 * Relevance score for a search term, highest first:
 *   4 name starts a word with the term ("Premium leather Collars")
 *   3 name contains it anywhere
 *   2 a tag matches
 *   1 the SKU matches
 *   0 only the description matched (e.g. a jacket described as having a collar)
 *
 * Without this, `$or` treats a name hit and a description hit as equal and the
 * results fall back to `createdAt`, so newer unrelated products outrank exact matches.
 */
const buildRelevanceStage = (search) => {
    const escaped = escapeRegex(search);
    const anywhere = new RegExp(escaped, 'i');
    const wordStart = new RegExp(`\\b${escaped}`, 'i');
    const matches = (field, regex) => ({
        $regexMatch: { input: { $ifNull: [field, ''] }, regex }
    });

    return {
        $addFields: {
            _relevance: {
                $switch: {
                    branches: [
                        { case: matches('$name', wordStart), then: 4 },
                        { case: matches('$name', anywhere), then: 3 },
                        {
                            case: {
                                $anyElementTrue: {
                                    $map: {
                                        input: { $ifNull: ['$tags', []] },
                                        as: 'tag',
                                        in: matches('$$tag', anywhere)
                                    }
                                }
                            },
                            then: 2
                        },
                        { case: matches('$sku', anywhere), then: 1 }
                    ],
                    default: 0
                }
            }
        }
    };
};

// Get All Products with advanced filtering, pagination, and sorting
const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      category,
      subCategory,
      brand,
      petType,
      productType,
      status,
      priceMin,
      priceMax,
      inStock
    } = req.query;

    // Build filter object
    const filter = {};

    // Non-staff (public or partner): only show approved, active products (live catalog)
    if (!isStaff(req.user)) {
      filter['status.approval.status'] = 'approved';
      filter['status.isActive'] = true;
    }
    
    // Search filter
    if (search) {
      const escapedSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { 'description.full': { $regex: escapedSearch, $options: 'i' } },
        { sku: { $regex: escapedSearch, $options: 'i' } },
        { tags: { $in: [new RegExp(escapedSearch, 'i')] } }
      ];
    }

    // Category filters
    if (category) filter['category.serviceCategory'] = category;
    if (subCategory) filter['category.subCategory'] = subCategory;
    if (brand) filter.brand = brand;

    // Pet details filters
    if (petType) filter['petDetails.targetPet'] = petType;
    if (productType) filter['petDetails.productType'] = productType;

    // Status filters (admin can override with ?status=draft|pending|approved|rejected)
    if (status && isStaff(req.user)) filter['status.approval.status'] = status;
    if (inStock !== undefined) {
      filter['status.inventory'] = inStock === 'true' ? 'in_stock' : { $ne: 'in_stock' };
    }

    // Price range filter
    if (priceMin || priceMax) {
      filter['pricing.basePrice'] = {};
      if (priceMin) filter['pricing.basePrice'].$gte = parseFloat(priceMin);
      if (priceMax) filter['pricing.basePrice'].$lte = parseFloat(priceMax);
    }

    // Build sort object
    const sort = {};
    // Map friendly sort keys to actual schema paths
    if (sortBy === 'popularity') {
      sort['business_data.popularity_score'] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    // Execute query with population
    const pageLimit = parseInt(limit);
    const pageSkip = (parseInt(page) - 1) * pageLimit;
    let products;

    if (search) {
      // Rank by relevance first so exact name matches beat description-only hits.
      // Paginate over the ranked ids, then re-fetch with populates and restore that order.
      const ranked = await Product.aggregate([
        { $match: filter },
        buildRelevanceStage(search),
        { $sort: { _relevance: -1, ...sort } },
        { $skip: pageSkip },
        { $limit: pageLimit },
        { $project: { _id: 1 } }
      ]);

      const rankedIds = ranked.map((doc) => doc._id);
      const fetched = rankedIds.length
        ? await withProductPopulates(Product.find({ _id: { $in: rankedIds } })).lean()
        : [];
      const byId = new Map(fetched.map((p) => [p._id.toString(), p]));
      products = rankedIds
        .map((id) => byId.get(id.toString()))
        .filter(Boolean);
    } else {
      products = await withProductPopulates(Product.find(filter))
        .sort(sort)
        .limit(pageLimit)
        .skip(pageSkip)
        .lean();
    }

    // Remove duplicates by _id (safeguard against any edge cases)
    const seenIds = new Set();
    products = products.filter(product => {
      const id = product._id?.toString();
      if (seenIds.has(id)) {
        console.warn(`Duplicate product detected and removed: ${id}`);
        return false;
      }
      seenIds.add(id);
      return true;
    });

    // Get total count for pagination
    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    const currentPageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const hasNextPage = currentPageNum < totalPages;
    const hasPrevPage = currentPageNum > 1;

    res.json({
      success: true,
      data: products,
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
        itemsLoaded: products.length,
        itemsRemaining: Math.max(0, total - (currentPageNum * limitNum))
      }
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
};

// Get Product by ID
// Public: only approved + active products. Partner: own products (any status). Admin: all.
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if id is valid ObjectId or productId
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId ? { _id: id } : { $or: [{ productId: id }, { slug: id }] };

    const product = await Product.findOne(query)
      .populate('brand', 'name logo description')
      .populate('category.superCategory', 'name description')
      .populate('category.serviceCategory', 'name description')
      .populate('category.subCategory', 'name description')
      .populate('partner', 'name email phone')
      .populate('status.approval.approvedBy', 'name email')
      .populate('recommendations.related', 'productId name slug pricing.basePrice defaultMedia.thumbnail')
      .populate('recommendations.crossSell', 'productId name slug pricing.basePrice defaultMedia.thumbnail')
      .populate('recommendations.upSell', 'productId name slug pricing.basePrice defaultMedia.thumbnail');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Draft/pending visible only to admin or the product's partner owner
    const isApprovedAndActive =
      product.status.approval?.status === 'approved' && product.status.isActive;

    let canView = false;
    if (isApprovedAndActive) {
      canView = true;
    } else if (isStaff(req.user)) {
      canView = true;
    } else if (req.user && req.user.role === 'partner') {
      const partnerProfile = await Partner.findOne({ user: req.user._id });
      const productPartnerId = product.partner?._id?.toString() || product.partner?.toString();
      canView = !!(partnerProfile && productPartnerId === partnerProfile._id.toString());
    }

    if (!canView) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Attach latest reviews for product page/dashboard.
    // This merges:
    // - New reviews from the Review collection
    // - Legacy embedded reviews that may still exist in Product documents
    // so existing data doesn't disappear during rollout.
    const latestReviews = await Review.find({ product: product._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('user name rating title text media createdAt')
      .lean();

    const legacyReviews = Array.isArray(product?._doc?.reviews) ? product._doc.reviews : [];

    const mergedReviews = [...latestReviews, ...legacyReviews]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    // Recompute ratings from source of truth (Review collection + legacy embedded, deduped).
    // Cached fields on Product can be stale after reviews are deleted elsewhere.
    const [distributionRows, reviewUserIds] = await Promise.all([
      Review.aggregate([
        { $match: { product: product._id } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ]),
      Review.distinct('user', { product: product._id })
    ]);

    const reviewUserIdSet = new Set((reviewUserIds || []).map((u) => String(u)));
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let count = 0;

    for (const row of distributionRows || []) {
      const star = Math.min(5, Math.max(1, Math.round(Number(row?._id))));
      const c = Number(row?.count) || 0;
      distribution[star] = (distribution[star] || 0) + c;
      sum += star * c;
      count += c;
    }

    for (const r of legacyReviews || []) {
      const ru = r?.user;
      const legacyUserId = ru ? String(ru?._id || ru) : null;
      if (legacyUserId && reviewUserIdSet.has(legacyUserId)) continue;
      const v = Number(r?.rating);
      if (!Number.isFinite(v)) continue;
      const star = Math.min(5, Math.max(1, Math.round(v)));
      distribution[star] = (distribution[star] || 0) + 1;
      sum += star;
      count += 1;
    }

    const average = count ? Number((sum / count).toFixed(1)) : 0;

    const productObj = product.toObject();
    productObj.reviews = mergedReviews;
    productObj.ratings = productObj.ratings || {};
    productObj.ratings.count = count;
    productObj.ratings.average = average;
    productObj.ratings.distribution = distribution;

    productObj.business_data = productObj.business_data || {};
    productObj.business_data.total_reviews = count;
    productObj.business_data.avg_rating = average;
    return res.json({ success: true, data: productObj });

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

// Keys that are objects in the Product schema; when sent as multipart/form-data they arrive as JSON strings
const PRODUCT_OBJECT_FIELDS = [
  'description',
  'nutrition',
  'seo',
  'status',
  'recommendations',
  'category',
  'manufacturingDetails',
  'inventory',
  'petDetails',
  'defaultMedia'
];

const parseBodyObjectFields = (body) => {
  const parsed = { ...body };
  for (const key of PRODUCT_OBJECT_FIELDS) {
    const val = parsed[key];
    if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
      try {
        parsed[key] = JSON.parse(val);
      } catch (e) {
        console.warn(`[updateProduct] failed to parse body.${key}:`, e.message);
      }
    }
  }
  return parsed;
};

// Ensure variant.media.images is always an array of plain URL strings
const normalizeVariantMediaImages = (variant) => {
  if (!variant) return variant;

  if (!variant.media || typeof variant.media !== 'object') {
    return variant;
  }

  let images = variant.media.images;

  // If media.images is a JSON / pseudo-JSON string or some serialized array,
  // extract any URL-like substrings and use those as the images.
  if (typeof images === 'string') {
    const text = images.trim();

    // Try to extract URLs from the string (handles things like:
    // "[ 'https://...', { url: 'https://...', isPrimary: false }, 'https://...' ]")
    const urlMatches = text.match(/https?:\/\/[^\s'"]+/g);
    if (urlMatches && urlMatches.length > 0) {
      images = urlMatches;
    } else {
      images = [text];
    }
  }

  if (Array.isArray(images)) {
    const normalized = [];
    images.forEach((img) => {
      if (!img) return;

      // Plain string – possibly still containing multiple URLs
      if (typeof img === 'string') {
        const trimmed = img.trim();
        const urlMatches = trimmed.match(/https?:\/\/[^\s'"]+/g);
        if (urlMatches && urlMatches.length > 0) {
          urlMatches.forEach((u) => normalized.push(u));
        } else {
          normalized.push(trimmed);
        }
        return;
      }

      // Object with url field
      if (typeof img === 'object' && img.url) {
        normalized.push(img.url);
      }
    });

    variant.media.images = normalized;
  } else {
    variant.media.images = [];
  }

  return variant;
};

// Update Product
const updateProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    // Parse object fields that arrive as JSON strings from multipart/form-data
    const updateData = parseBodyObjectFields(req.body);

    console.log('updateData', updateData);

    // Find product
    const product = await Product.findById(id).session(session);
    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Only product owner (partner) or staff can update
    if (!isStaff(req.user)) {
      const partnerProfile = await Partner.findOne({ user: req.user._id }).session(session);
      const productPartnerId = (product.partner && product.partner._id ? product.partner._id : product.partner)?.toString();
      if (!partnerProfile || productPartnerId !== partnerProfile._id.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this product'
        });
      }
    }

    // Rate changes are a separate checkpoint from ordinary product edits: a
    // staff member may be allowed to fix a description but not what it sells for.
    if (isStaff(req.user) && !hasPermission(req.user, 'products.pricing')) {
      if (attemptsPricingChange(product, updateData)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ success: false, message: PRICING_DENIED });
      }
    }

    // Capture pre-update stock snapshot (for low-stock crossing detection)
    const prevVariantStockByVariantId = new Map(
      (product.variants || []).map(v => [String(v.variantId), Number(v?.stock?.quantity ?? 0)])
    );

    // Handle slug generation if name is updated
    if (updateData.name && updateData.name !== product.name) {
      updateData.slug = generateSlug(updateData.name);
    }

    // Normalize variants: may arrive as JSON string (from multipart/form-data via uploadProductImages) or as array
    let variantUpdates = updateData.variants;
    if (typeof variantUpdates === 'string') {
      try {
        const parsed = JSON.parse(variantUpdates);
        variantUpdates = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        console.warn('[updateProduct] failed to parse variants JSON:', e.message);
        variantUpdates = null;
      }
    }
    if (!Array.isArray(variantUpdates)) {
      variantUpdates = null;
    }

    // Product-level images sent during update (e.g. multipart `images`) should
    // be propagated to variants unless a variant has explicit image payload.
    const productLevelImages = parseImages(
      updateData?.images ?? updateData?.media?.images ?? req.body?.images
    );
    const variantsWithExplicitImages = new Set();

    // Handle variant updates
    if (variantUpdates && variantUpdates.length > 0) {
      variantUpdates.forEach((variantUpdate, index) => {
        // If variantId exists, try to find and update existing variant; otherwise treat as new
        const existingVariantIndex =
          variantUpdate.variantId
            ? product.variants.findIndex(
                (v) => v.variantId === variantUpdate.variantId
              )
            : -1;

        if (existingVariantIndex !== -1) {
          // Update existing variant
          const existing = product.variants[existingVariantIndex].toObject();
          const merged = { ...existing, ...variantUpdate };
          const explicitVariantImages = parseImages(
            variantUpdate?.media?.images ?? variantUpdate?.images
          );
          if (explicitVariantImages.length > 0) {
            merged.media = { ...(merged.media || {}), images: explicitVariantImages };
            variantsWithExplicitImages.add(String(existing.variantId));
          } else if (productLevelImages.length > 0) {
            merged.media = { ...(merged.media || {}), images: productLevelImages };
          } else {
            // Client sent no images at all — preserve whatever is in the DB
            merged.media = { ...(merged.media || {}), images: existing.media?.images || [] };
          }
          product.variants[existingVariantIndex] = normalizeVariantMediaImages(merged);
        } else {
          // Add new variant (keep provided variantId if any, otherwise generate)
          const explicitVariantImages = parseImages(
            variantUpdate?.media?.images ?? variantUpdate?.images
          );
          const resolvedVariantImages =
            explicitVariantImages.length > 0 ? explicitVariantImages : productLevelImages;
          const nextVariantId =
            variantUpdate.variantId ||
            generateVariantId(product.productId, product.variants.length + index);

          const newVariant = normalizeVariantMediaImages({
            ...variantUpdate,
            variantId: nextVariantId,
            media: {
              ...(variantUpdate?.media || {}),
              images: resolvedVariantImages,
            },
          });
          if (explicitVariantImages.length > 0) {
            variantsWithExplicitImages.add(String(newVariant.variantId || nextVariantId));
          }
          product.variants.push(newVariant);
        }
      });
      delete updateData.variants; // Remove from general update
    }

    // If product-level images were provided, apply them to every variant that
    // did not receive explicit variant images in this request.
    if (productLevelImages.length > 0) {
      product.variants = (product.variants || []).map((variant) => {
        const variantId = String(variant?.variantId || '');
        if (variantsWithExplicitImages.has(variantId)) return variant;
        const merged = {
          ...variant.toObject(),
          media: {
            ...(variant.media || {}),
            images: productLevelImages,
          },
        };
        return normalizeVariantMediaImages(merged);
      });
    }

    // Prevent accidental persistence of ad-hoc update keys.
    delete updateData.images;
    if (updateData.media && typeof updateData.media === 'object' && 'images' in updateData.media) {
      const nextMedia = { ...updateData.media };
      delete nextMedia.images;
      if (Object.keys(nextMedia).length > 0) updateData.media = nextMedia;
      else delete updateData.media;
    }

    // When partner user updates, ensure partner field stays as their Partner _id (not User _id)
    if (req.user && req.user.role === 'partner' && updateData.hasOwnProperty('partner')) {
      const partnerProfile = await Partner.findOne({ user: req.user._id }).session(session);
      if (partnerProfile) updateData.partner = partnerProfile._id;
    }

    // Approval: only admin can set approved/rejected; partner can only submit for review (draft -> pending)
    if (updateData.status && updateData.status.approval && req.user) {
      if (!isStaff(req.user)) {
        if (req.user.role === 'partner') {
          const requestedStatus = updateData.status.approval.status;
          const currentStatus = product.status.approval?.status || 'draft';
          if (requestedStatus === 'pending' && currentStatus === 'draft') {
            updateData.status.approval = { status: 'pending', notes: updateData.status.approval.notes || '' };
          } else {
            delete updateData.status.approval;
          }
        } else {
          delete updateData.status.approval;
        }
      }
    }

    // Deep-merge petDetails so ageSuitability (min, max, lifeStages) and weightSuitability (min, max, breedSizes) are merged, not replaced
    if (updateData.petDetails && typeof updateData.petDetails === 'object') {
      product.petDetails = product.petDetails || {};
      const existing = product.petDetails;
      const incoming = updateData.petDetails;
      if (incoming.ageSuitability && typeof incoming.ageSuitability === 'object') {
        existing.ageSuitability = { ...(existing.ageSuitability || {}), ...incoming.ageSuitability };
      }
      if (incoming.weightSuitability && typeof incoming.weightSuitability === 'object') {
        existing.weightSuitability = { ...(existing.weightSuitability || {}), ...incoming.weightSuitability };
      }
      // Merge other petDetails fields (targetPet, productType, breeds, etc.)
      Object.keys(incoming).forEach(k => {
        if (k !== 'ageSuitability' && k !== 'weightSuitability') {
          existing[k] = incoming[k];
        }
      });
      product.petDetails = existing;
      delete updateData.petDetails;
    }

    // Update product (partner/brand are ObjectId refs — assign directly to avoid casting spread to object)
    const refKeys = ['partner', 'brand'];
    Object.keys(updateData).forEach(key => {
      if (key !== 'variants') {
        if (refKeys.includes(key) || updateData[key] instanceof mongoose.Types.ObjectId) {
          product[key] = updateData[key];
        } else if (typeof updateData[key] === 'object' && updateData[key] !== null && !Array.isArray(updateData[key])) {
          product[key] = { ...product[key], ...updateData[key] };
        } else {
          product[key] = updateData[key];
        }
      }
    });

    if (req.body.variants) {
      // aggregatedStock is auto-computed on Product save (cached sum of variant stocks)
      // Authoritative stock remains per-variant.

      const variants = product.variants || [];
      const maxAvailable = variants.reduce((m, v) => {
        const qty = Number(v?.stock?.quantity ?? 0);
        return qty > m ? qty : m;
      }, 0);

      if (maxAvailable <= 0) product.status.inventory = 'out_of_stock';
      else {
        const anyAboveThreshold = variants.some(v => {
          const qty = Number(v?.stock?.quantity ?? 0);
          const th = Number(v?.stock?.lowStockThreshold ?? 5);
          return qty > th;
        });
        product.status.inventory = anyAboveThreshold ? 'in_stock' : 'low_stock';
      }
    }

    product.updatedAt = new Date();
    await product.save({ session });
    await session.commitTransaction();

    // Low stock alert (best-effort, outside transaction)
    try {
      const partnerId = (product.partner && product.partner._id ? product.partner._id : product.partner) || null;
      if (partnerId) {
        const partnerDoc = await Partner.findById(partnerId).select('name contact.email').lean();
        const partnerEmail = partnerDoc?.contact?.email;
        if (partnerEmail) {
          const lowStockVariants = (product.variants || [])
            .map(v => {
              const variantId = String(v.variantId);
              const threshold = Number(v?.stock?.lowStockThreshold ?? 5);
              const newQty = Number(v?.stock?.quantity ?? 0);
              const prevQty = prevVariantStockByVariantId.has(variantId)
                ? Number(prevVariantStockByVariantId.get(variantId))
                : undefined;

              const prevWasLow = prevQty === undefined ? false : prevQty <= threshold;
              const newIsLow = newQty <= threshold;

              return {
                variantId,
                name: v?.name,
                sku: v?.sku,
                threshold,
                newQty,
                shouldNotify: newIsLow && !prevWasLow
              };
            })
            .filter(x => x.shouldNotify);

          if (lowStockVariants.length > 0) {
            const subject = `Low stock alert: ${product.name || 'Product'}`;
            const message = `
              <h2>Low stock alert</h2>
              <p><strong>Product:</strong> ${product.name || ''}</p>
              <p><strong>Partner:</strong> ${partnerDoc?.name || ''}</p>
              <hr/>
              ${lowStockVariants.map(v => `
                <p>
                  <strong>Variant:</strong> ${v.name || v.variantId}<br/>
                  <strong>SKU:</strong> ${v.sku || ''}<br/>
                  <strong>Stock:</strong> ${v.newQty} (threshold: ${v.threshold})
                </p>
              `).join('')}
            `;

            const emailResult = await sendZapierEmail({
              email: partnerEmail,
              subject,
              message,
              name: partnerDoc?.name
            });

            if (!emailResult?.success) {
              console.warn('[updateProduct] low-stock Zapier email failed:', emailResult?.error || emailResult);
            }
          }
        }
      }
    } catch (notifyErr) {
      console.warn('[updateProduct] low-stock notification error:', notifyErr?.message || notifyErr);
    }

    // Return updated product with populated fields
    const updatedProduct = await Product.findById(id)
      .populate('brand', 'name logo')
      .populate('category.superCategory', 'name')
      .populate('category.serviceCategory', 'name')
      .populate('category.subCategory', 'name');

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });

  } catch (error) {
    console.error('[updateProduct] Error:', error.message);
    console.error('[updateProduct] Code:', error.code);
    if (error.errors) console.error('[updateProduct] Validation errors:', JSON.stringify(error.errors, null, 2));
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error('[updateProduct] Abort transaction error:', abortErr.message);
    }
    // MongoDB duplicate key (e.g. unique sku, slug, inventory.sku)
    if (error.code === 11000) {
      const field = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'field';
      return res.status(409).json({
        success: false,
        message: `A product with this ${field.replace(/^inventory\.|\./g, '').replace(/([A-Z])/g, ' $1').trim()} already exists`,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message
    });
  } finally {
    try {
      await session.endSession();
    } catch (e) {
      console.error('[updateProduct] End session error:', e.message);
    }
  }
};

// Update product approval (admin only). Use PATCH /products/:id/approval with body: { status: 'approved'|'rejected', notes? }
const updateProductApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: approvalStatus, notes } = req.body || {};

    if (!approvalStatus || !['approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Body must include status: "approved" or "rejected"'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    product.status.approval.status = approvalStatus;
    product.status.approval.approvedBy = req.user._id;
    if (notes !== undefined) product.status.approval.notes = notes;
    product.updatedAt = new Date();
    await product.save();

    const updated = await Product.findById(id)
      .populate('brand', 'name logo')
      .populate('category.superCategory', 'name')
      .populate('category.serviceCategory', 'name')
      .populate('category.subCategory', 'name')
      .populate('status.approval.approvedBy', 'name email');

    res.json({
      success: true,
      message: `Product ${approvalStatus === 'approved' ? 'approved' : 'rejected'} successfully`,
      data: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating product approval',
      error: error.message
    });
  }
};

// Delete Product
const deleteProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const product = await Product.findById(id).session(session);
    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Only product owner (partner) or staff can delete
    if (!isStaff(req.user)) {
      const partnerProfile = await Partner.findOne({ user: req.user._id }).session(session);
      const productPartnerId = (product.partner && product.partner._id ? product.partner._id : product.partner)?.toString();
      if (!partnerProfile || productPartnerId !== partnerProfile._id.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this product'
        });
      }
    }

    // Soft delete by setting isActive to false
    product.status.isActive = false;
    product.status.approval.status = 'draft';
    await product.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  } finally {
    // Ensure session is always closed
    await session.endSession();
  }
};


// Get Products by Category
const getProductsByCategory = async (req, res) => {
  try {
    const { categoryType, categoryId } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'popularity',
      sortOrder = 'desc'
    } = req.query;

    let filter = {};
    
    // Determine which category field to filter by
    switch (categoryType) {
      case 'super':
        filter['category.superCategory'] = categoryId;
        break;
      case 'service':
        filter['category.serviceCategory'] = categoryId;
        break;
      case 'sub':
        filter['category.subCategory'] = categoryId;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid category type. Use: super, service, or sub'
        });
    }

    filter['status.isActive'] = true;
    filter['status.approval.status'] = 'approved';

    // Build sort object
    let sort = {};
    switch (sortBy) {
      case 'popularity':
        sort['business_data.popularity_score'] = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'price':
        sort.createdAt = -1; // Will be sorted after query if needed
        break;
      case 'rating':
        sort['ratings.average'] = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'newest':
        sort.createdAt = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'name':
        sort.name = sortOrder === 'desc' ? -1 : 1;
        break;
      default:
        sort['business_data.popularity_score'] = -1;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let products = await Product.find(filter)
      .populate('brand', 'name logo')
      .populate('category.superCategory', 'name')
      .populate('category.serviceCategory', 'name')
      .populate('category.subCategory', 'name')
      .populate('partner', 'name email')
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Remove duplicates by _id (safeguard against any edge cases)
    const seenIds = new Set();
    products = products.filter(product => {
      const id = product._id?.toString();
      if (seenIds.has(id)) {
        console.warn(`Duplicate product detected and removed: ${id}`);
        return false;
      }
      seenIds.add(id);
      return true;
    });

    // Get total count for pagination
    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    const currentPageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const hasNextPage = currentPageNum < totalPages;
    const hasPrevPage = currentPageNum > 1;

    res.json({
      success: true,
      data: products,
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
        itemsLoaded: products.length,
        itemsRemaining: Math.max(0, total - (currentPageNum * limitNum))
      }
    });

  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
};

/**
 * Public list of most-searched product query strings (aggregated from search usage).
 */
const getPopularSearches = async (req, res) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 10;

    const rows = await PopularSearch.find({})
      .sort({ searchCount: -1, lastSearchedAt: -1 })
      .limit(limit)
      .select("displayQuery searchCount lastSearchedAt")
      .lean();

    res.json({
      success: true,
      data: rows.map((r) => ({
        query: r.displayQuery,
        searchCount: r.searchCount,
        lastSearchedAt: r.lastSearchedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching popular searches:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching popular searches",
      error: error.message,
    });
  }
};

// Advanced Product Search - FIXED VERSION
const searchProducts = async (req, res) => {
  try {
    const {
      q, // search query
      page = 1,
      limit = 20,
      sortBy = 'relevance',
      sortOrder = 'desc',
      category,
      subCategory,
      brand,
      petType,
      productType,
      priceMin,
      priceMax,
      rating,
      inStock,
      tags,
      ingredients,
      healthBenefits,
      ageSuitability,
      breedSize,
      discountOnly = false
    } = req.query;

    // Build search filter
    const filter = {
      'status.isActive': true,
      'status.approval.status': 'approved'
    };

    // Build text search conditions separately
    const textSearchConditions = [];
    const escapedQ = q ? escapeRegex(q) : '';
    if (q) {
      textSearchConditions.push(
        { name: { $regex: escapedQ, $options: 'i' } },
        { 'description.full': { $regex: escapedQ, $options: 'i' } },
        { 'description.short': { $regex: escapedQ, $options: 'i' } },
        { sku: { $regex: escapedQ, $options: 'i' } },
        { tags: { $in: [new RegExp(escapedQ, 'i')] } },
        { ingredients: { $regex: escapedQ, $options: 'i' } }
      );
    }

    // Category filters - FIXED: Handle ObjectId properly
    if (category) {
      if (mongoose.Types.ObjectId.isValid(category)) {
        filter['category.serviceCategory'] = new mongoose.Types.ObjectId(category);
      } else {
        filter['category.serviceCategory'] = category;
      }
    }
    
    if (subCategory) {
      if (mongoose.Types.ObjectId.isValid(subCategory)) {
        filter['category.subCategory'] = new mongoose.Types.ObjectId(subCategory);
      } else {
        filter['category.subCategory'] = subCategory;
      }
    }
    
    if (brand) {
      if (mongoose.Types.ObjectId.isValid(brand)) {
        filter.brand = new mongoose.Types.ObjectId(brand);
      } else {
        filter.brand = brand;
      }
    }

    // Pet-specific filters - FIXED: Use direct matching instead of regex for enums
    if (petType) {
      filter['petDetails.targetPet'] = { 
        $regex: new RegExp(`^${petType}$`, 'i') 
      };
    }
    
    if (productType) {
      filter['petDetails.productType'] = productType;
    }
    
    if (ageSuitability) {
      filter['petDetails.ageSuitability.lifeStages'] = ageSuitability;
    }
    
    if (breedSize) {
      filter['petDetails.weightSuitability.breedSizes'] = breedSize;
    }

    // Price range filter - FIXED: Handle variant price filtering properly
    if (priceMin || priceMax) {
      // Since prices are in variants, we need to use aggregation or check if any variant matches
      filter['variants'] = {
        $elemMatch: {
          $or: [
            { 
              'price.discounted': { 
                $gte: parseFloat(priceMin || 0),
                $lte: parseFloat(priceMax || 999999)
              } 
            },
            { 
              'price.listPrice': { 
                $gte: parseFloat(priceMin || 0),
                $lte: parseFloat(priceMax || 999999)
              } 
            }
          ]
        }
      };
    }

    // Rating filter
    if (rating) {
      filter['ratings.average'] = { $gte: parseFloat(rating) };
    }

    // Stock filter - build separately to avoid conflicts
    const stockConditions = [];
    if (inStock !== undefined) {
      if (inStock === 'true') {
        // When inStock is true, add as direct filter (AND condition)
        filter['status.inventory'] = 'in_stock';
      } else {
        // When inStock is false, build OR conditions for low_stock or out_of_stock
        stockConditions.push(
          { 'status.inventory': 'low_stock' },
          { 'status.inventory': 'out_of_stock' }
        );
      }
    }

    // Combine text search and stock conditions properly
    // If we have both text search and stock conditions (inStock=false), use $and
    if (textSearchConditions.length > 0 && stockConditions.length > 0) {
      filter.$and = [
        { $or: textSearchConditions },
        { $or: stockConditions }
      ];
    } else if (textSearchConditions.length > 0) {
      // Only text search conditions
      filter.$or = textSearchConditions;
    } else if (stockConditions.length > 0) {
      // Only stock conditions (inStock=false)
      filter.$or = stockConditions;
    }
    // If inStock=true, it's already set as direct filter above

    // Tags filter - FIXED: Handle single tag or array
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      filter.tags = { $in: tagArray.map(tag => new RegExp(tag.trim(), 'i')) };
    }

    // Ingredients filter
    if (ingredients) {
      filter.ingredients = { $regex: ingredients, $options: 'i' };
    }

    // Health benefits filter - FIXED: Correct path and handle array
    if (healthBenefits) {
      const benefitsArray = Array.isArray(healthBenefits) ? healthBenefits : healthBenefits.split(',');
      filter['petDetails.healthBenefits.benefit'] = { 
        $in: benefitsArray.map(benefit => new RegExp(benefit.trim(), 'i')) 
      };
    }

    // Discount-only filter - FIXED: Simplified approach
    if (discountOnly === 'true') {
      filter['variants'] = {
        $elemMatch: {
          $or: [
            { 
              $expr: { 
                $gt: [
                  { $ifNull: ['$price.mrp', '$price.listPrice'] },
                  { $ifNull: ['$price.discounted', '$price.listPrice'] }
                ]
              }
            },
            { 'price.discountPercentage': { $gt: 0 } }
          ]
        }
      };
    }

    // Build sort object - FIXED: Handle sorting properly
    let sort = {};
    switch (sortBy) {
      case 'relevance':
        if (q) {
          // Simple relevance: exact match in name first, then other fields
          // This is a basic implementation
          sort.name = sortOrder === 'desc' ? -1 : 1;
        }
        sort['business_data.popularity_score'] = -1;
        break;
      case 'price':
        // Price sorting is handled after query since prices are in variants
        sort.createdAt = -1;
        break;
      case 'rating':
        sort['ratings.average'] = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'popularity':
        sort['business_data.popularity_score'] = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'newest':
        sort.createdAt = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'discount':
        // Discount sorting handled after query
        sort.createdAt = -1;
        break;
      default:
        sort.createdAt = -1;
    }

    // Execute search query. A keyword search ranks by relevance the same way
    // getAllProducts/getDashboardProducts do: a product whose name/tag/sku
    // contains the query outranks one that only mentions it in the
    // description (e.g. a jacket whose copy mentions "collar" as a design
    // detail) — the DB-level `sort` above can't express that on its own.
    let products;
    const isRelevanceTextSearch = Boolean(q) && (sortBy === 'relevance' || !sortBy);
    if (isRelevanceTextSearch) {
      const pageLimit = parseInt(limit);
      const pageSkip = (parseInt(page) - 1) * pageLimit;

      const ranked = await Product.aggregate([
        { $match: filter },
        buildRelevanceStage(q),
        { $sort: { _relevance: -1, ...sort } },
        { $skip: pageSkip },
        { $limit: pageLimit },
        { $project: { _id: 1 } }
      ]);

      const rankedIds = ranked.map((doc) => doc._id);
      const fetched = rankedIds.length
        ? await withProductPopulates(Product.find({ _id: { $in: rankedIds } })).lean()
        : [];
      const byId = new Map(fetched.map((p) => [p._id.toString(), p]));
      products = rankedIds.map((id) => byId.get(id.toString())).filter(Boolean);
    } else {
      products = await Product.find(filter)
        .populate('brand', 'name logo')
        .populate('category.serviceCategory', 'name')
        .populate('category.subCategory', 'name')
        .sort(sort)
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .lean();
    }

    // Calculate discount information for each product - FIXED: Handle missing price data
    const productsWithDiscountInfo = products.map(product => {
      let minPrice = Infinity;
      let maxPrice = 0;
      let maxDiscount = 0;
      let hasDiscount = false;
      let availableVariants = [];

      product.variants.forEach(variant => {
        const mrp = variant.price?.mrp || variant.price?.listPrice || 0;
        const sellingPrice = variant.price?.discounted || variant.price?.listPrice || mrp;
        
        if (sellingPrice > 0) {
          minPrice = Math.min(minPrice, sellingPrice);
          maxPrice = Math.max(maxPrice, sellingPrice);
          
          if (mrp > sellingPrice) {
            const discount = ((mrp - sellingPrice) / mrp) * 100;
            maxDiscount = Math.max(maxDiscount, discount);
            hasDiscount = true;
          }
          
          availableVariants.push({
            ...variant,
            calculatedDiscount: mrp > sellingPrice ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0
          });
        }
      });

      return {
        ...product,
        availableVariants,
        priceRange: {
          min: minPrice !== Infinity ? minPrice : 0,
          max: maxPrice !== 0 ? maxPrice : 0
        },
        discountInfo: {
          hasDiscount,
          maxDiscount: Math.round(maxDiscount),
          bestPrice: minPrice !== Infinity ? minPrice : 0
        }
      };
    });

    // Apply price sorting if needed - FIXED: Handle price and discount sorting
    if (sortBy === 'price') {
      productsWithDiscountInfo.sort((a, b) => {
        const priceA = a.priceRange.min;
        const priceB = b.priceRange.min;
        return sortOrder === 'desc' ? priceB - priceA : priceA - priceB;
      });
    }

    // Apply discount sorting if needed
    if (sortBy === 'discount') {
      productsWithDiscountInfo.sort((a, b) => {
        return sortOrder === 'desc' ? 
          b.discountInfo.maxDiscount - a.discountInfo.maxDiscount :
          a.discountInfo.maxDiscount - b.discountInfo.maxDiscount;
      });
    }

    // Total matching documents (used for pagination; do not use page-limited array length)
    const total = await Product.countDocuments(filter);

    // Search aggregations for facets - FIXED: Simplified aggregation
    let searchStats = {};
    try {
      const aggregationResult = await Product.aggregate([
        { $match: filter },
        {
          $facet: {
            priceRange: [
              {
                $project: {
                  minPrice: { $min: '$variants.price.discounted' },
                  maxPrice: { $max: '$variants.price.discounted' }
                }
              },
              {
                $group: {
                  _id: null,
                  minPrice: { $min: '$minPrice' },
                  maxPrice: { $max: '$maxPrice' }
                }
              }
            ],
            categoryCounts: [
              {
                $group: {
                  _id: '$category.serviceCategory',
                  count: { $sum: 1 }
                }
              }
            ],
            brandCounts: [
              {
                $group: {
                  _id: '$brand',
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ]);

      searchStats = aggregationResult[0] || {};
    } catch (aggError) {
      // Aggregation error - continue without stats
      searchStats = {};
    }

    // Results are already page-limited by find(skip/limit); in-memory sort only reorders that page
    const paginatedProducts = productsWithDiscountInfo;

    if (q && normalizePopularSearchKey(q).length >= MIN_POPULAR_SEARCH_QUERY_LEN) {
      setImmediate(() => {
        recordPopularSearchQuery(q).catch(() => {});
      });
    }

    res.json({
      success: true,
      data: paginatedProducts,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)) || 1,
        total,
        hasNext: parseInt(page) * parseInt(limit) < total,
        hasPrev: parseInt(page) > 1
      },
      searchMeta: {
        query: q || '',
        totalResults: total,
        filtersApplied: Object.keys(req.query).length - 2, // exclude page and limit
        searchStats
      }
    });

  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: error.message
    });
  }
};

// Quick Search (for autocomplete) - FIXED VERSION
const quickSearch = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
        message: 'Query too short'
      });
    }

    const products = await Product.find({
      'status.isActive': true,
      'status.approval.status': 'approved',
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } },
        { 'brand.name': { $regex: q, $options: 'i' } }
      ]
    })
    .populate('brand', 'name')
    .select('productId name slug brand pricing variants.stock.quantity ratings.average')
    .limit(parseInt(limit))
    .lean();

    // Format response for quick search
    const formattedProducts = products.map(product => {
      // Get the lowest price from variants
      let minPrice = Infinity;
      if (product.variants && product.variants.length > 0) {
        product.variants.forEach(variant => {
          const price = variant.price?.discounted || variant.price?.listPrice || 0;
          if (price > 0) minPrice = Math.min(minPrice, price);
        });
      }

      return {
        productId: product.productId,
        name: product.name,
        slug: product.slug,
        brand: product.brand?.name || 'Unknown Brand',
        price: minPrice !== Infinity ? minPrice : 0,
        inStock: Array.isArray(product.variants) && product.variants.some(v => (Number(v?.stock?.quantity) || 0) > 0),
        rating: product.ratings?.average || 0
      };
    });

    if (normalizePopularSearchKey(q).length >= MIN_POPULAR_SEARCH_QUICK_LEN) {
      setImmediate(() => {
        recordPopularSearchQuery(q).catch(() => {});
      });
    }

    res.json({
      success: true,
      data: formattedProducts,
      message: `Found ${formattedProducts.length} products matching "${q}"`
    });

  } catch (error) {
    console.error('Error in quick search:', error);
    res.status(500).json({
      success: false,
      message: 'Error performing search',
      error: error.message
    });
  }
};

// Dashboard: Get products (Partner sees own products, Admin sees all)
// @route   GET /api/v1/products/dashboard
// @access  Private (Partner/Admin)
const getDashboardProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      category,
      subCategory,
      brand,
      petType,
      productType,
      status,
      priceMin,
      priceMax,
      inStock
    } = req.query;

    console.log('req.user', req.user);
    console.log('req.query', req.query);
    // Build filter object
    const filter = {};

    // Partner filter: show products where product.partner is Partner _id OR User _id (legacy products)
    if (req.user && req.user.role === 'partner') {
      let partnerProfile = await Partner.findOne({ user: req.user._id }).lean();
      if (!partnerProfile && req.user.email) {
        partnerProfile = await Partner.findOne({ 'contact.email': req.user.email }).lean();
      }
      if (partnerProfile) {
        filter.partner = { $in: [partnerProfile._id, req.user._id] };
      } else {
        filter.partner = req.user._id;
      }
    }
    
    // Admin sees all products (no partner filter)

    // Search filter
    if (search) {
      const escapedSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { 'description.full': { $regex: escapedSearch, $options: 'i' } },
        { sku: { $regex: escapedSearch, $options: 'i' } },
        { tags: { $in: [new RegExp(escapedSearch, 'i')] } }
      ];
    }

    // Category filters
    if (category) filter['category.serviceCategory'] = category;
    if (subCategory) filter['category.subCategory'] = subCategory;
    if (brand) filter.brand = brand;

    // Pet details filters
    if (petType) filter['petDetails.targetPet'] = petType;
    if (productType) filter['petDetails.productType'] = productType;

    // Status filters
    if (status) filter['status.approval.status'] = status;
    if (inStock !== undefined) {
      filter['status.inventory'] = inStock === 'true' ? 'in_stock' : { $ne: 'in_stock' };
    }

    // Price range filter
    if (priceMin || priceMax) {
      filter['pricing.basePrice'] = {};
      if (priceMin) filter['pricing.basePrice'].$gte = parseFloat(priceMin);
      if (priceMax) filter['pricing.basePrice'].$lte = parseFloat(priceMax);
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with population
    let products = await Product.find(filter)
      .populate('brand', 'name logo')
      .populate('category.superCategory', 'name')
      .populate('category.serviceCategory', 'name')
      .populate('category.subCategory', 'name')
      .populate('partner', 'name email')
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Remove duplicates by _id (safeguard against any edge cases)
    const seenIds = new Set();
    products = products.filter(product => {
      const id = product._id?.toString();
      if (seenIds.has(id)) {
        console.warn(`Duplicate product detected and removed: ${id}`);
        return false;
      }
      seenIds.add(id);
      return true;
    });

    // Get total count for pagination
    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / parseInt(limit));

    const currentPageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const hasNextPage = currentPageNum < totalPages;
    const hasPrevPage = currentPageNum > 1;

    res.json({
      success: true,
      data: products,
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
        itemsLoaded: products.length,
        itemsRemaining: Math.max(0, total - (currentPageNum * limitNum))
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard products:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
};

// Admin only: list products awaiting review (draft + pending) so admin can approve and make them go live
// GET /api/v1/products/for-review?page=1&limit=20
const getProductsForReview = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const filter = {
      'status.approval.status': { $in: ['draft', 'pending'] },
      'status.isActive': true
    };

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const products = await Product.find(filter)
      .populate('brand', 'name logo')
      .populate('category.superCategory', 'name')
      .populate('category.serviceCategory', 'name')
      .populate('category.subCategory', 'name')
      .populate('partner', 'name email phone')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Product.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);
    const currentPageNum = parseInt(page);

    res.json({
      success: true,
      data: products,
      message: 'Products awaiting review (draft/pending). Use PATCH /products/:id/approval with { status: "approved" } to go live.',
      pagination: {
        current: currentPageNum,
        next: currentPageNum < totalPages ? currentPageNum + 1 : null,
        previous: currentPageNum > 1 ? currentPageNum - 1 : null,
        pages: totalPages,
        total,
        limit: limitNum,
        hasNext: currentPageNum < totalPages,
        hasPrev: currentPageNum > 1
      }
    });
  } catch (error) {
    console.error('Error fetching products for review:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products for review',
      error: error.message
    });
  }
};

// Add review & rating to a product (stores media as link arrays)
// POST /api/v1/products/:id/reviews
const addProductReview = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    console.log('review body', body);

    // multipart/form-data may send `media` as a JSON string; files are merged into body.images / body.videos by middleware
    let mediaImages = body.media?.images;
    let mediaVideos = body.media?.videos;
    if (typeof body.media === 'string' && body.media.trim()) {
      try {
        const m = JSON.parse(body.media);
        if (m && typeof m === 'object') {
          mediaImages = mediaImages ?? m.images;
          mediaVideos = mediaVideos ?? m.videos;
        }
      } catch (e) {
        /* ignore invalid media JSON */
      }
    }

    const rating = normalizeRating(body.rating);
    if (rating == null) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be an integer between 1 and 5'
      });
    }

    const query = mongoose.Types.ObjectId.isValid(id)
      ? { _id: id }
      : { $or: [{ productId: id }, { slug: id }] };

    const product = await Product.findOne(query);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const isApprovedAndActive =
      product.status?.approval?.status === 'approved' && product.status?.isActive;
    if (!isApprovedAndActive && !isStaff(req.user)) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // If the product already has legacy embedded reviews, treat them as duplicates too.
    // (During rollout/migration, legacy reviews may still exist in existing Product documents.)
    const legacyReviews = Array.isArray(product?._doc?.reviews) ? product._doc.reviews : [];
    const legacyReviewed = legacyReviews.some((r) => {
      const ru = r?.user;
      if (!ru) return false;
      const legacyUserId = String(ru?._id || ru);
      return legacyUserId === String(req.user._id);
    });

    if (legacyReviewed) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    const existingReview = await Review.findOne({
      product: product._id,
      user: req.user._id
    });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    const images = parseImages(mediaImages ?? body.images);
    const videos = parseImages(mediaVideos ?? body.videos);

    const createdReview = await Review.create({
      product: product._id,
      user: req.user._id,
      name: req.user.name || 'Anonymous',
      rating,
      title: body.title,
      text: body.text,
      media: { images, videos }
    });

    // Update cached rating summary incrementally so existing legacy reviews
    // (stored in Products before this refactor) don't get "forgotten".
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const prevDist = product?.ratings?.distribution || {};

    let prevCount = 0;
    let prevSum = 0;
    for (const star of [1, 2, 3, 4, 5]) {
      const c = Number(prevDist?.[star] ?? prevDist?.[String(star)] ?? 0) || 0;
      distribution[star] = c;
      prevCount += c;
      prevSum += star * c;
    }

    distribution[rating] = Number(distribution[rating] || 0) + 1;

    const count = prevCount + 1;
    const sum = prevSum + rating;
    const average = count ? Number((sum / count).toFixed(1)) : 0;

    product.ratings = product.ratings || {};
    product.ratings.average = average;
    product.ratings.count = count;
    product.ratings.distribution = distribution;

    product.business_data = product.business_data || {};
    product.business_data.avg_rating = average;
    product.business_data.total_reviews = count;

    await product.save();

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: {
        review: createdReview,
        ratings: product.ratings
      }
    });
  } catch (error) {
    console.error('Error adding product review:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding product review',
      error: error.message
    });
  }
};

function parseBirthdayToAgeMonths(birthday) {
  if (!birthday || typeof birthday !== 'string') return null;
  const [dayStr, monthStr, yearStr] = birthday.split('/');
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  if (!day || !month || !year) return null;
  const birthDate = new Date(year, month - 1, day);
  if (Number.isNaN(birthDate.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());
  if (now.getDate() < birthDate.getDate()) months -= 1;
  return months >= 0 ? months : null;
}

function isPetOwnerOrCoOwner(pet, user) {
  if (!pet || !user) return false;
  const userId = String(user._id || user.id || '');
  if (!userId) return false;
  const ownerId = String((pet.owner && (pet.owner._id || pet.owner)) || '');
  if (ownerId && ownerId === userId) return true;
  const coOwners = Array.isArray(pet.coOwners) ? pet.coOwners : [];
  return coOwners.some((co) => String((co && (co._id || co)) || '') === userId);
}

function tokenizeAllergies(allergies) {
  if (!allergies) return [];
  return String(allergies)
    .toLowerCase()
    .split(/[,/|;()\n\r\t ]+/)
    .map((t) => t.trim())
    .filter((t) => t && t.length >= 4)
    .slice(0, 20);
}

const getRecommendedProducts = async (req, res) => {
  try {

    console.log('RECOMMENDATIONS_ENABLED', process.env.RECOMMENDATIONS_ENABLED);
    console.log('req.query', req.query);
    if (String(process.env.RECOMMENDATIONS_ENABLED || '').toLowerCase() !== 'true') {
      return res.status(404).json({ success: false, message: 'Recommendations are disabled' });
    }

    const { petId } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
    const candidateLimit = Math.min(Math.max(Number(req.query.candidateLimit || 250), 50), 500);

    if (!petId) {
      return res.status(400).json({ success: false, message: 'petId is required' });
    }

    const pet = await Pet.findById(petId);
    if (!pet) return res.status(404).json({ success: false, message: 'Pet not found' });
    if (!isPetOwnerOrCoOwner(pet, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this pet' });
    }

    const cfg = getConfig();
    const petText = buildPetProfileText(pet);
    const petEmbedding = await getEmbedding(petText);

    const petType = pet.type || 'Dog';
    const petWeight = pet.weight != null ? Number(pet.weight) : null;
    const petAgeMonths = parseBirthdayToAgeMonths(pet.birthday);
    const petAgeGroup = pet.ageGroup || null;
    const allergyTokens = tokenizeAllergies(pet.allergies);

    const baseQuery = {
      'status.isActive': true,
      'status.approval.status': 'approved',
      'petDetails.targetPet': petType,
    };

    const candidates = await Product.find(baseQuery)
      .select('+ai.embedding name description tags petDetails safety business_data ratings status')
      .sort({ 'business_data.popularity_score': -1, createdAt: -1 })
      .limit(candidateLimit);

    const scored = [];

    for (const p of candidates) {
      const pd = p.petDetails || {};
      const age = pd.ageSuitability || {};
      const wt = pd.weightSuitability || {};

      if (petWeight != null) {
        if (wt.min != null && petWeight < Number(wt.min)) continue;
        if (wt.max != null && petWeight > Number(wt.max)) continue;
      }

      if (petAgeMonths != null) {
        if (age.min != null && petAgeMonths < Number(age.min)) continue;
        if (age.max != null && petAgeMonths > Number(age.max)) continue;
      } else if (petAgeGroup && Array.isArray(age.lifeStages) && age.lifeStages.length) {
        const mapped = petAgeGroup; // Puppy/Adult/Senior matches your Pet schema
        if (!age.lifeStages.includes('All Ages') && mapped && !age.lifeStages.includes(mapped)) continue;
      }

      if (allergyTokens.length) {
        const allergens = String((p.safety && p.safety.allergens) || '').toLowerCase();
        if (allergens) {
          const hit = allergyTokens.find((t) => allergens.includes(t));
          if (hit) continue;
        }
      }

      const emb = p.ai && p.ai.embedding;
      if (!Array.isArray(emb) || !emb.length) continue;

      const score = cosineSimilarity(petEmbedding, emb);
      if (score == null) continue;

      const why = [];
      why.push({ type: 'targetPet', value: petType });
      if (petAgeGroup) why.push({ type: 'ageGroup', value: petAgeGroup });
      if (petWeight != null) why.push({ type: 'weightKg', value: petWeight });
      why.push({ type: 'similarity', value: Number(score.toFixed(4)) });

      scored.push({ product: p, score, why, embeddingModel: cfg.model });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    res.status(200).json({
      success: true,
      petId,
      model: cfg.model,
      count: top.length,
      data: top.map((x) => ({
        product: x.product,
        score: x.score,
        why: x.why,
      })),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Error generating recommendations',
    });
  }
};

module.exports = {
  // Exported for tests — these decide whether an edit counts as a rate change.
  attemptsPricingChange,
  setsAnyPricing,
  addProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  updateProductApproval,
  deleteProduct,
  getProductsByCategory,
  searchProducts,
  quickSearch,
  getPopularSearches,
  getDashboardProducts,
  getProductsForReview,
  addProductReview,
  getRecommendedProducts
};