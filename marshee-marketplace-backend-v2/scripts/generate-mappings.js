/**
 * generate-mappings.js
 *
 * Comprehensive multi-strategy script to match missing product images
 * from Firebase Storage to MongoDB product records.
 *
 * Strategies (in order of priority):
 * 1. Exact SKU match in filename
 * 2. Short product name token match (≥80% word overlap)
 * 3. Key keyword match (brand + product type)
 * 4. Partial keyword (manual overrides for known patterns)
 *
 * Outputs: scripts/proposed_image_mappings.json
 *
 * Usage:
 *   node scripts/generate-mappings.js
 */

const admin = require('../config/firebaseAdmin');
const mongoose = require('mongoose');
const Product = require('../models/product.model');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const OUTPUT_PATH = path.join(__dirname, 'proposed_image_mappings.json');
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'petphoneapp-8e663.firebasestorage.app';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a tokenised, lowercase word-set from a string
 * (strips punctuation, numbers under 3 digits, and stop words).
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'to', 'with',
  'all', 'at', 'by', 'on', 'is', 'it', 'its', 'as', 'be', 'are',
  'was', 'were', 'do', 'does', 'my', 'your', 'our', 'their', 'from',
  'that', 'this', 'these', 'those', 'can', 'has', 'have', 'had',
  'up', 'out', 'not', 'no', 'but', 'if', 'so', 'may', 'based',
  'made', 'free', 'high', 'per', 'pack', 'ready', 'eat', 'real',
  'plus', 'size', 'set', 'new', 'use', 'used', 'safe', 'easy',
  'pet', 'pets', 'dog', 'dogs', 'cat', 'cats'           // too generic
]);

function tokenise(str) {
  return str
    .toLowerCase()
    .replace(/[_\-–—|/\\+&]/g, ' ')   // separators → space
    .replace(/[^a-z0-9 ]/g, '')        // drop punctuation
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function wordOverlap(tokensA, tokensB) {
  const setB = new Set(tokensB);
  const common = tokensA.filter(t => setB.has(t)).length;
  const denominator = Math.min(tokensA.length, tokensB.length);
  return denominator === 0 ? 0 : common / denominator;
}

/**
 * Build the public Firebase Storage download URL using the file's
 * stored download token (so images are accessible without authentication).
 */
async function buildPublicUrl(file) {
  const [metadata] = await file.getMetadata();
  const token = metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
  const encoded = encodeURIComponent(file.name);
  const baseUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encoded}?alt=media`;
  return token ? `${baseUrl}&token=${token}` : baseUrl;
}

// ─── Manual SKU → filename keyword overrides ────────────────────────────────
// Maps SKU → exact partial string that must appear in the storage file path.
// Tuned against the actual filenames found in Firebase Storage.
const SKU_KEYWORD_OVERRIDES = {
  // ── Taster packs ────────────────────────────────────────────────────────
  'TASTER-PACK-ADULT':                      'taster-pack-adult',
  'TASTER-PACK-PUPPY':                      'tasterpack_puppy',

  // ── Breeders Club / Ultimate Diet ───────────────────────────────────────
  'BREEDERS-CLUB-ENERGY-18KG':              'breeders',
  'BREEDERS-CLUB-PUPPY-18KG':              'breederspack',
  'BREEDERS-CLUB-ADULT-18KG':              'breeders-r4p',
  'BREEDERS-CLUB-NUTRITION-BOOSTER-12KG':  'breeders',
  'ULTIMATE-DIET-ENERGY-PLUS':             'energy+',
  'ULTIMATE-DIET-LG-GIANT-PUPPY':          'large-giant-puppy',
  'ULTIMATE-DIET-LG-GIANT-ADULT':          'large-giant',
  'ULTIMATE-DIET-MEDIUM-MAXI-ADULT':       'msxi-puppy',
  'ULTIMATE-DIET-MEDIUM-MAXI-PUPPY':       'msxi-puppy',
  'ULTIMATE-DIET-TOY-SMALL-ADULT':         'toy-small-adult',
  'ULTIMATE-DIET-TOY-SMALL-PUPPY':         'small-puppy',

  // ── Food toppers / Misc ──────────────────────────────────────────────────
  'HOME-FOOD-NUTRI-BOOST-ADULT':           'home-food',
  'YUM-BOOST-FOOD-TOPPER':                 'yum-',
  'MEAL-TOPPER-GRAVY':                     'meal-topper',

  // ── Probiotic range ──────────────────────────────────────────────────────
  'PROBIOTIC-SHAMPOO-BAR-SHORT-HAIR':      'shampoo_bar',
  'PROBIOTIC-SHAMPOO-LIQUID-LONG-HAIR':    'shampoo_bar',
  'PROBIOTIC-COAT-CLEANSER-200ML':         'cot-dog-cleaner',
  'PROBIOTIC-GROOMING-BUTTER-50G':         'grooming-butter',
  'PROBIOTIC-KENNEL-WASH-5KG':             'probiotivc_wash',
  'PROBIOTIC-FLOOR-CLEANER-1KG':           'floor_cleaner',

  // ── Treats / Chews ───────────────────────────────────────────────────────
  'CHICKEN-LIVER-TREATS':                  'chicken-liver',
  'CHICKEN-HEART-TREATS':                  'chickenheart',

  // ── Veg food range ───────────────────────────────────────────────────────
  'VEG-DOG-FOOD-3KG':                      'kibble',
  'VEG-ADULT-DOG-1KG':                     'kibble',
  'VEG-DOG-TREATS-PB':                     'organic-biscuit',
  'VEG-WET-DOG-MIXVEGGIE':                 'veggie-mix',
  'VEG-WET-DOG-PEAS':                      'peas',
  'VEG-WET-DOG-PUMPKIN':                   'pumpkin',
  'PFGWDF-MIXVEG':                         'mix-veggie',
  'PFGWDF02':                              'real-veggies',
  'PFG20240012':                           'pfg-vegfood',

  // ── MOE PUPPY range ──────────────────────────────────────────────────────
  'MOE-PUPPY-KERATIN-SHAMPOO':             'keratin_hairfall_shampoo_for_dogs_cats.png_nf79j6',
  'MOE-PUPPY-KERATIN-SHAMPOO-900ML':       'keratin_hairfall_shampoo_for_dogs_cats_5',
  'MOE-PUPPY-4IN1-CONDITIONER':            '4_in_1_conditioner',
  // NOTE: The following MOE PUPPY products have NO matching image in Firebase Storage.
  // MOE-PUPPY-XTRA-NOURISH-SHAMPOO, MOE-PUPPY-2IN1-SHAMPOO-CONDITIONER,
  // MOE-PUPPY-FOAM-SHAMPOO, MOE-PUPPY-RINSE-FREE, MOE-PUPPY-DENTAL-SPRAY,
  // MOE-PUPPY-EAR-CARE, MOE-PUPPY-ANTI-TICK, MOE-PUPPY-TICK-DEFENSE,
  // MOE-PUPPY-PAW-BALM (NOT same as Paw Cleaner!), MOE-PUPPY-MULTI-ACTION-DISINFECTANT,
  // MOE-PUPPY-DEODORIZER — all will appear in the noMatch list.

  // ── AyurPet ─────────────────────────────────────────────────────────────
  'AP-1-HYCC':                             'ayurpet-yak-cheese',
  'AP-2-GG':                               'goodgut+',
  'AP-3-HOJ':                              'hipojoint',

  // ── Basil products ───────────────────────────────────────────────────────
  'BASIL-COLLAGEN-SUPPLEMENT':             'basil-collagen',
  'B089558FY3':                            'basil-woody',
  'B09SYXKXRC':                            'basil-woody',
  'B09SYX36LM':                            'basil-woody',
  'B0DQ1NRD85':                            'mouth-spray',
  'B09RZV5SJP':                            'mouth-spray',
  'B098QZK46H':                            'lollipop',
  'B0DPWY528M':                            'lollipop',
  'B07TP8NHBM':                            'basil-shampoo',
  'B08955QSJG':                            'basil-shampoo',
  '014-500ML':                             'basil-shampoo',
  'B0B1WQ2RLX':                            'basil-shampoo',
  'B0DPX7C1N1':                            'basil-shampoo',
  'B07TSWZK7X':                            'basil-shampoo',
  'B0895252LN':                            'calcium-bone',
  'B0DRVX1BT6':                            'basil-calcium-milk',
  // B09WYBD4LD (Cat Teaser) and B0BFJ6322V (Conditioner) removed:
  // Basil-1.jpg is a generic Basil brand image and would be misleading for these.
  'B089525GMZ':                            'paw-clearner',
  'B0DVLTFCR2':                            'paw-clearner',
  'B0F9THH6DT':                            'p4g-veggie',
  'B0DVLTFCR3':                            'o\'pumpkin',

  // ── Veg by Paws for Greens ───────────────────────────────────────────────
  // (handled via fuzzy name tokens above)

  // ── Mini Paws / Liverlicious ─────────────────────────────────────────────
  // MP01, LPC80, LCC80 removed:
  //   MP01 (Mini Paws Chicken Wet Food) → p4g-veggie.jpg is wrong brand
  //   LPC80 (Liverlicious Pumpkin) → pumpkin-paws4greens.jpg is a different brand
  //   LCC80 (Liverlicious Carrot) → mix-veggie-ingre.jpg is wrong flavour
  //   These products have no matching image in Firebase Storage.
  'CK85':   'kibble',
  'FF85':   'kibble',
  'LM85':   'kibble',
  'GG85':   'kibble',

  // ── Airtag collars ────────────────────────────────────────────────────────
  // (no images found in storage — will remain unmatched)

  // ── Dog jackets / clothing (Pawroz brand in variants) ────────────────────
  'DJ001':    'pawroz',
  'PROD098':  'pawroz',
  'PROD099':  'pawrozcopy46',
  'PROD100':  'pawrozcopy',
  'PROD101':  'pawrozcopy7',
  'PROD102':  'pawrozcopy',

  // ── Treats (already in variants) ─────────────────────────────────────────
  'PROD103':  'chicken_sweetpotato',
  'PROD104':  'lambchops',
  'PROD105':  'carobbrowniebites',
  'PROD106':  'blueberrybliss',
  'PROD107':  'nutsforapples',
  // PROD108 (Neem & Apple Cider Shampoo) removed - oatmeal image is wrong product
  'PROD109':  'oatmeal_coconutreliefshampoo',

  // ── Leather Leashes (filename typo: 'latherleases' in storage) ─────────────
  'PROD110':  'webbingleashes',
  'PROD111':  'latherleases',        // note: typo in filename
  'PROD113':  'webbingleashes',
  'PROD114':  'latherleases',        // note: typo in filename

  // ── MOE Puppy specialized (foam / dental / tick etc.) ────────────────────
  // No matching images exist for these in Firebase Storage → left unmatched.
  // Foam Shampoo images (ShampooProduct1/2) are also removed as uncertain.

  // ── Wiggles / Phytonutrient Supplements ─────────────────────────────────
  // (no images found in storage — will remain unmatched)
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // 1. Connect to MongoDB
  console.log('Connecting to MongoDB...');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set in .env');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  // 2. Fetch all products that have no images
  console.log('Fetching products with missing images...');
  const products = await Product.find({
    $and: [
      {
        $or: [
          { 'defaultMedia.thumbnail.url': { $exists: false } },
          { 'defaultMedia.thumbnail.url': null },
          { 'defaultMedia.thumbnail.url': '' }
        ]
      },
      {
        $or: [
          { 'variants.media.images': { $size: 0 } },
          { 'variants.0.media.images.0': { $exists: false } },
          { 'variants.0.media.images.0': null }
        ]
      }
    ]
  }).select('_id name sku variants');

  console.log(`Found ${products.length} products missing images.\n`);

  // 3. List all files in Firebase Storage under products/
  console.log('Listing files in Firebase Storage (products/)...');
  const bucket = admin.storage().bucket(BUCKET_NAME);
  const [allFiles] = await bucket.getFiles({ prefix: 'products/' });

  // Filter out directory placeholders
  const files = allFiles.filter(f => !f.name.endsWith('/'));
  console.log(`Found ${files.length} files in storage.\n`);

  // Pre-compute tokens for every storage filename (basename only)
  const fileTokenMap = files.map(f => ({
    file: f,
    basename: f.name.substring(f.name.lastIndexOf('/') + 1).toLowerCase(),
    tokens: tokenise(f.name)
  }));

  // 4. Match each product to the best-fit storage file(s)
  const mappings = [];
  const noMatch = [];

  for (const product of products) {
    const sku = (product.sku || '').toUpperCase().trim();
    const skuLower = sku.toLowerCase();
    const nameTokens = tokenise(product.name);
    const override = SKU_KEYWORD_OVERRIDES[sku];

    let candidates = [];

    for (const entry of fileTokenMap) {
      let score = 0;
      let method = '';

      // Strategy 1: Exact SKU in filename
      if (skuLower && entry.basename.includes(skuLower)) {
        score = 100;
        method = 'SKU-exact';
      }

      // Strategy 2: Manual override keyword in file path
      else if (override && entry.file.name.toLowerCase().includes(override)) {
        score = 85;
        method = 'SKU-override';
      }

      // Strategy 3: High token overlap with product name
      else {
        const overlap = wordOverlap(nameTokens, entry.tokens);
        if (overlap >= 0.65) {
          score = Math.round(overlap * 100);
          method = 'name-fuzzy';
        }
      }

      if (score > 0) {
        candidates.push({ ...entry, score, method });
      }
    }

    // Sort candidates: highest score first, then prefer top-level products/ over variants/
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aIsVariant = a.file.name.includes('/variants/') ? 1 : 0;
      const bIsVariant = b.file.name.includes('/variants/') ? 1 : 0;
      return aIsVariant - bIsVariant;
    });

    // Take top 8 candidates for review
    const top = candidates.slice(0, 8);

    if (top.length === 0) {
      noMatch.push({ id: product._id, name: product.name, sku: product.sku });
      continue;
    }

    // Build public URLs for the top candidates
    const topWithUrls = await Promise.all(top.map(async c => {
      const url = await buildPublicUrl(c.file);
      return {
        path: c.file.name,
        url,
        score: c.score,
        method: c.method
      };
    }));

    mappings.push({
      productId: product._id,
      productName: product.name,
      sku: product.sku,
      // The first result is what we will apply; others are for human review
      proposedImage: topWithUrls[0].url,
      proposedPath: topWithUrls[0].path,
      confidence: topWithUrls[0].score,
      method: topWithUrls[0].method,
      alternatives: topWithUrls.slice(1)
    });
  }

  // 5. Save results
  const output = {
    generatedAt: new Date().toISOString(),
    totalProducts: products.length,
    matched: mappings.length,
    unmatched: noMatch.length,
    mappings,
    noMatch
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log('─────────────────────────────────────────────');
  console.log(`Total products:  ${products.length}`);
  console.log(`Matched:         ${mappings.length}`);
  console.log(`No match found:  ${noMatch.length}`);
  console.log(`\nOutput saved to: ${OUTPUT_PATH}`);

  if (noMatch.length > 0) {
    console.log('\nProducts with NO match in storage:');
    noMatch.forEach(p => console.log(`  - [${p.sku}] ${p.name}`));
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
