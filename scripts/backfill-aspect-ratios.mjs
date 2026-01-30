#!/usr/bin/env node
/**
 * Backfill Aspect Ratios Script
 *
 * Computes width/height + aspect ratio for images and stores in Redis.
 *
 * Usage:
 *   node scripts/backfill-aspect-ratios.mjs
 *   node scripts/backfill-aspect-ratios.mjs --namespace my-namespace
 *   node scripts/backfill-aspect-ratios.mjs --namespace __none__
 *   node scripts/backfill-aspect-ratios.mjs --namespace __all__
 *   node scripts/backfill-aspect-ratios.mjs --limit 100
 *   node scripts/backfill-aspect-ratios.mjs --force
 */

import fs from 'fs';
import path from 'path';

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

const envLocalPath = path.resolve(process.cwd(), '.env.local');
loadEnvFile(envLocalPath);

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

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const idx = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return args[idx + 1] ?? null;
};

const namespaceArg = getArgValue('--namespace');
const limitArg = getArgValue('--limit');
const force = args.includes('--force');

const namespace = namespaceArg === '__all__'
  ? null
  : namespaceArg === '__none__'
    ? ''
    : namespaceArg ?? null;

const limit = limitArg ? Number(limitArg) : null;

const CONCURRENCY = 5;

const COMMON_RATIOS = [
  { ratio: 16 / 9, name: '16:9' },
  { ratio: 3 / 2, name: '3:2' },
  { ratio: 4 / 3, name: '4:3' },
  { ratio: 1 / 1, name: '1:1' },
  { ratio: 4 / 5, name: '4:5' },
  { ratio: 2 / 3, name: '2:3' },
  { ratio: 3 / 4, name: '3:4' },
  { ratio: 9 / 16, name: '9:16' },
  { ratio: 5 / 4, name: '5:4' },
  { ratio: 21 / 9, name: '21:9' },
];

const classifyAspectRatio = (width, height) => {
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.05) return 'square';
  return ratio > 1 ? 'horizontal' : 'vertical';
};

const calculateAspectRatio = (width, height) => {
  const decimal = width / height;
  let closestRatio = COMMON_RATIOS[0];
  let smallestDifference = Math.abs(decimal - closestRatio.ratio);
  for (const commonRatio of COMMON_RATIOS) {
    const diff = Math.abs(decimal - commonRatio.ratio);
    if (diff < smallestDifference) {
      smallestDifference = diff;
      closestRatio = commonRatio;
    }
  }
  const threshold = 0.05;
  const ratioName = smallestDifference < threshold
    ? closestRatio.name
    : `${Math.round(width / 10)}:${Math.round(height / 10)}`;
  return { common: ratioName };
};

const parseCloudflareMetadata = (rawMeta) => {
  if (!rawMeta) return {};
  if (typeof rawMeta === 'string') {
    try {
      const parsed = JSON.parse(rawMeta);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof rawMeta === 'object') return rawMeta;
  return {};
};

const fetchCloudflareImages = async () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const perPage = 100;
  let page = 1;
  const collected = [];
  while (true) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(json?.errors?.[0]?.message || 'Failed to fetch images');
    }
    const images = Array.isArray(json?.result?.images) ? json.result.images : [];
    collected.push(...images);
    if (images.length < perPage) break;
    page += 1;
  }

  return collected.map((image) => {
    const meta = parseCloudflareMetadata(image.meta);
    return {
      id: image.id,
      namespace: typeof meta.namespace === 'string' ? meta.namespace : undefined,
    };
  });
};

const fetchImageDimensions = async (imageId) => {
  const hash = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
  const url = `https://imagedelivery.net/${hash}/${imageId}/public`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image for dimensions: ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(Buffer.from(arrayBuffer)).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions');
  }
  return { width: metadata.width, height: metadata.height };
};

const main = async () => {
  const Redis = (await import('ioredis')).default;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
  await redis.connect();

  console.log('✔ Redis connected\n');

  console.log('→ Loading images from Cloudflare...');
  const allImages = await fetchCloudflareImages();
  const images = namespace === null
    ? allImages
    : namespace === ''
      ? allImages.filter(img => !img.namespace)
      : allImages.filter(img => img.namespace === namespace);
  const scopeLabel = namespace === null
    ? 'all namespaces'
    : namespace === ''
      ? 'namespace: (none)'
      : `namespace: ${namespace}`;
  console.log(`✔ Found ${images.length} images (${scopeLabel})\n`);

  const imageIds = images.map((img) => img.id);

  let existingMap = new Map();
  if (!force) {
    const pipeline = redis.pipeline();
    imageIds.forEach((id) => {
      const key = `image:${id}`;
      pipeline.hget(key, 'aspect_ratio');
      pipeline.hget(key, 'width');
      pipeline.hget(key, 'height');
    });
    const results = await pipeline.exec();
    for (let i = 0; i < imageIds.length; i++) {
      const base = i * 3;
      const [, aspectRatio] = results[base] || [];
      const [, width] = results[base + 1] || [];
      const [, height] = results[base + 2] || [];
      if (aspectRatio || width || height) {
        existingMap.set(imageIds[i], { aspectRatio, width, height });
      }
    }
  }

  let toProcess = images.filter((img) => {
    if (force) return true;
    const existing = existingMap.get(img.id);
    return !existing || !existing.width || !existing.height || !existing.aspectRatio;
  });

  if (limit && Number.isFinite(limit)) {
    toProcess = toProcess.slice(0, limit);
  }

  console.log(`→ Processing ${toProcess.length} images for aspect ratios...\n`);

  let processed = 0;
  let failed = 0;

  const processBatch = async (batch) => {
    const results = await Promise.allSettled(
      batch.map(async (img) => {
        const dims = await fetchImageDimensions(img.id);
        const ratio = calculateAspectRatio(dims.width, dims.height);
        const aspectClass = classifyAspectRatio(dims.width, dims.height);
        const key = `image:${img.id}`;
        await redis.hset(key, {
          aspect_ratio: ratio.common,
          aspect_ratio_class: aspectClass,
          width: dims.width,
          height: dims.height,
        });
      })
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        processed += 1;
      } else {
        failed += 1;
        console.warn('⚠ Failed to compute/store aspect ratio:', result.reason?.message ?? result.reason);
      }
    });

    if ((processed + failed) % 25 === 0 || processed + failed === toProcess.length) {
      console.log(`Progress: ${processed} processed, ${failed} failed (of ${toProcess.length})`);
    }
  };

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await processBatch(batch);
  }

  await redis.quit();
  console.log(`\n✔ Done. Processed: ${processed}, Failed: ${failed}`);
};

main().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});