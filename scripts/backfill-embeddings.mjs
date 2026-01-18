#!/usr/bin/env node

/**
 * Backfill Embeddings Script
 * 
 * Generates CLIP and color embeddings for images that don't have them yet.
 * This is a long-running process - expect ~5-10 seconds per image with local CLIP.
 * 
 * BEHAVIOR:
 *   - By default, generates BOTH CLIP and color embeddings
 *   - SKIPS images that already have the requested embedding type(s)
 *   - Use --force to regenerate even if embeddings exist
 *   - Processes images sequentially to avoid overwhelming the embedding service
 * 
 * Usage:
 *   node scripts/backfill-embeddings.mjs [options]
 * 
 * Options:
 *   --namespace=<ns>  Only process images in this namespace (default: all)
 *   --limit=<n>       Maximum images to process (default: unlimited)
 *   --batch=<n>       Batch size before pause (default: 10)
 *   --delay=<ms>      Delay between batches in ms (default: 1000)
 *   --clip-only       Only generate CLIP embeddings (skip color)
 *   --color-only      Only generate color embeddings (skip CLIP)
 *   --dry-run         Show what would be processed without doing it
 *   --force           Regenerate even if embedding already exists
 *   -v, --verbose     Show detailed progress info
 *   -vv               Show request/response details
 *   -vvv              Show full API responses
 *   -vvvv             Maximum verbosity (debug level)
 * 
 * Examples:
 *   # Process all images in cf-default namespace
 *   node scripts/backfill-embeddings.mjs --namespace=cf-default
 * 
 *   # Process 50 images with verbose output
 *   node scripts/backfill-embeddings.mjs --limit=50 -vv
 * 
 *   # Dry run to see what would be processed
 *   node scripts/backfill-embeddings.mjs --namespace=cf-default --dry-run
 * 
 *   # Force regenerate CLIP only for first 10 images
 *   node scripts/backfill-embeddings.mjs --clip-only --force --limit=10
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  namespace: null,
  limit: Infinity,
  batch: 10,
  delay: 1000,
  clipOnly: false,
  colorOnly: false,
  dryRun: false,
  force: false,
  verbose: 0,  // 0=normal, 1=verbose, 2=very verbose, 3=debug, 4=trace
};

for (const arg of args) {
  if (arg.startsWith('--namespace=')) {
    options.namespace = arg.split('=')[1];
  } else if (arg.startsWith('--limit=')) {
    options.limit = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--batch=')) {
    options.batch = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--delay=')) {
    options.delay = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--clip-only') {
    options.clipOnly = true;
  } else if (arg === '--color-only') {
    options.colorOnly = true;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--force') {
    options.force = true;
  } else if (arg === '-vvvv') {
    options.verbose = 4;
  } else if (arg === '-vvv') {
    options.verbose = 3;
  } else if (arg === '-vv') {
    options.verbose = 2;
  } else if (arg === '-v' || arg === '--verbose') {
    options.verbose = Math.max(options.verbose, 1);
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Backfill Embeddings Script

Generates CLIP and color embeddings for images that don't have them yet.

BEHAVIOR:
  - By default, generates BOTH CLIP and color embeddings
  - SKIPS images that already have the requested embedding type(s)
  - Use --force to regenerate even if embeddings exist
  - Processes images sequentially to avoid overwhelming the embedding service

Usage:
  node scripts/backfill-embeddings.mjs [options]

Options:
  --namespace=<ns>  Only process images in this namespace (default: all)
  --limit=<n>       Maximum images to process (default: unlimited)
  --batch=<n>       Batch size before pause (default: 10)
  --delay=<ms>      Delay between batches in ms (default: 1000)
  --clip-only       Only generate CLIP embeddings (skip color)
  --color-only      Only generate color embeddings (skip CLIP)
  --dry-run         Show what would be processed without doing it
  --force           Regenerate even if embedding already exists
  -v, --verbose     Show detailed progress info
  -vv               Show request/response details  
  -vvv              Show full API responses
  -vvvv             Maximum verbosity (debug level)

Examples:
  # Process all images in cf-default namespace
  node scripts/backfill-embeddings.mjs --namespace=cf-default

  # Process 50 images with verbose output
  node scripts/backfill-embeddings.mjs --limit=50 -vv

  # Dry run to see what would be processed
  node scripts/backfill-embeddings.mjs --namespace=cf-default --dry-run

  # Force regenerate CLIP only for first 10 images  
  node scripts/backfill-embeddings.mjs --clip-only --force --limit=10
`);
    process.exit(0);
  }
}

// ANSI color helpers for terminal output
const hexToRgb = (hex) => {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
};

const colorBlock = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '??';
  // Use 24-bit true color ANSI escape: \x1b[48;2;R;G;Bm for background
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  \x1b[0m`;
};

const colorBlocksRow = (hexColors) => {
  if (!hexColors || !Array.isArray(hexColors) || hexColors.length === 0) return '';
  return hexColors.map(colorBlock).join('');
};

// Logging helpers
const log = {
  info: (...args) => console.log(...args),
  verbose: (...args) => options.verbose >= 1 && console.log('[VERBOSE]', ...args),
  debug: (...args) => options.verbose >= 2 && console.log('[DEBUG]', ...args),
  trace: (...args) => options.verbose >= 3 && console.log('[TRACE]', ...args),
  dump: (...args) => options.verbose >= 4 && console.log('[DUMP]', ...args),
};

const generateClip = !options.colorOnly;
const generateColor = !options.clipOnly;

async function fetchImages() {
  const params = new URLSearchParams({ refresh: '1' });
  if (options.namespace) {
    params.set('namespace', options.namespace);
  }
  
  const url = `${API_BASE}/api/images?${params}`;
  log.info(`Fetching images from ${url}...`);
  log.debug(`Request params: refresh=1, namespace=${options.namespace || '(all)'}`);
  
  const startTime = Date.now();
  const response = await fetch(url);
  const elapsed = Date.now() - startTime;
  
  log.debug(`Response status: ${response.status} (${elapsed}ms)`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch images: ${response.status}`);
  }
  
  const data = await response.json();
  log.trace(`Response contains ${data.images?.length || 0} images`);
  log.dump('Full response:', JSON.stringify(data).slice(0, 500) + '...');
  
  return data.images || [];
}

function needsEmbedding(image) {
  if (options.force) {
    log.trace(`  [${image.id}] Force mode - will process`);
    return true;
  }
  
  const needsClip = generateClip && !image.hasClipEmbedding;
  const needsColor = generateColor && !image.hasColorEmbedding;
  const needs = needsClip || needsColor;
  
  if (options.verbose >= 3) {
    log.trace(`  [${image.id}] hasClip=${image.hasClipEmbedding}, hasColor=${image.hasColorEmbedding}`);
    log.trace(`  [${image.id}] needsClip=${needsClip}, needsColor=${needsColor} => ${needs ? 'PROCESS' : 'SKIP'}`);
  }
  
  return needs;
}

async function generateEmbeddings(imageId, _filename) {
  const url = `${API_BASE}/api/images/${imageId}/embeddings`;
  const body = {
    clip: generateClip,
    color: generateColor,
    force: options.force,
  };
  
  log.debug(`POST ${url}`);
  log.trace(`Request body: ${JSON.stringify(body)}`);
  
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - startTime;
  
  const data = await response.json();
  
  log.debug(`Response: ${response.status} (${elapsed}ms)`);
  log.trace(`Response body: ${JSON.stringify(data)}`);
  log.dump('Full response data:', data);
  
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  
  return data;
}

function sleep(ms) {
  log.trace(`Sleeping for ${ms}ms...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

async function main() {
  log.info('='.repeat(60));
  log.info('Backfill Embeddings');
  log.info('='.repeat(60));
  log.info(`API Base: ${API_BASE}`);
  log.info(`Namespace: ${options.namespace || 'all'}`);
  log.info(`Generate CLIP: ${generateClip}`);
  log.info(`Generate Color: ${generateColor}`);
  log.info(`Skip existing: ${!options.force} (use --force to regenerate)`);
  log.info(`Dry run: ${options.dryRun}`);
  log.info(`Batch size: ${options.batch}`);
  log.info(`Delay between batches: ${options.delay}ms`);
  log.info(`Verbosity level: ${options.verbose}`);
  log.info('='.repeat(60));
  log.info();
  
  log.verbose('Fetching image list from API...');
  const allImages = await fetchImages();
  log.info(`Total images found: ${allImages.length}`);
  
  // Show embedding status breakdown
  const withClip = allImages.filter(img => img.hasClipEmbedding).length;
  const withColor = allImages.filter(img => img.hasColorEmbedding).length;
  const withBoth = allImages.filter(img => img.hasClipEmbedding && img.hasColorEmbedding).length;
  const withNeither = allImages.filter(img => !img.hasClipEmbedding && !img.hasColorEmbedding).length;
  
  log.info(`  ├─ With CLIP embedding: ${withClip}`);
  log.info(`  ├─ With color embedding: ${withColor}`);
  log.info(`  ├─ With both: ${withBoth}`);
  log.info(`  └─ With neither: ${withNeither}`);
  
  log.verbose('Filtering images that need processing...');
  const toProcess = allImages.filter(needsEmbedding).slice(0, options.limit);
  log.info(`\nImages to process: ${toProcess.length}`);
  
  if (toProcess.length === 0) {
    log.info('\n✓ All images already have the requested embeddings!');
    log.verbose('Nothing to do. Use --force to regenerate existing embeddings.');
    return;
  }
  
  if (options.dryRun) {
    log.info('\n[DRY RUN] Would process the following images:\n');
    for (const img of toProcess.slice(0, 50)) {
      const clipStatus = img.hasClipEmbedding ? '✓' : '✗';
      const colorStatus = img.hasColorEmbedding ? '✓' : '✗';
      log.info(`  ${img.id.slice(0, 8)}... [CLIP:${clipStatus} Color:${colorStatus}] ${img.filename}`);
    }
    if (toProcess.length > 50) {
      log.info(`  ... and ${toProcess.length - 50} more`);
    }
    log.info('\nRun without --dry-run to process these images.');
    return;
  }
  
  const startTime = Date.now();
  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  const timings = [];  // Track per-image timings for rolling average
  
  log.info(`\n${'─'.repeat(60)}`);
  log.info(`Starting processing of ${toProcess.length} images...`);
  log.info(`${'─'.repeat(60)}\n`);
  
  for (let i = 0; i < toProcess.length; i++) {
    const image = toProcess[i];
    const progress = `[${String(i + 1).padStart(String(toProcess.length).length)}/${toProcess.length}]`;
    const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
    
    const displayName = image.filename.length > 35 
      ? image.filename.slice(0, 32) + '...' 
      : image.filename.padEnd(35);
    
    process.stdout.write(`${progress} ${pct.padStart(5)}% ${displayName} `);
    log.verbose(`\n  Image ID: ${image.id}`);
    log.verbose(`  Folder: ${image.folder || '(none)'}`);
    log.verbose(`  Current status: CLIP=${image.hasClipEmbedding || false}, Color=${image.hasColorEmbedding || false}`);
    
    try {
      const embedStartTime = Date.now();
      const result = await generateEmbeddings(image.id, image.filename);
      const embedElapsed = Date.now() - embedStartTime;
      timings.push(embedElapsed);
      
      // Calculate ETA based on rolling average of last 10 timings
      const recentTimings = timings.slice(-10);
      const avgTime = recentTimings.reduce((a, b) => a + b, 0) / recentTimings.length;
      const remaining = toProcess.length - (i + 1);
      const eta = remaining * avgTime;
      const etaStr = remaining > 0 ? `ETA: ${formatDuration(eta)}` : 'Done!';
      
      if (result.skipped) {
        process.stdout.write(`⊘ skip ${(embedElapsed/1000).toFixed(1)}s | ${etaStr}\n`);
        log.verbose(`  Skipped: embeddings already exist`);
        skipped++;
      } else {
        const parts = [];
        if (result.clipGenerated) parts.push('CLIP');
        if (result.colorGenerated) parts.push('color');
        const colorPreview = result.dominantColors ? ` ${colorBlocksRow(result.dominantColors)}` : '';
        process.stdout.write(`✓ ${parts.join('+')} ${(embedElapsed/1000).toFixed(1)}s${colorPreview} | ${etaStr}\n`);
        log.verbose(`  Generated: ${parts.join(', ')}`);
        if (result.dominantColors) {
          log.verbose(`  Dominant colors: ${colorBlocksRow(result.dominantColors)} ${result.dominantColors.join(', ')}`);
        }
        if (result.averageColor) {
          log.verbose(`  Average color:   ${colorBlock(result.averageColor)} ${result.averageColor}`);
        }
        succeeded++;
      }
    } catch (error) {
      // Still track time for failed attempts
      timings.push(5000);  // Assume 5s for failures to not skew ETA
      const remaining = toProcess.length - (i + 1);
      const recentTimings = timings.slice(-10);
      const avgTime = recentTimings.reduce((a, b) => a + b, 0) / recentTimings.length;
      const eta = remaining * avgTime;
      const etaStr = remaining > 0 ? `ETA: ${formatDuration(eta)}` : '';
      
      process.stdout.write(`✗ FAILED | ${etaStr}\n`);
      log.info(`  Error: ${error.message}`);
      failed++;
      errors.push({ id: image.id, filename: image.filename, error: error.message });
    }
    
    processed++;
    
    // Pause between batches
    if ((i + 1) % options.batch === 0 && i + 1 < toProcess.length) {
      const elapsed = Date.now() - startTime;
      const rate = processed / (elapsed / 1000);
      const remaining = toProcess.length - processed;
      const recentTimings = timings.slice(-10);
      const avgTime = recentTimings.reduce((a, b) => a + b, 0) / recentTimings.length;
      const eta = remaining * avgTime;
      
      log.info(`\n${'─'.repeat(40)}`);
      log.info(`Batch ${Math.floor((i + 1) / options.batch)} complete`);
      log.info(`  Processed: ${processed} | Succeeded: ${succeeded} | Skipped: ${skipped} | Failed: ${failed}`);
      log.info(`  Rate: ${rate.toFixed(2)} images/sec | Avg: ${(avgTime/1000).toFixed(1)}s/image`);
      log.info(`  Remaining: ${remaining} images | ETA: ${formatDuration(eta)}`);
      log.info(`  Pausing ${options.delay}ms before next batch...`);
      log.info(`${'─'.repeat(40)}\n`);
      await sleep(options.delay);
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  log.info('\n' + '='.repeat(60));
  log.info('SUMMARY');
  log.info('='.repeat(60));
  log.info(`Total processed:  ${processed}`);
  log.info(`  ├─ Succeeded:   ${succeeded}`);
  log.info(`  ├─ Skipped:     ${skipped}`);
  log.info(`  └─ Failed:      ${failed}`);
  log.info(`Total time:       ${formatDuration(totalTime)}`);
  log.info(`Average time:     ${(totalTime / processed / 1000).toFixed(2)}s per image`);
  log.info(`Throughput:       ${(processed / totalTime * 1000).toFixed(2)} images/sec`);
  
  if (errors.length > 0) {
    log.info('\n' + '─'.repeat(60));
    log.info('ERRORS');
    log.info('─'.repeat(60));
    for (const err of errors.slice(0, 20)) {
      log.info(`  ${err.id.slice(0, 8)}... ${err.filename}`);
      log.info(`    └─ ${err.error}`);
    }
    if (errors.length > 20) {
      log.info(`  ... and ${errors.length - 20} more errors`);
    }
  }
  
  log.info('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
