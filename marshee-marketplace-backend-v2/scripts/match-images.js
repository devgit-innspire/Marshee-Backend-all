const fs = require('fs');
const path = require('path');

const emptyImagesPath = '/Users/architmittal/.gemini/antigravity-ide/brain/d8e06496-8d50-4036-b90c-d28a8dac56ae/raw_empty_images.json';
const storageListPath = path.join(__dirname, '../scripts/storage_products_list.json');

// Read empty images
const emptyContent = fs.readFileSync(emptyImagesPath, 'utf8');
const jsonStartIndex = emptyContent.indexOf('[');
const jsonEndIndex = emptyContent.lastIndexOf(']') + 1;
const jsonStr = emptyContent.substring(jsonStartIndex, jsonEndIndex);
const missingProducts = JSON.parse(jsonStr);

// Read storage files
const storageFiles = JSON.parse(fs.readFileSync(storageListPath, 'utf8'));

console.log(`Loaded ${missingProducts.length} missing-image products.`);
console.log(`Loaded ${storageFiles.length} files from Firebase Storage.`);

function cleanString(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

const matches = [];
const noMatches = [];

for (const product of missingProducts) {
  const pName = product.name;
  const pSku = product.sku ? product.sku.toLowerCase().trim() : '';
  const cleanName = cleanString(pName);
  const nameWords = cleanName.split(' ').filter(w => w.length > 2); // only words with length > 2

  let productMatches = [];

  for (const file of storageFiles) {
    const filename = file.name.substring(9).toLowerCase(); // strip 'products/' prefix
    const cleanFilename = filename.replace(/[^a-z0-9]/g, ' ');

    // 1. Direct match by SKU
    if (pSku && filename.includes(pSku)) {
      productMatches.push({ file: file.name, score: 100, method: 'SKU' });
      continue;
    }

    // 2. Fuzzy name match - check how many words match
    let matchCount = 0;
    for (const word of nameWords) {
      if (cleanFilename.includes(word)) {
        matchCount++;
      }
    }

    if (nameWords.length > 0) {
      const matchRatio = matchCount / nameWords.length;
      // If a high percentage of words match, count as match
      if (matchRatio >= 0.5) {
        productMatches.push({ 
          file: file.name, 
          score: Math.round(matchRatio * 100), 
          method: 'Fuzzy Name' 
        });
      }
    }
  }

  // Sort matches by score descending
  productMatches.sort((a, b) => b.score - a.score);

  if (productMatches.length > 0) {
    matches.push({
      productId: product.id,
      productName: pName,
      sku: product.sku,
      bestMatch: productMatches[0].file,
      matchMethod: productMatches[0].method,
      matchScore: productMatches[0].score,
      allMatches: productMatches.slice(0, 5).map(m => `${m.file} (${m.score}%)`)
    });
  } else {
    noMatches.push(product);
  }
}

console.log(`\nFuzzy matching results:`);
console.log(`Matched: ${matches.length} products`);
console.log(`Unmatched: ${noMatches.length} products`);

const resultsPath = path.join(__dirname, '../scripts/matching_results.json');
fs.writeFileSync(resultsPath, JSON.stringify({ matches, noMatches }, null, 2));
console.log(`Saved results to ${resultsPath}`);

// Let's print out the first 15 matches to inspect
console.log('\nSample Matches (First 15):');
matches.slice(0, 15).forEach((m, idx) => {
  console.log(`${idx + 1}. Product: ${m.productName}`);
  console.log(`   SKU: ${m.sku}`);
  console.log(`   Matched to: ${m.bestMatch} (${m.matchMethod} - ${m.matchScore}%)`);
});
