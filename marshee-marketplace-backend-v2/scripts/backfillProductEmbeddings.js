require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db.config');
const Product = require('../models/product.model');

const { getEmbedding, getConfig, buildSourceHash } = require('../utils/ai/embeddings');
const { buildProductProfileText } = require('../utils/ai/textBuilders');

async function main() {
  const cfg = getConfig();
  console.log('[ai] embeddings provider:', cfg.provider, 'model:', cfg.model);

  await connectDB();

  const query = {
    'status.isActive': true,
    'status.approval.status': 'approved',
  };

  const cursor = Product.find(query).cursor();

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for await (const product of cursor) {
    processed++;
    try {
      const text = buildProductProfileText(product);
      const sourceHash = buildSourceHash({ text });

      if (product.ai?.embeddingSourceHash && product.ai.embeddingSourceHash === sourceHash) {
        skipped++;
        continue;
      }

      const embedding = await getEmbedding(text);

      await Product.updateOne(
        { _id: product._id },
        {
          $set: {
            'ai.embedding': embedding,
            'ai.embeddingModel': cfg.model,
            'ai.embeddingUpdatedAt': new Date(),
            'ai.embeddingSourceHash': sourceHash,
          },
        }
      );

      updated++;
      if (updated % 25 === 0) {
        console.log(`[ai] updated ${updated} (processed ${processed}, skipped ${skipped}, failed ${failed})`);
      }
    } catch (e) {
      failed++;
      console.error('[ai] failed product', product._id?.toString?.() || product._id, e?.message || e);
    }
  }

  console.log('[ai] done', { processed, updated, skipped, failed });
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('[ai] fatal', e?.message || e);
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(1);
});

