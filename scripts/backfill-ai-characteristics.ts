#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  combineAiCharacteristicScans,
  scanAiCharacteristics,
  type AiCharacteristicsRecord,
} from '@/utils/aiCharacteristics';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { patchImageExtrasRecord } from '@/server/imageExtras';

type CloudflareImage = {
  id: string;
  filename?: string;
  uploaded?: string;
  variants?: string[];
  size?: number;
  meta?: unknown;
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return null;
  const arg = args[index];
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[index + 1] ?? null;
};

const loadEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
};

loadEnvFile(path.resolve(process.cwd(), '.env.local'));

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountHash = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
if (!accountId || !apiToken) {
  console.error('[AI Backfill] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const namespaceArg = getArg('--namespace');
const folderArg = getArg('--folder');
const imageIdArg = getArg('--image-id');
const limitArg = getArg('--limit');
const concurrencyArg = getArg('--concurrency');
const namespace = namespaceArg === '__none__' ? '' : namespaceArg === '__all__' ? null : namespaceArg;
const folder = folderArg === '__none__' ? '' : folderArg;
const imageIds = new Set((imageIdArg ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const limit = limitArg ? Number(limitArg) : null;
const concurrency = Math.min(24, Math.max(1, Number(concurrencyArg) || 4));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const verbose = args.includes('--verbose') || args.includes('-v');

const headers = { Authorization: `Bearer ${apiToken}` };

const parseMeta = (image: CloudflareImage) => parseCloudflareMetadata(image.meta);

async function fetchImages(): Promise<CloudflareImage[]> {
  const images: CloudflareImage[] = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await fetch(url, { headers });
    const body = await response.json() as { result?: { images?: CloudflareImage[] }; errors?: Array<{ message?: string }> };
    if (!response.ok) throw new Error(body.errors?.[0]?.message || `Cloudflare list failed (${response.status})`);
    const pageImages = Array.isArray(body.result?.images) ? body.result.images : [];
    images.push(...pageImages);
    if (pageImages.length < 100) return images;
  }
}

const candidateUrls = (image: CloudflareImage): string[] => {
  const variants = Array.isArray(image.variants) ? image.variants.filter((value): value is string => typeof value === 'string') : [];
  const publicUrl = variants.find((value) => value.includes('/public'));
  const originalUrl = publicUrl?.replace(/\/public(?:$|\?)/, '/original$1');
  return [originalUrl, publicUrl, accountHash ? `https://imagedelivery.net/${accountHash}/${image.id}/original` : null]
    .filter((value): value is string => Boolean(value));
};

async function fetchOriginal(image: CloudflareImage): Promise<{ buffer: Buffer; mimeType: string; source: string }> {
  let lastError: unknown;

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${image.id}/blob`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`original blob returned ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('original blob response was empty');
    return {
      buffer,
      mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
      source: 'original-blob',
    };
  } catch (error) {
    lastError = error;
  }

  for (const [index, url] of candidateUrls(image).entries()) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`image fetch returned ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('image response was empty');
      return {
        buffer,
        mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
        source: index === 0 ? 'original-variant-fallback' : 'delivery-variant-fallback',
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No image variant available');
}

const inScope = (image: CloudflareImage): boolean => {
  if (imageIds.size && !imageIds.has(image.id)) return false;
  const meta = parseMeta(image);
  const imageNamespace = typeof meta.namespace === 'string' ? meta.namespace : '';
  const imageFolder = typeof meta.folder === 'string' ? meta.folder : '';
  if (namespace !== null && imageNamespace !== (namespace ?? '')) return false;
  if (folder !== null && imageFolder !== folder) return false;
  if (!force && meta.aiCharacteristicsDetected === true) return false;
  return true;
};

const patchMetadata = async (imageId: string, metadata: Record<string, unknown>) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata }),
  });
  const body = await response.json() as { errors?: Array<{ message?: string }> };
  if (!response.ok) throw new Error(body.errors?.[0]?.message || `Cloudflare metadata patch failed (${response.status})`);
};

const readBack = async (imageId: string) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`, { headers });
  const body = await response.json() as { result?: CloudflareImage; errors?: Array<{ message?: string }> };
  if (!response.ok || !body.result) throw new Error(body.errors?.[0]?.message || `Cloudflare readback failed (${response.status})`);
  return parseCloudflareMetadata(body.result.meta);
};

const buildMetadata = (before: Record<string, unknown>, record: AiCharacteristicsRecord) => {
  if (record.status !== 'detected') return before;
  return {
    ...before,
    aiCharacteristicsDetected: true,
    aiCharacteristicsSources: record.sources,
    aiCharacteristicsScannerVersion: record.scannerVersion,
  };
};

async function processImage(image: CloudflareImage): Promise<'updated' | 'unchanged' | 'failed'> {
  const before = parseMeta(image);
  try {
    const fetched = await fetchOriginal(image);
    const scan = await scanAiCharacteristics(fetched.buffer, { mimeType: fetched.mimeType });
    const record = combineAiCharacteristicScans([{ scan, evidenceBasis: 'hosted-original' }]);
    const after = buildMetadata(before, record);
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    if (!dryRun && changed) {
      await patchMetadata(image.id, after);
      const verified = await readBack(image.id);
      if (record.status === 'detected' && verified.aiCharacteristicsDetected !== true) {
        throw new Error('readback did not contain aiCharacteristicsDetected=true');
      }
      await upsertCachedImage(transformApiImageToCached({
        id: image.id,
        filename: image.filename || 'unknown',
        uploaded: image.uploaded || new Date().toISOString(),
        variants: image.variants || [],
        size: image.size,
        meta: verified,
      }));
      await patchImageExtrasRecord(image.id, { aiCharacteristics: record });
    } else if (!dryRun) {
      await patchImageExtrasRecord(image.id, { aiCharacteristics: record });
    }
    const state = dryRun ? 'DRY' : changed ? 'OK' : 'SKIP';
    console.log(`[${state}] ${image.id} (${image.filename || 'unknown'}) namespace=${before.namespace || '[none]'} evidence=${record.status}:${record.sources.join(',') || 'none'} via=${fetched.source}`);
    return changed ? 'updated' : 'unchanged';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[FAIL] ${image.id} (${image.filename || 'unknown'}) namespace=${before.namespace || '[none]'} reason=${message}`);
    return 'failed';
  }
}

async function main() {
  const allImages = await fetchImages();
  let scoped = allImages.filter(inScope);
  if (limit && Number.isFinite(limit)) scoped = scoped.slice(0, Math.max(0, limit));
  console.log(`[AI Backfill] Found ${allImages.length} total images, ${scoped.length} queued, mode=${dryRun ? 'dry-run' : 'write'}`);

  let cursor = 0;
  const counts = { updated: 0, unchanged: 0, failed: 0 };
  const worker = async () => {
    while (cursor < scoped.length) {
      const image = scoped[cursor++];
      const result = await processImage(image);
      counts[result] += 1;
      if (verbose) console.log(`[AI Backfill] completed=${cursor}/${scoped.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, scoped.length)) }, () => worker()));
  console.log(`[AI Backfill] Done updated=${counts.updated} unchanged=${counts.unchanged} failed=${counts.failed}`);
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[AI Backfill] Fatal:', error);
  process.exit(1);
});
