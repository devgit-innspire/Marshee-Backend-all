/**
 * apply-mappings.js
 *
 * Reads proposed_image_mappings.json and applies the mappings to MongoDB.
 *
 * Safety rules:
 *  - NEVER overwrites a variant that already has images (unless --force is passed)
 *  - Only updates variants where media.images is empty / missing
 *  - Sets defaultMedia.thumbnail.url if not already set
 *  - Dry-run mode by default; pass --apply to actually write
 *
 * Usage:
 *   node scripts/apply-mappings.js            # dry-run (no writes)
 *   node scripts/apply-mappings.js --apply    # write to MongoDB
 *   node scripts/apply-mappings.js --apply --force  # overwrite even if images exist
 */

const mongoose = require('mongoose');
const Product = require('../models/product.model');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ─── Flags ────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--apply');
const FORCE   = process.argv.includes('--force');

const MAPPINGS_PATH = path.join(__dirname, 'proposed_image_mappings.json');
const REPORT_PATH   = path.join(__dirname, 'apply_mappings_report.json');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  if (DRY_RUN) {
    console.log('🔵 DRY-RUN mode — no writes to MongoDB');
    console.log('   Pass --apply to commit changes.\n');
  } else {
    console.log('🟠 APPLY mode — writing to production MongoDB');
    if (FORCE) console.log('   --force is set — existing variant images WILL be overwritten\n');
  }

  // 1. Load mappings
  if (!fs.existsSync(MAPPINGS_PATH)) {
    throw new Error(`Mappings file not found: ${MAPPINGS_PATH}\nRun generate-mappings.js first.`);
  }
  const { mappings } = JSON.parse(fs.readFileSync(MAPPINGS_PATH, 'utf-8'));
  console.log(`Loaded ${mappings.length} proposed mappings.\n`);

  // 2. Connect
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  // 3. Apply
  const results = {
    updated:  [],
    skipped:  [],
    notFound: [],
    errors:   []
  };

  for (const mapping of mappings) {
    const { productId, productName, sku, proposedImage, proposedPath, confidence, method } = mapping;

    let product;
    try {
      product = await Product.findById(productId);
    } catch (err) {
      results.errors.push({ productId, productName, reason: err.message });
      continue;
    }

    if (!product) {
      results.notFound.push({ productId, productName, sku });
      console.warn(`  ⚠️  Not found: ${productName} (${productId})`);
      continue;
    }

    // Re-check image state in DB (safer than trusting query results)
    const allVariantsHaveImages = product.variants.every(
      v => v.media && v.media.images && v.media.images.length > 0
    );

    const hasDefaultThumbnail = (
      product.defaultMedia &&
      product.defaultMedia.thumbnail &&
      product.defaultMedia.thumbnail.url
    );

    if (allVariantsHaveImages && !FORCE) {
      results.skipped.push({
        productId,
        productName,
        sku,
        reason: 'already has images in all variants (safe skip)'
      });
      console.log(`  ⏭️  SKIP  [${sku}] ${productName.substring(0, 60)}`);
      continue;
    }

    // Build update operations
    const updates = {};

    // Update each variant that is missing images
    let variantUpdated = false;
    for (let i = 0; i < product.variants.length; i++) {
      const v = product.variants[i];
      const hasImages = v.media && v.media.images && v.media.images.length > 0;
      if (!hasImages || FORCE) {
        updates[`variants.${i}.media.images`] = [proposedImage];
        variantUpdated = true;
      }
    }

    // Update defaultMedia.thumbnail.url if missing
    if (!hasDefaultThumbnail || FORCE) {
      updates['defaultMedia.thumbnail.url'] = proposedImage;
      updates['defaultMedia.thumbnail.path'] = proposedPath;
    }

    if (!variantUpdated && !updates['defaultMedia.thumbnail.url']) {
      results.skipped.push({
        productId,
        productName,
        sku,
        reason: 'nothing to update (all variants have images, thumbnail present)'
      });
      console.log(`  ⏭️  SKIP  [${sku}] ${productName.substring(0, 60)}`);
      continue;
    }

    if (!DRY_RUN) {
      try {
        await Product.updateOne({ _id: productId }, { $set: updates });
      } catch (err) {
        results.errors.push({ productId, productName, reason: err.message });
        console.error(`  ❌  ERROR [${sku}] ${err.message}`);
        continue;
      }
    }

    results.updated.push({
      productId,
      productName,
      sku,
      imageUrl: proposedImage,
      imagePath: proposedPath,
      confidence,
      method,
      dryRun: DRY_RUN,
      fieldsUpdated: Object.keys(updates)
    });

    console.log(`  ✅  ${DRY_RUN ? 'WOULD UPDATE' : 'UPDATED'}  [${sku}] ${productName.substring(0, 60)}`);
    console.log(`       → ${proposedPath} (score: ${confidence}, method: ${method})`);
  }

  // 4. Summary
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Total mappings:  ${mappings.length}`);
  console.log(`  ✅ Updated:      ${results.updated.length}`);
  console.log(`  ⏭️  Skipped:      ${results.skipped.length}`);
  console.log(`  ⚠️  Not found:    ${results.notFound.length}`);
  console.log(`  ❌ Errors:       ${results.errors.length}`);
  if (DRY_RUN) {
    console.log('\n  ⚡ This was a DRY RUN. Run with --apply to commit.\n');
  } else {
    console.log('\n  ✅ Changes committed to MongoDB.\n');
  }
  console.log(`  Report saved to: ${REPORT_PATH}`);

  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    runAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    force: FORCE,
    summary: {
      total: mappings.length,
      updated: results.updated.length,
      skipped: results.skipped.length,
      notFound: results.notFound.length,
      errors: results.errors.length
    },
    ...results
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
