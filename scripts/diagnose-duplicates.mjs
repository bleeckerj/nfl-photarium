#!/usr/bin/env node
/**
 * Diagnostic script: shows duplicate groups where BOTH originalUrl (normalized)
 * and contentHash match. Useful to understand why the gallery might show duplicates.
 *
 * Usage:
 *   node scripts/diagnose-duplicates.mjs          # hits http://localhost:3000
 *   DIAG_API_BASE=https://your-host DIAG_REFRESH=1 node scripts/diagnose-duplicates.mjs
 */
const API_BASE = process.env.DIAG_API_BASE ?? 'http://localhost:3000';
const FORCE_REFRESH = process.env.DIAG_REFRESH === '1';
const MIN_GROUP_SIZE = Number(process.env.DIAG_MIN_GROUP_SIZE ?? '2');

const normalizeUrlKey = (value) => {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    const origin = `${parsed.protocol}//${parsed.host}`;
    return `${origin}${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return undefined;
  }
};

const normalizeHashKey = (value) => {
  if (!value) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
};

const fetchImages = async () => {
  const url = new URL('/api/images', API_BASE);
  if (FORCE_REFRESH) url.searchParams.set('refresh', '1');
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to fetch images: ${resp.status} ${text}`);
  }
  const payload = await resp.json();
  if (!Array.isArray(payload.images)) {
    throw new Error('Unexpected response shape (missing images array)');
  }
  return payload.images;
};

const main = async () => {
  const images = await fetchImages();
  console.log(`Fetched ${images.length} images from ${API_BASE} (refresh=${FORCE_REFRESH})`);

  const byKey = new Map();
  const missingUrl = [];
  const missingHash = [];

  for (const img of images) {
    const normUrl = normalizeUrlKey(img.originalUrlNormalized ?? img.originalUrl);
    const normHash = normalizeHashKey(img.contentHash);

    if (!normUrl && !normHash) continue; // nothing to dedupe on
    if (!normUrl) {
      missingUrl.push(img);
      continue;
    }
    if (!normHash) {
      missingHash.push(img);
      continue;
    }

    const key = `${normUrl}|${normHash}`;
    const entry = byKey.get(key) ?? { url: normUrl, hash: normHash, items: [] };
    entry.items.push(img);
    byKey.set(key, entry);
  }

  const groups = Array.from(byKey.values()).filter((g) => g.items.length >= MIN_GROUP_SIZE);
  const duplicateImageCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  console.log(
    `Found ${groups.length} duplicate group(s) affecting ${duplicateImageCount} image(s) (URL + hash).`
  );

  for (const group of groups) {
    console.log('\n=== Duplicate group ===');
    console.log(`URL:  ${group.url}`);
    console.log(`HASH: ${group.hash}`);
    group.items.forEach((img) => {
      console.log(
        `- id=${img.id} | filename=${img.filename || '[none]'} | folder=${img.folder || '[none]'}`
      );
      console.log(`  originalUrl=${img.originalUrl || '[none]'}`);
    });
  }

  if (missingUrl.length || missingHash.length) {
    console.log('\nImages skipped (missing one of the keys):');
    if (missingUrl.length) {
      console.log(`- Missing normalized URL: ${missingUrl.length}`);
    }
    if (missingHash.length) {
      console.log(`- Missing content hash:   ${missingHash.length}`);
    }
  }

  if (!groups.length) {
    console.log('\nNo duplicates detected by URL + hash.');
  }
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
