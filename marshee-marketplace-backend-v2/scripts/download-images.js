const fs = require('fs');
const path = require('path');

const CLOUDINARY_DOMAIN = 'dqqljirqe';
const API_URL = 'https://marshee-marketplace-backend-v2-905729647257.asia-southeast1.run.app/api/v1/products?limit=1000';
const DOWNLOAD_DIR = path.join(__dirname, '../migrated_images');

async function downloadImages() {
  try {
    // Create download directory if it doesn't exist
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    console.log('Fetching products from Marshee API...');
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.statusText}`);
    }

    const json = await response.json();
    const products = json.data || [];
    console.log(`Fetched ${products.length} products total.`);

    // Find products containing the cloudinary domain
    const targetProducts = [];

    for (const product of products) {
      const urls = [];
      
      if (product.defaultMedia?.thumbnail?.url?.includes(CLOUDINARY_DOMAIN)) {
        urls.push({ type: 'thumbnail', url: product.defaultMedia.thumbnail.url });
      }

      if (product.variants) {
        product.variants.forEach((variant, vIdx) => {
          if (variant.media && variant.media.images) {
            variant.media.images.forEach((imgUrl, iIdx) => {
              if (imgUrl && imgUrl.includes(CLOUDINARY_DOMAIN)) {
                urls.push({ type: `variant_${vIdx}_img_${iIdx}`, url: imgUrl });
              }
            });
          }
        });
      }

      if (urls.length > 0) {
        targetProducts.push({
          id: product._id,
          name: product.name,
          urls
        });
      }
    }

    console.log(`Found ${targetProducts.length} products using the ${CLOUDINARY_DOMAIN} account.`);

    for (const product of targetProducts) {
      console.log(`\nProcessing: ${product.name}`);
      const cleanProductName = product.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);

      for (const item of product.urls) {
        try {
          const extension = item.url.split('.').pop().split('?')[0] || 'webp';
          const filename = `${cleanProductName}_${item.type}.${extension}`;
          const filepath = path.join(DOWNLOAD_DIR, filename);

          console.log(`  Downloading ${item.type} from: ${item.url}`);
          const fileResponse = await fetch(item.url);
          if (!fileResponse.ok) {
            throw new Error(`Failed to download: ${fileResponse.statusText}`);
          }

          const arrayBuffer = await fileResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          fs.writeFileSync(filepath, buffer);
          console.log(`  ✔ Saved to: ${filepath}`);
        } catch (err) {
          console.error(`  ❌ Error downloading ${item.type} for ${product.name}:`, err.message);
        }
      }
    }

    console.log(`\nDownload complete! Images are saved in: ${DOWNLOAD_DIR}`);
  } catch (error) {
    console.error('Failed to run downloader:', error);
  }
}

downloadImages();
