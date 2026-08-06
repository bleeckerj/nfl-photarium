import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trace } from '../lib/cliLogger.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);
let waitForHttpSlot = async () => {};

export function setWaitForHttpSlot(waiter) { waitForHttpSlot = waiter; }

export function createMinIntervalLimiter(minIntervalMs) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  if (interval <= 0) return async () => {};
  let chain = Promise.resolve();
  let lastAt = 0;
  return async function waitTurn() {
    const next = chain.then(async () => {
      const waitMs = Math.max(0, lastAt + interval - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  };
}

export function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export function normalizeRelPath(input) { return String(input || '').split(path.sep).join('/'); }

export function normalizeDiscordAttachmentUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try { const parsed = new URL(raw); return `${parsed.origin}${parsed.pathname}`; } catch { return raw; }
}

export function normalizeUrlForExtras(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = (protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443') ? '' : parsed.port;
    return `${protocol}//${hostname}${port ? `:${port}` : ''}${parsed.pathname}${parsed.search}`;
  } catch { return raw; }
}

export function isValidAssetId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return Boolean(text) && !['n/a', 'duplicate', 'assumed-uploaded'].includes(text);
}

export function parseChannelFolderName(folderName) {
  const match = /^(.+)_([0-9]{6,})$/.exec(folderName);
  if (!match) return { channelName: folderName, channelId: '', channelKey: folderName };
  return { channelName: match[1], channelId: match[2], channelKey: `${match[1]}_${match[2]}` };
}

export function buildDefaultReportPaths() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = path.resolve('data', 'reports');
  return { jsonPath: path.join(baseDir, `discord-metadata-backfill-${stamp}.json`), ndjsonPath: path.join(baseDir, `discord-metadata-backfill-${stamp}.ndjson`) };
}

export async function fetchJsonWithRetry(url, init, { retries, timeoutMs, label = 'request' }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    await waitForHttpSlot();
    trace(`🌐 ${label} attempt ${attempt}/${retries} -> ${url}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
      clearTimeout(timeout);
      if (attempt > 1) console.log(`✅ ${label} succeeded on retry ${attempt}/${retries}`);
      return payload;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`⏳ ${label} attempt ${attempt}/${retries} failed: ${lastError.message}`);
      if (attempt >= retries) break;
      const message = lastError.message.toLowerCase();
      const throttled = message.includes('throttl') || message.includes('rate limit') || message.includes('429') || message.includes('please wait');
      const baseDelay = throttled ? 2500 : 500;
      const sleepMs = Math.min(30_000, baseDelay * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 350);
      console.warn(`🕒 ${label} backing off for ${sleepMs}ms before retry`);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }
  throw lastError || new Error('Request failed');
}

export async function hashFileContent(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function walkImageFiles(rootDir, limit = 0) {
  const out = [];
  const channelDirents = await fs.readdir(rootDir, { withFileTypes: true });
  for (const channelDirent of channelDirents) {
    if (!channelDirent.isDirectory()) continue;
    const channelRoot = path.join(rootDir, channelDirent.name);
    const imagesRoot = path.join(channelRoot, 'images');
    const jsonRoot = path.join(channelRoot, 'json');
    if (!(await fs.stat(imagesRoot).catch(() => null))?.isDirectory()) continue;
    const channelInfo = parseChannelFolderName(channelDirent.name);
    const queue = [imagesRoot];
    while (queue.length > 0) {
      const dir = queue.shift();
      if (!dir) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!entry.name.startsWith('.')) queue.push(abs); continue; }
        if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const relPath = normalizeRelPath(path.relative(imagesRoot, abs));
        const sidecarRel = normalizeRelPath(path.join(path.dirname(relPath), `${path.parse(relPath).name}.json`));
        out.push({ absPath: abs, relPath, channelFolderName: channelDirent.name, channelName: channelInfo.channelName, channelId: channelInfo.channelId, targetFolder: `discord/${channelInfo.channelKey}`, sidecarPath: path.join(jsonRoot, sidecarRel) });
        if (limit > 0 && out.length >= limit) return out;
      }
    }
  }
  return out;
}

export async function loadJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }

export function buildCheckpointIndexes(checkpoint) {
  const entries = checkpoint?.entries && typeof checkpoint.entries === 'object' ? checkpoint.entries : {};
  const hashEntries = checkpoint?.hashEntries && typeof checkpoint.hashEntries === 'object' ? checkpoint.hashEntries : {};
  const relPathToAssetIds = new Map();
  for (const [entryKey, entryValue] of Object.entries(entries)) {
    const entry = entryValue && typeof entryValue === 'object' ? entryValue : null;
    if (!entry || entry.status !== 'uploaded' || entry.kind !== 'image' || !isValidAssetId(entry.assetId)) continue;
    const key = String(entryKey);
    const idx = key.indexOf('\n');
    const relPath = normalizeRelPath(idx >= 0 ? key.slice(idx + 1) : key);
    if (!relPath) continue;
    const set = relPathToAssetIds.get(relPath) || new Set();
    set.add(String(entry.assetId));
    relPathToAssetIds.set(relPath, set);
  }
  const hashToAssetIds = new Map();
  for (const entryValue of Object.values(hashEntries)) {
    const entry = entryValue && typeof entryValue === 'object' ? entryValue : null;
    if (!entry || entry.status !== 'uploaded' || entry.kind !== 'image' || !isValidAssetId(entry.assetId)) continue;
    const contentHash = typeof entry.contentHash === 'string' ? entry.contentHash.trim().toLowerCase() : '';
    if (!contentHash) continue;
    const set = hashToAssetIds.get(contentHash) || new Set();
    set.add(String(entry.assetId));
    hashToAssetIds.set(contentHash, set);
  }
  return { relPathToAssetIds, hashToAssetIds };
}

export function choosePreferredRecord(current, candidate) {
  if (!current) return candidate;
  const rank = (method) => method === 'checkpoint' ? 2 : method === 'hash' ? 1 : 0;
  return rank(candidate.matchMethod) > rank(current.matchMethod) ? candidate : current;
}

export async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runner()));
}
