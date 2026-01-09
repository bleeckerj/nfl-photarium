#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PAGE_SIZE = 100;
const METADATA_LIMIT_BYTES = 1024;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    dryRun: false,
    namespace: undefined,
    limit: undefined,
    pageSize: DEFAULT_PAGE_SIZE
  };
  args.forEach((arg) => {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      return;
    }
    if (arg.startsWith('--namespace=')) {
      parsed.namespace = arg.split('=').slice(1).join('=');
      return;
    }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(value)) {
        parsed.limit = Math.max(0, value);
      }
      return;
    }
    if (arg.startsWith('--page-size=')) {
      const value = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(value)) {
        parsed.pageSize = Math.min(100, Math.max(1, value));
      }
      return;
    }
  });
  return parsed;
};

const loadEnvFile = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      const index = trimmed.indexOf('=');
      if (index === -1) {
        return;
      }
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || process.env[key]) {
        return;
      }
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      process.env[key] = value;
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[namespace] Failed to load env file ${filePath}: ${error.message}`);
    }
  }
};

const parseMetadata = (meta) => {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof meta === 'object') {
    return meta;
  }
  return {};
};

const metadataByteSize = (payload) =>
  Buffer.byteLength(JSON.stringify(payload), 'utf8');

const enforceMetadataLimit = (payload) => {
  let trimmed = { ...payload };
  let size = metadataByteSize(trimmed);
  const dropped = [];
  const dropOrder = [
    'exif',
    'description',
    'tags',
    'originalUrlNormalized',
    'originalUrl',
    'sourceUrlNormalized',
    'sourceUrl',
    'folder',
    'displayName',
    'filename',
    'contentHash',
    'uploadedAt',
    'type',
    'size',
    'variationParentId',
    'linkedAssetId',
    'variationSort'
  ];

  for (const key of dropOrder) {
    if (size <= METADATA_LIMIT_BYTES) break;
    if (Object.prototype.hasOwnProperty.call(trimmed, key)) {
      delete trimmed[key];
      dropped.push(key);
      size = metadataByteSize(trimmed);
    }
  }

  if (size > METADATA_LIMIT_BYTES) {
    const stringKeys = Object.keys(trimmed).filter(
      (key) => typeof trimmed[key] === 'string' && key !== 'namespace'
    );
    stringKeys.sort(
      (a, b) => String(trimmed[b]).length - String(trimmed[a]).length
    );
    for (const key of stringKeys) {
      if (size <= METADATA_LIMIT_BYTES) break;
      delete trimmed[key];
      dropped.push(key);
      size = metadataByteSize(trimmed);
    }
  }

  return { metadata: trimmed, dropped, size };
};

const fetchImagesPage = async (accountId, apiToken, page, perPage) => {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${apiToken}` }
    }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Failed to fetch page ${page}`);
  }
  return Array.isArray(payload?.result?.images) ? payload.result.images : [];
};

const patchMetadata = async (accountId, apiToken, id, metadata) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ metadata })
    }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || 'Failed to update metadata');
  }
};

const main = async () => {
  await loadEnvFile(path.join(process.cwd(), '.env.local'));
  await loadEnvFile(path.join(process.cwd(), '.env'));

  const args = parseArgs();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE;
  const namespace = (args.namespace || defaultNamespace || '').trim();

  if (!accountId || !apiToken) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    process.exitCode = 1;
    return;
  }
  if (!namespace) {
    console.error('Missing namespace (use IMAGE_NAMESPACE or --namespace=...)');
    process.exitCode = 1;
    return;
  }

  let page = 1;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`[namespace] Backfilling namespace "${namespace}"`);
  console.log(`[namespace] dryRun=${args.dryRun} pageSize=${args.pageSize}`);

  while (true) {
    const images = await fetchImagesPage(accountId, apiToken, page, args.pageSize);
    if (!images.length) {
      break;
    }
    for (const image of images) {
      scanned += 1;
      const existing = parseMetadata(image.meta);
      const currentNamespace = typeof existing.namespace === 'string' ? existing.namespace : '';
      if (currentNamespace) {
        skipped += 1;
        continue;
      }
      const nextMetadata = { ...existing, namespace };
      const { metadata, dropped, size } = enforceMetadataLimit(nextMetadata);
      if (size > METADATA_LIMIT_BYTES) {
        console.warn(`[namespace] Skip ${image.id}: metadata still too large`);
        failed += 1;
        continue;
      }
      if (args.dryRun) {
        console.log(`[namespace] Would update ${image.id}${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}`);
        updated += 1;
      } else {
        try {
          await patchMetadata(accountId, apiToken, image.id, metadata);
          console.log(`[namespace] Updated ${image.id}${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}`);
          updated += 1;
        } catch (error) {
          console.warn(`[namespace] Failed ${image.id}: ${error.message}`);
          failed += 1;
        }
      }
      if (args.limit !== undefined && updated >= args.limit) {
        console.log('[namespace] Update limit reached, stopping.');
        break;
      }
    }
    if (args.limit !== undefined && updated >= args.limit) {
      break;
    }
    if (images.length < args.pageSize) {
      break;
    }
    page += 1;
  }

  console.log(`[namespace] Scanned ${scanned}, updated ${updated}, skipped ${skipped}, failed ${failed}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
