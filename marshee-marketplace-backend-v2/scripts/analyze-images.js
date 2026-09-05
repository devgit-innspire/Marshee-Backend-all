const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Run this script from the marshee-marketplace-backend-v2-main directory
require('dotenv').config();

const Product = require('../models/product.model');
const storageListPath = path.join(__dirname, 'storage_products_list.json');

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'to', 'with',
  'all', 'at', 'by', 'on', 'is', 'it', 'its', 'as', 'be', 'are',
  'was', 'were', 'do', 'does', 'my', 'your', 'our', 'their', 'from',
  'that', 'this', 'these', 'those', 'can', 'has', 'have', 'had',
  'up', 'out', 'not', 'no', 'but', 'if', 'so', 'may', 'based',
  'made', 'free', 'high', 'per', 'pack', 'ready', 'eat', 'real',
  'plus', 'size', 'set', 'new', 'use', 'used', 'safe', 'easy',
  'pet', 'pets', 'dog', 'dogs', 'cat', 'cats'
]);

function tokenise(str) {
  if (!str) return [];
  return str
    .toLowerCase()
    .replace(/[_\-–—|/\\+&]/g, ' ')   // separators → space
    .replace(/[^a-z0-9 ]/g, '')        // drop punctuation
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function wordOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  const common = tokensA.filter(t => setB.has(t)).length;
  const denominator = Math.min(tokensA.length, tokensB.length);
  return denominator === 0 ? 0 : common / denominator;
}

function getFilename(urlOrPath) {
  if (!urlOrPath) return '';
  // Handle firebase storage URLs
  let url = urlOrPath;
  if (url.includes('?')) {
    url = url.split('?')[0];
  }
  const decoded = decodeURIComponent(url);
  const parts = decoded.split('/');
  return parts[parts.length - 1];
}

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // 1. Load Firebase Storage files
    if (!fs.existsSync(storageListPath)) {
      throw new Error(`Storage file list not found at: ${storageListPath}`);
    }
    const storageFiles = JSON.parse(fs.readFileSync(storageListPath, 'utf8'));
    console.log(`Loaded ${storageFiles.length} storage files.`);

    // Pre-tokenize storage files
    const fileTokenMap = storageFiles.map(f => {
      const filename = f.name.substring(f.name.lastIndexOf('/') + 1).toLowerCase();
      return {
        path: f.name,
        filename,
        tokens: tokenise(filename)
      };
    });

    // 2. Fetch all products
    const products = await Product.find({}).select('id name sku defaultMedia');
    console.log(`Fetched ${products.length} products from DB.`);

    // 3. Group products by image URL
    const imageGroups = {};
    for (const p of products) {
      const imgUrl = p.defaultMedia && p.defaultMedia.thumbnail && p.defaultMedia.thumbnail.url;
      if (!imgUrl) continue;
      
      const filename = getFilename(imgUrl);
      if (!imageGroups[imgUrl]) {
        imageGroups[imgUrl] = {
          url: imgUrl,
          filename,
          products: []
        };
      }
      imageGroups[imgUrl].products.push({
        id: p._id.toString(),
        name: p.name,
        sku: p.sku || 'No SKU'
      });
    }

    // 4. Find duplicates (groups with > 1 product)
    const duplicateGroups = Object.values(imageGroups).filter(g => g.products.length > 1);
    console.log(`Found ${duplicateGroups.length} duplicate image groups (images used by multiple products).`);

    const report = {
      summary: {
        totalProductsAnalyzed: products.length,
        duplicateImageGroupsCount: duplicateGroups.length,
        incorrectlyMatchedProducts: 0,
        correctImageAvailableCount: 0,
        correctImageMissingCount: 0
      },
      duplicates: []
    };

    for (const group of duplicateGroups) {
      const groupData = {
        imageUrl: group.url,
        filename: group.filename,
        products: []
      };

      console.log(`\nGroup Image: ${group.filename} (used by ${group.products.length} products)`);

      for (const p of group.products) {
        // Evaluate if this image is CORRECT for this product
        const skuLower = p.sku.toLowerCase();
        const filenameLower = group.filename.toLowerCase();
        const pNameTokens = tokenise(p.name);
        const imgTokens = tokenise(group.filename);

        // Check matching methods
        const isSkuMatch = skuLower && filenameLower.includes(skuLower);
        const nameOverlap = wordOverlap(pNameTokens, imgTokens);
        const isNameMatch = nameOverlap >= 0.5;

        const isCorrect = isSkuMatch || isNameMatch;

        let status = 'INCORRECT';
        if (isCorrect) {
          status = 'CORRECT';
        }

        // If it's incorrect, check if the real image is available in Firebase Storage
        let searchResults = [];
        if (!isCorrect) {
          report.summary.incorrectlyMatchedProducts++;
          
          // Search storageFiles for this product's actual image
          for (const file of fileTokenMap) {
            let score = 0;
            let method = '';

            // SKU match
            if (skuLower && file.filename.includes(skuLower)) {
              score = 100;
              method = 'SKU';
            } 
            // Name match
            else {
              const overlap = wordOverlap(pNameTokens, file.tokens);
              if (overlap >= 0.5) {
                score = Math.round(overlap * 100);
                method = 'Fuzzy Name';
              }
            }

            if (score > 0) {
              searchResults.push({
                path: file.path,
                filename: file.filename,
                score,
                method
              });
            }
          }

          // Sort by score descending
          searchResults.sort((a, b) => b.score - a.score);
        }

        const hasRealImageAvailable = searchResults.length > 0;
        if (!isCorrect) {
          if (hasRealImageAvailable) {
            report.summary.correctImageAvailableCount++;
          } else {
            report.summary.correctImageMissingCount++;
          }
        }

        groupData.products.push({
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          matchStatus: status,
          matchDetails: {
            isSkuMatch,
            nameOverlapRatio: nameOverlap
          },
          realImageInStorage: hasRealImageAvailable ? {
            found: true,
            bestCandidate: searchResults[0].path,
            candidateScore: searchResults[0].score,
            candidateMethod: searchResults[0].method,
            allCandidates: searchResults.slice(0, 3).map(c => `${c.path} (${c.score}% via ${c.method})`)
          } : {
            found: false
          }
        });

        console.log(`  - [${p.sku}] ${p.name.substring(0, 50)}... -> Status: ${status}`);
        if (!isCorrect && hasRealImageAvailable) {
          console.log(`    ↳ Real image available: ${searchResults[0].path} (${searchResults[0].score}%)`);
        } else if (!isCorrect) {
          console.log(`    ↳ Real image missing from storage.`);
        }
      }

      report.duplicates.push(groupData);
    }

    // Write report
    const outputPath = path.join(__dirname, 'image_analysis_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\nAnalysis complete. Report written to ${outputPath}`);
    console.log('\nSummary:');
    console.log(`  Incorrectly matched products: ${report.summary.incorrectlyMatchedProducts}`);
    console.log(`  Correct image available in storage: ${report.summary.correctImageAvailableCount}`);
    console.log(`  Correct image missing from storage: ${report.summary.correctImageMissingCount}`);

  } catch (err) {
    console.error('Error running analysis:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();
