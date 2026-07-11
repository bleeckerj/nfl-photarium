import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export function parseInteger(raw, fallback) {
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)));
}

export function splitCsv(value) {
  return uniqueStrings(String(value || '').split(','));
}

export function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex');
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonIfExists(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function appendLine(filePath, line) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${line}\n`, 'utf8');
}

export function createSerializedTaskQueue() {
  let chain = Promise.resolve();
  return async (task) => {
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };
}

export function createMinIntervalLimiter(minIntervalMs) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  if (interval <= 0) {
    return async () => {};
  }

  let chain = Promise.resolve();
  let lastAt = 0;

  return async function waitForTurn() {
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastAt + interval - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      lastAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  };
}

export function createSharedDownloadGate({
  minIntervalMs = 0,
  defaultRateLimitCooldownMs = 60_000,
  maxRateLimitCooldownMs = 15 * 60_000,
} = {}) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  const defaultCooldown = Math.max(1_000, Number(defaultRateLimitCooldownMs) || 60_000);
  const maxCooldown = Math.max(defaultCooldown, Number(maxRateLimitCooldownMs) || 15 * 60_000);
  let chain = Promise.resolve();
  let lastStartedAt = 0;
  let blockedUntil = 0;
  let consecutiveRateLimits = 0;

  async function waitForTurn() {
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastStartedAt + interval - now, blockedUntil - now);
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  }

  function reportRateLimit(retryAfterMs = 0) {
    consecutiveRateLimits += 1;
    const serverCooldown = Number(retryAfterMs);
    const fallbackCooldown = Math.min(
      defaultCooldown * (2 ** (consecutiveRateLimits - 1)),
      maxCooldown,
    );
    const cooldownMs = Number.isFinite(serverCooldown) && serverCooldown > 0
      ? serverCooldown
      : fallbackCooldown;
    blockedUntil = Math.max(blockedUntil, Date.now() + cooldownMs);
    return { cooldownMs, blockedUntil, consecutiveRateLimits };
  }

  function reportSuccess() {
    consecutiveRateLimits = 0;
  }

  return { waitForTurn, reportRateLimit, reportSuccess };
}

export function contentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function getContentTypeExtension(contentType) {
  const clean = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpeg') return '.jpg';
  if (clean === 'image/png') return '.png';
  if (clean === 'image/webp') return '.webp';
  if (clean === 'image/gif') return '.gif';
  if (clean === 'image/avif') return '.avif';
  if (clean === 'image/tiff') return '.tiff';
  return '';
}

export function inferExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext && ext.length <= 8 ? ext : '';
  } catch {
    return '';
  }
}

export async function runWithConcurrency(items, concurrency, worker, options = {}) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const shouldStart = options.shouldStart || (() => true);

  async function runWorker() {
    while (true) {
      if (!shouldStart()) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export async function retryWithBackoff(task, options) {
  const {
    retries = 4,
    baseDelayMs = 1000,
    shouldRetry = () => false,
    onRetry = () => {},
  } = options || {};

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const retryAfterMs = Number(error?.retryAfterMs);
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : (baseDelayMs * (2 ** (attempt - 1))) + jitter;
      onRetry(error, attempt, waitMs);
      await sleep(waitMs);
    }
  }
}
