#!/usr/bin/env node
/**
 * Batch Embedding Generation Script
 * 
 * Generates CLIP and color embeddings for all images in the cache
 * that don't already have embeddings.
 * 
 * Usage:
 *   npm run embeddings:generate
 *   npm run embeddings:generate -- --clip-only
 *   npm run embeddings:generate -- --color-only
 *   npm run embeddings:generate -- --limit 100
 *   npm run embeddings:generate -- --force
 */

import 'dotenv/config';

// Check environment
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  console.error('❌ Missing required environment variables:');
  console.error('   CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

if (!NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH) {
  console.error('❌ Missing NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH');
  process.exit(1);
}

// Parse arguments
const args = process.argv.slice(2);
const clipOnly = args.includes('--clip-only');
const colorOnly = args.includes('--color-only');
const force = args.includes('--force');
const limitArg = args.findIndex(a => a === '--limit');
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1]) : undefined;

console.log('\n╔════════════════════════════════════════╗');
console.log('║      Photarium Embedding Generator      ║');
console.log('╚════════════════════════════════════════╝\n');

async function main() {
  // Dynamic imports for ES modules
  const { getCachedImages, upsertCachedImage } = await import('../src/server/cloudflareImageCache.js');
  const { generateClipEmbedding } = await import('../src/server/embeddingService.js');
  const { extractColorsFromUrl } = await import('../src/server/colorExtraction.js');
  const { 
    ensureVectorIndex, 
    storeImageVectors,
    isVectorSearchAvailable 
  } = await import('../src/server/vectorSearch.js');

  // Check Redis is available
  console.log('→ Checking Redis connection...');
  const available = await isVectorSearchAvailable();
  if (!available) {
    console.error('❌ Redis Stack not available');
    console.error('   Run: npm run redis:start');
    process.exit(1);
  }
  console.log('✔ Redis Stack connected\n');

  // Ensure vector index exists
  console.log('→ Ensuring vector index exists...');
  await ensureVectorIndex();
  console.log('✔ Vector index ready\n');

  // Get all images
  console.log('→ Loading image cache...');
  const images = await getCachedImages();
  console.log(`✔ Found ${images.length} images\n`);

  // Filter to images needing embeddings
  let toProcess = images;
  
  if (!force) {
    if (clipOnly) {
      toProcess = images.filter(img => !img.hasClipEmbedding);
    } else if (colorOnly) {
      toProcess = images.filter(img => !img.hasColorEmbedding);
    } else {
      toProcess = images.filter(img => !img.hasClipEmbedding || !img.hasColorEmbedding);
    }
  }

  if (limit) {
    toProcess = toProcess.slice(0, limit);
  }

  if (toProcess.length === 0) {
    console.log('✔ All images already have embeddings!\n');
    console.log('  Use --force to regenerate all embeddings\n');
    process.exit(0);
  }

  console.log(`→ Processing ${toProcess.length} images...\n`);
  
  const generateClip = !colorOnly;
  const generateColor = !clipOnly;
  
  console.log(`  CLIP embeddings: ${generateClip ? '✔' : '✖'}`);
  console.log(`  Color embeddings: ${generateColor ? '✔' : '✖'}\n`);

  let successClip = 0;
  let successColor = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const image = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;
    
    // Get image URL (use w=300 variant for efficiency)
    const variant = image.variants.find(v => v.includes('w=300')) || image.variants[0];
    const imageUrl = `${variant}?format=webp`;

    process.stdout.write(`${progress} ${image.id.substring(0, 8)}... `);

    try {
      let clipEmbedding = null;
      let colorInfo = null;

      // Generate CLIP embedding
      if (generateClip && (force || !image.hasClipEmbedding)) {
        clipEmbedding = await generateClipEmbedding(imageUrl);
        if (clipEmbedding) {
          successClip++;
        }
      }

      // Generate color embedding
      if (generateColor && (force || !image.hasColorEmbedding)) {
        colorInfo = await extractColorsFromUrl(imageUrl);
        if (colorInfo) {
          successColor++;
        }
      }

      // Store in Redis
      if (clipEmbedding || colorInfo) {
        await storeImageVectors({
          imageId: image.id,
          filename: image.filename,
          folder: image.folder,
          clipEmbedding: clipEmbedding ?? undefined,
          colorHistogram: colorInfo?.histogram,
          dominantColors: colorInfo?.dominantColors,
          averageColor: colorInfo?.averageColor,
        });

        // Update cache flags
        await upsertCachedImage({
          ...image,
          hasClipEmbedding: clipEmbedding ? true : image.hasClipEmbedding,
          hasColorEmbedding: colorInfo ? true : image.hasColorEmbedding,
          dominantColors: colorInfo?.dominantColors ?? image.dominantColors,
          averageColor: colorInfo?.averageColor ?? image.averageColor,
        });
      }

      console.log('✔');
    } catch (error) {
      failed++;
      console.log('✖', error instanceof Error ? error.message : 'Unknown error');
    }

    // Small delay to avoid rate limiting
    if (i < toProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log('                Results                  ');
  console.log('════════════════════════════════════════\n');
  
  if (generateClip) {
    console.log(`  CLIP embeddings generated: ${successClip}`);
  }
  if (generateColor) {
    console.log(`  Color embeddings generated: ${successColor}`);
  }
  console.log(`  Failed: ${failed}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
