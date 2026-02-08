#!/usr/bin/env node

/**
 * Backfill Comfy Metadata Script
 *
 * Detects ComfyUI metadata in existing Cloudflare images and updates metadata flags:
 * - generatedBy = "comfyui"
 * - comfyMetadataDetected = true
 * - comfyMetadataSource = <evidence source>
 *
 * Usage:
 *   node scripts/backfill-comfy-metadata.mjs [options]
 *
 * Options:
 *   --image-id=<id[,id2]> Process specific image ID(s) only
 *   --namespace=<ns>       Only process images in this namespace (default: all)
 *                          Use __none__ for images without namespace
 *                          Use __all__ for all namespaces
 *   --folder=<name>        Only process images in this folder (from metadata)
 *                          Use __none__ for images without folder
 *   --limit=<n>            Maximum images to process
 *   --concurrency=<n>      Concurrent image processing workers (default: 4)
 *   --force                Re-scan images already marked as ComfyUI
 *   --clear-non-comfy      Clear existing comfy flags when no comfy metadata is found
 *   --dry-run              Detect and report, but do not PATCH Cloudflare metadata
 *   -v, --verbose          Verbose logging
 *   --help, -h             Show help
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { inflateSync } from 'zlib';

const COMFY_METADATA_KEYS = new Set([
  'prompt',
  'workflow',
  'comfyui_workflow',
  'comfy_workflow',
  'parameters',
]);

const MAX_JSON_CANDIDATE_BYTES = 2_000_000;

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const idx = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=');
  return args[idx + 1] ?? null;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Backfill Comfy Metadata Script

Usage:
  node scripts/backfill-comfy-metadata.mjs [options]

Options:
  --image-id=<id[,id2]> Process specific image ID(s) only
  --namespace=<ns>       Only process images in this namespace (default: all)
                         Use __none__ for images without namespace
                         Use __all__ for all namespaces
  --folder=<name>        Only process images in this folder (metadata field)
                         Use __none__ for images without folder
  --limit=<n>            Maximum images to process
  --concurrency=<n>      Concurrent workers (default: 4)
  --force                Re-scan images already marked as ComfyUI
  --clear-non-comfy      Clear comfy flags if detection is false
  --dry-run              Detect and report, do not patch metadata
  -v, --verbose          Verbose output
  --help, -h             Show this help
`);
  process.exit(0);
}

const namespaceArg = getArgValue('--namespace');
const folderArg = getArgValue('--folder');
const imageIdArg = getArgValue('--image-id');
const limitArg = getArgValue('--limit');
const concurrencyArg = getArgValue('--concurrency');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const clearNonComfy = args.includes('--clear-non-comfy');
const verbose = args.includes('-v') || args.includes('--verbose');

const namespace = namespaceArg === '__all__'
  ? null
  : namespaceArg === '__none__'
    ? ''
    : namespaceArg ?? null;
const folderFilter = folderArg === null
  ? null
  : folderArg === '__none__'
    ? ''
    : folderArg;
const imageIdFilter = imageIdArg
  ? imageIdArg.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

const limit = limitArg ? Number(limitArg) : null;
const concurrency = Number.isFinite(Number(concurrencyArg)) && Number(concurrencyArg) > 0
  ? Math.min(24, Math.max(1, Number(concurrencyArg)))
  : 4;

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

loadEnvFile(path.resolve(process.cwd(), '.env.local'));

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_HASH = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

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
  if (typeof rawMeta === 'object' && rawMeta !== null) return rawMeta;
  return {};
};

const fetchCloudflareImages = async () => {
  const perPage = 100;
  let page = 1;
  const collected = [];

  while (true) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        },
      }
    );
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json?.errors?.[0]?.message || 'Failed to fetch Cloudflare images');
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
      filename: image.filename || 'unknown',
      uploaded: image.uploaded,
      variants: Array.isArray(image.variants) ? image.variants : [],
      meta,
      namespace: typeof meta.namespace === 'string' ? meta.namespace : undefined,
      folder: typeof meta.folder === 'string' ? meta.folder : undefined,
    };
  });
};

const selectImageUrl = (image) => {
  const variants = Array.isArray(image.variants) ? image.variants : [];
  const publicVariant = variants.find((variant) => typeof variant === 'string' && variant.includes('/public'));
  if (publicVariant) return publicVariant;
  const firstVariant = variants.find((variant) => typeof variant === 'string' && variant.startsWith('http'));
  if (firstVariant) return firstVariant;
  if (ACCOUNT_HASH) {
    return `https://imagedelivery.net/${ACCOUNT_HASH}/${image.id}/public`;
  }
  return null;
};

const safeParseJson = (value) => {
  if (!value || value.length > MAX_JSON_CANDIDATE_BYTES) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const looksLikeNodeMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  let validNodes = 0;
  for (const [, node] of entries.slice(0, 8)) {
    if (node && typeof node === 'object' && !Array.isArray(node) && 'class_type' in node && 'inputs' in node) {
      validNodes += 1;
    }
  }
  return validNodes > 0;
};

const looksLikeComfyWorkflow = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value;
  if (looksLikeNodeMap(obj)) return true;
  if ('prompt' in obj && looksLikeNodeMap(obj.prompt)) return true;
  if ('workflow' in obj && looksLikeComfyWorkflow(obj.workflow)) return true;
  if (Array.isArray(obj.nodes) && obj.nodes.length > 0) return true;
  return false;
};

const extractExifLikePayload = (value) => {
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const key = value.slice(0, idx).trim().toLowerCase();
  if (!COMFY_METADATA_KEYS.has(key)) return null;
  const payload = value.slice(idx + 1).trim();
  if (!payload.startsWith('{') && !payload.startsWith('[')) return null;
  const parsed = safeParseJson(payload);
  if (!parsed) return null;
  return { key, json: parsed };
};

const walkStrings = (value, visit, depth = 0) => {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 64)) {
      walkStrings(entry, visit, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value).slice(0, 64)) {
      walkStrings(entry, visit, depth + 1);
    }
  }
};

const maybeAddComfyEvidence = (key, value, sourcePrefix, sources) => {
  const normalizedKey = key.trim().toLowerCase();
  if (!COMFY_METADATA_KEYS.has(normalizedKey)) return;
  const parsed = safeParseJson(value.trim());
  if (!parsed) return;
  if (!looksLikeComfyWorkflow(parsed)) return;
  sources.add(`${sourcePrefix}:${normalizedKey}`);
};

const detectFromPngChunks = (buffer, sources) => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) return;

  let offset = 8;

  const parseTextChunk = (data) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const value = data.subarray(nullIdx + 1).toString('utf8');
    maybeAddComfyEvidence(key, value, 'png', sources);
  };

  const parseCompressedTextChunk = (data) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0 || nullIdx + 2 > data.length) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const compressed = data.subarray(nullIdx + 2);
    try {
      const value = inflateSync(compressed).toString('utf8');
      maybeAddComfyEvidence(key, value, 'png', sources);
    } catch {
      // ignore malformed chunks
    }
  };

  const parseInternationalTextChunk = (data) => {
    const keyEnd = data.indexOf(0x00);
    if (keyEnd <= 0 || keyEnd + 3 >= data.length) return;
    const key = data.subarray(0, keyEnd).toString('latin1');
    const compressed = data[keyEnd + 1] === 1;

    let cursor = keyEnd + 3;
    const languageEnd = data.indexOf(0x00, cursor);
    if (languageEnd < 0) return;
    cursor = languageEnd + 1;

    const translatedEnd = data.indexOf(0x00, cursor);
    if (translatedEnd < 0) return;
    cursor = translatedEnd + 1;

    const textBytes = data.subarray(cursor);
    try {
      const value = (compressed ? inflateSync(textBytes) : textBytes).toString('utf8');
      maybeAddComfyEvidence(key, value, 'png', sources);
    } catch {
      // ignore malformed chunks
    }
  };

  const parseComfChunk = (data) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const value = data.subarray(nullIdx + 1).toString('latin1');
    maybeAddComfyEvidence(key, value, 'png-comf', sources);
  };

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd > buffer.length || crcEnd > buffer.length) break;

    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (type === 'tEXt') parseTextChunk(chunkData);
    else if (type === 'zTXt') parseCompressedTextChunk(chunkData);
    else if (type === 'iTXt') parseInternationalTextChunk(chunkData);
    else if (type === 'comf') parseComfChunk(chunkData);

    offset = crcEnd;
    if (type === 'IEND') break;
  }
};

const detectFromSvgMetadata = (buffer, sources) => {
  const text = buffer.toString('utf8');
  if (!text.includes('<svg') || !text.toLowerCase().includes('<metadata')) return;

  const metadataMatch = text.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!metadataMatch) return;

  const body = metadataMatch[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  if (!body) return;

  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return;

  const candidate = body.slice(firstBrace, lastBrace + 1);
  const parsed = safeParseJson(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  if (('prompt' in parsed && looksLikeComfyWorkflow(parsed.prompt)) || ('workflow' in parsed && looksLikeComfyWorkflow(parsed.workflow))) {
    sources.add('svg:metadata');
  }
};

const detectFromExif = async (buffer, sources) => {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return;
  }

  if (!metadata?.exif) return;

  try {
    const parsedExif = exifReader(metadata.exif);
    walkStrings(parsedExif, (value) => {
      const parsed = extractExifLikePayload(value);
      if (!parsed) return;
      if (!looksLikeComfyWorkflow(parsed.json)) return;
      sources.add(`exif:${parsed.key}`);
    });
  } catch {
    // ignore malformed exif
  }
};

const detectComfyMetadata = async (buffer, options = {}) => {
  const sources = new Set();
  const mimeType = options.mimeType?.toLowerCase();

  const isSvg = mimeType?.includes('svg') || buffer.subarray(0, 256).toString('utf8').includes('<svg');
  if (isSvg) {
    detectFromSvgMetadata(buffer, sources);
  }

  const isPng = mimeType?.includes('png') || (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
  if (isPng) {
    detectFromPngChunks(buffer, sources);
  }

  await detectFromExif(buffer, sources);

  const sourceList = Array.from(sources);
  return {
    detected: sourceList.length > 0,
    source: sourceList[0],
    sources: sourceList,
  };
};

const fetchBuffer = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: options.headers,
    });
    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchImageBuffer = async (image) => {
  const blobUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1/${image.id}/blob`;
  try {
    const blobResponse = await fetchBuffer(blobUrl, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      },
    });
    return { ...blobResponse, fetchSource: 'blob' };
  } catch (error) {
    const fallbackUrl = selectImageUrl(image);
    if (!fallbackUrl) throw error;
    const fallbackResponse = await fetchBuffer(fallbackUrl);
    return { ...fallbackResponse, fetchSource: 'variant' };
  }
};

const patchCloudflareMetadata = async (imageId, metadata) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1/${imageId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || `PATCH failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
};

const shouldProcessImage = (image) => {
  const meta = image.meta || {};
  const alreadyComfy = meta.generatedBy === 'comfyui' || meta.comfyMetadataDetected === true;
  if (!force && alreadyComfy) return false;
  return true;
};

const applyDetectionToMetadata = (meta, detection) => {
  const nextMeta = { ...meta };
  let changed = false;

  if (detection.detected) {
    if (nextMeta.generatedBy !== 'comfyui') {
      nextMeta.generatedBy = 'comfyui';
      changed = true;
    }
    if (nextMeta.comfyMetadataDetected !== true) {
      nextMeta.comfyMetadataDetected = true;
      changed = true;
    }
    if (detection.source && nextMeta.comfyMetadataSource !== detection.source) {
      nextMeta.comfyMetadataSource = detection.source;
      changed = true;
    }
  } else if (clearNonComfy) {
    if (nextMeta.generatedBy === 'comfyui') {
      delete nextMeta.generatedBy;
      changed = true;
    }
    if ('comfyMetadataDetected' in nextMeta) {
      delete nextMeta.comfyMetadataDetected;
      changed = true;
    }
    if ('comfyMetadataSource' in nextMeta) {
      delete nextMeta.comfyMetadataSource;
      changed = true;
    }
  }

  if (changed) {
    nextMeta.updatedAt = new Date().toISOString();
  }

  return { nextMeta, changed };
};

const formatScopeLabel = () => {
  if (namespace === null) return 'all namespaces';
  if (namespace === '') return 'namespace: (none)';
  return `namespace: ${namespace}`;
};

const formatFolderLabel = () => {
  if (folderFilter === null) return 'all folders';
  if (folderFilter === '') return 'folder: (none)';
  return `folder: ${folderFilter}`;
};

const main = async () => {
  console.log(`[Comfy Backfill] dryRun=${dryRun} force=${force} clearNonComfy=${clearNonComfy}`);
  console.log(`[Comfy Backfill] scope=${formatScopeLabel()} | ${formatFolderLabel()} concurrency=${concurrency}`);
  if (imageIdFilter.length > 0) {
    console.log(`[Comfy Backfill] imageId filter active (${imageIdFilter.length})`);
  }

  console.log('[Comfy Backfill] Loading images from Cloudflare...');
  const allImages = await fetchCloudflareImages();
  let scoped = namespace === null
    ? allImages
    : namespace === ''
      ? allImages.filter((image) => !image.namespace)
      : allImages.filter((image) => image.namespace === namespace);

  if (folderFilter !== null) {
    scoped = folderFilter === ''
      ? scoped.filter((image) => !image.folder)
      : scoped.filter((image) => image.folder === folderFilter);
  }

  if (imageIdFilter.length > 0) {
    const allowedIds = new Set(imageIdFilter);
    scoped = scoped.filter((image) => allowedIds.has(image.id));
  }

  if (limit && Number.isFinite(limit)) {
    scoped = scoped.slice(0, limit);
  }

  const targets = scoped.filter((image) => shouldProcessImage(image));
  const skippedAlreadyTagged = scoped.length - targets.length;

  console.log(`[Comfy Backfill] Found ${allImages.length} total images, ${scoped.length} in scope, ${targets.length} queued (${skippedAlreadyTagged} skipped already tagged)`);

  let processed = 0;
  let detectedComfy = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let downloadFailed = 0;

  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= targets.length) return;

      const image = targets[index];

      try {
        const { buffer, mimeType, fetchSource } = await fetchImageBuffer(image);
        const detection = await detectComfyMetadata(buffer, { mimeType });
        if (detection.detected) detectedComfy += 1;

        const beforeMeta = image.meta || {};
        const { nextMeta: afterMeta, changed } = applyDetectionToMetadata(beforeMeta, detection);

        if (!changed) {
          unchanged += 1;
          processed += 1;
          if (verbose) {
            console.log(`[SKIP] ${image.id} unchanged (detected=${detection.detected ? 'yes' : 'no'})`);
          }
        } else if (dryRun) {
          updated += 1;
          processed += 1;
          console.log(`[DRY] ${image.id} -> detected=${detection.detected ? 'yes' : 'no'} source=${detection.source || 'n/a'} via=${fetchSource}`);
        } else {
          await patchCloudflareMetadata(image.id, afterMeta);
          updated += 1;
          processed += 1;
          console.log(`[OK] ${image.id} patched (detected=${detection.detected ? 'yes' : 'no'} source=${detection.source || 'n/a'} via=${fetchSource})`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Fetch failed') || message.includes('aborted')) {
          downloadFailed += 1;
        }
        failed += 1;
        console.warn(`[FAIL] ${image.id} (${image.filename}) ${message}`);
      }

      const done = processed + failed;
      if (done % 25 === 0 || done === targets.length) {
        console.log(
          `[Comfy Backfill] Progress ${done}/${targets.length} | detected=${detectedComfy} updated=${updated} unchanged=${unchanged} failed=${failed}`
        );
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker());
  await Promise.all(workers);

  console.log('\n[Comfy Backfill] Done');
  console.log(`[Comfy Backfill] Processed: ${processed}`);
  console.log(`[Comfy Backfill] Detected comfy: ${detectedComfy}`);
  console.log(`[Comfy Backfill] Metadata updated: ${updated}`);
  console.log(`[Comfy Backfill] Unchanged: ${unchanged}`);
  console.log(`[Comfy Backfill] Failed: ${failed} (download failures: ${downloadFailed})`);
};

main().catch((error) => {
  console.error('[Comfy Backfill] Fatal:', error);
  process.exit(1);
});
