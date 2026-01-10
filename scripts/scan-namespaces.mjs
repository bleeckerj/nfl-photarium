#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PAGE_SIZE = 100;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    pageSize: DEFAULT_PAGE_SIZE,
    output: path.join(process.cwd(), 'data', 'namespace-registry.json')
  };
  args.forEach((arg) => {
    if (arg.startsWith('--page-size=')) {
      const value = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(value)) {
        parsed.pageSize = Math.min(100, Math.max(1, value));
      }
      return;
    }
    if (arg.startsWith('--output=')) {
      const value = arg.split('=').slice(1).join('=');
      if (value) {
        parsed.output = path.resolve(process.cwd(), value);
      }
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

const main = async () => {
  await loadEnvFile(path.join(process.cwd(), '.env.local'));
  await loadEnvFile(path.join(process.cwd(), '.env'));

  const args = parseArgs();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    process.exitCode = 1;
    return;
  }

  let page = 1;
  let scanned = 0;
  const namespaces = new Set();

  console.log(`[namespace] Scanning namespaces (pageSize=${args.pageSize})`);

  while (true) {
    const images = await fetchImagesPage(accountId, apiToken, page, args.pageSize);
    if (!images.length) {
      break;
    }
    for (const image of images) {
      scanned += 1;
      const metadata = parseMetadata(image.meta);
      const value = typeof metadata.namespace === 'string' ? metadata.namespace.trim() : '';
      if (value) {
        namespaces.add(value);
      }
    }
    if (images.length < args.pageSize) {
      break;
    }
    page += 1;
  }

  const sorted = Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  const payload = {
    namespaces: sorted,
    updatedAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`[namespace] Scanned ${scanned} images`);
  console.log(`[namespace] Found ${sorted.length} unique namespaces`);
  console.log(`[namespace] Wrote ${args.output}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
