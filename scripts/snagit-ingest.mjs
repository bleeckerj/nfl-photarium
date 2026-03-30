#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);

const DEFAULT_NAMESPACE = 'cf-snagit-archive';
const DEFAULT_API_BASE = 'http://localhost:3000';
const DEFAULT_THROTTLE_MS = 1500;
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_HYDRATE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PROBE_MAX_FILES = 10;
const DEFAULT_PROBE_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_PROBE_READ_BYTES = 64 * 1024;
const DEFAULT_RETAINED_HYDRATED_BYTES_CAP = 8 * 1024 * 1024 * 1024;
const DEFAULT_EVICT_FAILURE_CAP = 5;
const DEFAULT_EVICT_VERIFY_TIMEOUT_MS = 30 * 1000;

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
  '.snagx',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.ogv',
  '.ogg',
]);

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.snagx': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
};

const PROVIDER_HINT_SEGMENTS = [
  'dropbox',
  'cloudstorage',
  'file provider',
];

export const PROBE_VERDICTS = {
  supported: 'automated_hydrate_and_evict_supported',
  evictUnreliable: 'hydrate_supported_evict_unreliable',
  manualStage: 'hydrate_unsupported_manual_stage_required',
};

const supportsColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const color = {
  dim: (value) => (supportsColor ? `\x1b[2m${value}\x1b[0m` : value),
  cyan: (value) => (supportsColor ? `\x1b[36m${value}\x1b[0m` : value),
  blue: (value) => (supportsColor ? `\x1b[34m${value}\x1b[0m` : value),
  magenta: (value) => (supportsColor ? `\x1b[35m${value}\x1b[0m` : value),
  yellow: (value) => (supportsColor ? `\x1b[33m${value}\x1b[0m` : value),
  green: (value) => (supportsColor ? `\x1b[32m${value}\x1b[0m` : value),
  red: (value) => (supportsColor ? `\x1b[31m${value}\x1b[0m` : value),
  bold: (value) => (supportsColor ? `\x1b[1m${value}\x1b[0m` : value),
  white: (value) => (supportsColor ? `\x1b[97m${value}\x1b[0m` : value),
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kv(label, value, labelColor = color.cyan, valueColor = color.white) {
  return `${labelColor(label)}=${valueColor(String(value))}`;
}

function sanitizeFilenameBase(value) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed || 'snagit-image';
}

function sanitizePathSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'default';
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function normalizePath(inputPath) {
  return path.resolve(expandHome(inputPath));
}

function normalizeRelativePath(relPath) {
  return String(relPath || '').split(path.sep).join('/');
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function printUsage() {
  console.log(`Snagit Archive Ingest CLI

Usage:
  node scripts/snagit-ingest.mjs probe --root <dir> [--root <dir> ...] [options]
  node scripts/snagit-ingest.mjs ingest --root <dir> [--root <dir> ...] [options]
  npm run snagit:ingest -- <probe|ingest> --root <dir> [options]

Commands:
  probe                      Validate hydrate/evict behavior on a tiny sample
  ingest                     Ingest Snagit files into Photarium one file at a time

Common options:
  --root <dir>               Root directory to scan (repeatable, required)
  --namespace <name>         Target namespace (default: ${DEFAULT_NAMESPACE})
  --api-base <url>           API base URL (default: ${DEFAULT_API_BASE})
  --provider-mode <mode>     auto | manual-stage (default: auto)
  --throttle-ms <n>          Delay between upload attempts (default: ${DEFAULT_THROTTLE_MS})
  --heartbeat-ms <n>         Heartbeat interval while waiting (default: ${DEFAULT_HEARTBEAT_MS})
  --hydrate-timeout-ms <n>   Max wait for hydration (default: ${DEFAULT_HYDRATE_TIMEOUT_MS})
  --folder <name>            Optional folder value for uploaded assets
  --tags <csv>               Extra tags to append after built-in snagit tags
  --checkpoint-file <path>   Override ingest checkpoint file path
  --run-log-file <path>      Override ingest NDJSON run log path
  --no-embeddings            Skip explicit embedding calls after upload
  --dry-run                  Log work without mutating Photarium or checkpoints
  --no-timestamps            Disable log timestamps
  --quiet                    Reduce stdout output
  --help, -h                 Show this help

Probe options:
  --probe-max-files <n>      Max files to probe (default: ${DEFAULT_PROBE_MAX_FILES})
  --probe-max-bytes <n>      Max total selected bytes to probe (default: ${DEFAULT_PROBE_MAX_BYTES})
  --probe-read-bytes <n>     Prefix bytes to read after hydrate (default: ${DEFAULT_PROBE_READ_BYTES})
  --report-prefix <path>     Probe report path prefix (writes .json and .ndjson)

Ingest options:
  --resume                   Resume from checkpoint (default)
  --no-resume                Ignore prior checkpoint state
  --tranche-max-files <n>    Stop after this many actionable files
  --tranche-max-bytes <n>    Stop after this many actionable bytes
  --tranche-max-minutes <n>  Stop after this many elapsed minutes
  --retained-hydrated-bytes-cap <n>  Stop if failed evicts retain too many bytes
  --evict-failure-cap <n>    Stop after repeated evict failures

Examples:
  npm run snagit:ingest -- probe --root ~/Dropbox/Snagit
  npm run snagit:ingest -- ingest --root ~/Dropbox/Snagit --provider-mode auto
  npm run snagit:ingest -- ingest --root ~/Dropbox/Snagit --provider-mode manual-stage --tranche-max-files 250
`);
}

function parseInteger(raw, flag, { min = 0, allowInfinity = false } = {}) {
  if (allowInfinity && (raw === 'Infinity' || raw === 'inf')) return Infinity;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${flag}: ${raw}`);
  }
  return parsed;
}

function parseFloatMinutes(raw, flag) {
  const parsed = Number.parseFloat(String(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${raw}`);
  }
  return parsed;
}

function splitCsv(value) {
  return Array.from(new Set(String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)));
}

function normalizeProviderMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'manual-stage') return normalized;
  throw new Error(`Invalid --provider-mode value: ${value}`);
}

function selectorFingerprint(roots, namespace, command) {
  return createHash('sha1')
    .update(JSON.stringify({
      command,
      namespace,
      roots: [...roots].sort(),
    }))
    .digest('hex')
    .slice(0, 16);
}

export function defaultCheckpointPath(options) {
  const fingerprint = selectorFingerprint(options.roots, options.namespace, 'ingest');
  return path.resolve(
    'data',
    'snagit-ingest',
    'checkpoints',
    `snagit-ingest.${sanitizePathSegment(options.namespace)}.${fingerprint}.json`
  );
}

function defaultRunLogPath(options, startedAt = new Date()) {
  const timestamp = startedAt.toISOString().replace(/[:]/g, '-');
  return path.resolve(
    'data',
    'snagit-ingest',
    'runs',
    `snagit-ingest.${sanitizePathSegment(options.namespace)}.${timestamp}.ndjson`
  );
}

export function defaultProbeReportBase(options, startedAt = new Date()) {
  const timestamp = startedAt.toISOString().replace(/[:]/g, '-');
  const fingerprint = selectorFingerprint(options.roots, options.namespace, 'probe');
  return path.resolve(
    'data',
    'snagit-ingest',
    'probes',
    `snagit-probe.${fingerprint}.${timestamp}`
  );
}

export function parseArgs(argv) {
  const raw = [...argv];
  const first = raw[0];
  const command = first && !first.startsWith('-') ? raw.shift() : 'ingest';
  const options = {
    command,
    roots: [],
    namespace: DEFAULT_NAMESPACE,
    apiBase: DEFAULT_API_BASE,
    providerMode: 'auto',
    throttleMs: DEFAULT_THROTTLE_MS,
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
    hydrateTimeoutMs: DEFAULT_HYDRATE_TIMEOUT_MS,
    folder: '',
    tagsCsv: '',
    checkpointFile: '',
    runLogFile: '',
    reportPrefix: '',
    ensureEmbeddings: true,
    timestamps: true,
    verbose: true,
    dryRun: false,
    resume: true,
    probeMaxFiles: DEFAULT_PROBE_MAX_FILES,
    probeMaxBytes: DEFAULT_PROBE_MAX_BYTES,
    probeReadBytes: DEFAULT_PROBE_READ_BYTES,
    trancheMaxFiles: Infinity,
    trancheMaxBytes: Infinity,
    trancheMaxMinutes: Infinity,
    retainedHydratedBytesCap: DEFAULT_RETAINED_HYDRATED_BYTES_CAP,
    evictFailureCap: DEFAULT_EVICT_FAILURE_CAP,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    const next = raw[index + 1];

    const requireValue = (flag) => {
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
      }
      index += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--root') {
      options.roots.push(normalizePath(requireValue(arg)));
      continue;
    }
    if (arg === '--namespace') {
      options.namespace = String(requireValue(arg)).trim() || DEFAULT_NAMESPACE;
      continue;
    }
    if (arg === '--api-base') {
      options.apiBase = String(requireValue(arg)).trim().replace(/\/+$/, '');
      continue;
    }
    if (arg === '--provider-mode') {
      options.providerMode = normalizeProviderMode(requireValue(arg));
      continue;
    }
    if (arg === '--throttle-ms') {
      options.throttleMs = parseInteger(requireValue(arg), arg, { min: 0 });
      continue;
    }
    if (arg === '--heartbeat-ms') {
      options.heartbeatMs = parseInteger(requireValue(arg), arg, { min: 250 });
      continue;
    }
    if (arg === '--hydrate-timeout-ms') {
      options.hydrateTimeoutMs = parseInteger(requireValue(arg), arg, { min: 1000 });
      continue;
    }
    if (arg === '--folder') {
      options.folder = String(requireValue(arg)).trim();
      continue;
    }
    if (arg === '--tags') {
      options.tagsCsv = String(requireValue(arg));
      continue;
    }
    if (arg === '--checkpoint-file') {
      options.checkpointFile = normalizePath(requireValue(arg));
      continue;
    }
    if (arg === '--run-log-file') {
      options.runLogFile = normalizePath(requireValue(arg));
      continue;
    }
    if (arg === '--report-prefix') {
      options.reportPrefix = normalizePath(requireValue(arg));
      continue;
    }
    if (arg === '--probe-max-files') {
      options.probeMaxFiles = parseInteger(requireValue(arg), arg, { min: 1 });
      continue;
    }
    if (arg === '--probe-max-bytes') {
      options.probeMaxBytes = parseInteger(requireValue(arg), arg, { min: 1, allowInfinity: true });
      continue;
    }
    if (arg === '--probe-read-bytes') {
      options.probeReadBytes = parseInteger(requireValue(arg), arg, { min: 1 });
      continue;
    }
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (arg === '--no-resume') {
      options.resume = false;
      continue;
    }
    if (arg === '--tranche-max-files') {
      options.trancheMaxFiles = parseInteger(requireValue(arg), arg, { min: 1, allowInfinity: true });
      continue;
    }
    if (arg === '--tranche-max-bytes') {
      options.trancheMaxBytes = parseInteger(requireValue(arg), arg, { min: 1, allowInfinity: true });
      continue;
    }
    if (arg === '--tranche-max-minutes') {
      options.trancheMaxMinutes = parseFloatMinutes(requireValue(arg), arg);
      continue;
    }
    if (arg === '--retained-hydrated-bytes-cap') {
      options.retainedHydratedBytesCap = parseInteger(requireValue(arg), arg, { min: 1, allowInfinity: true });
      continue;
    }
    if (arg === '--evict-failure-cap') {
      options.evictFailureCap = parseInteger(requireValue(arg), arg, { min: 1 });
      continue;
    }
    if (arg === '--no-embeddings') {
      options.ensureEmbeddings = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-timestamps') {
      options.timestamps = false;
      continue;
    }
    if (arg === '--quiet') {
      options.verbose = false;
      options.quiet = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (command !== 'probe' && command !== 'ingest') {
    throw new Error(`Unknown command: ${command}`);
  }
  if (options.roots.length === 0 && !options.help) {
    throw new Error('At least one --root is required');
  }
  options.roots = Array.from(new Set(options.roots));
  if (options.command === 'ingest') {
    options.checkpointFile = options.checkpointFile || defaultCheckpointPath(options);
  }
  return options;
}

function createLogger({ verbose = true, timestamps = true, quiet = false } = {}) {
  const emit = (tag, tagColor, message) => {
    const parts = [];
    if (timestamps) parts.push(color.dim(nowIso()));
    parts.push(tagColor(tag));
    parts.push(message);
    console.log(parts.join(' '));
  };

  return {
    banner(message) {
      if (quiet) return;
      emit('[snagit]', color.bold, color.bold(message));
    },
    info(message) {
      if (quiet) return;
      emit('[info]', color.cyan, message);
    },
    success(message) {
      if (quiet) return;
      emit('[ok]', color.green, message);
    },
    warn(message) {
      emit('[warn]', color.yellow, message);
    },
    error(message) {
      emit('[fail]', color.red, message);
    },
    debug(message) {
      if (!verbose) return;
      emit('[debug]', color.magenta, message);
    },
    heartbeat(message) {
      if (quiet) return;
      emit('[beat]', color.blue, message);
    },
  };
}

function sourceTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.snagx') return 'snagx';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function assetKindForSourceType(sourceType) {
  return sourceType === 'video' ? 'video' : 'image';
}

function pathHasProviderHint(filePath) {
  const normalized = String(filePath || '').toLowerCase();
  return PROVIDER_HINT_SEGMENTS.some((segment) => normalized.includes(segment));
}

async function readXattrNames(filePath) {
  try {
    const result = await execFileAsync('xattr', [filePath], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return String(result.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasDropboxPlaceholderXattr(xattrNames) {
  return Array.isArray(xattrNames) && xattrNames.includes('com.dropbox.placeholder');
}

function hasDropboxProviderXattr(xattrNames) {
  return Array.isArray(xattrNames) && xattrNames.some((name) => name.startsWith('com.dropbox.'));
}

export function deriveProviderFileState({ filePath, stat, xattrNames }) {
  const dropboxProvider = hasDropboxProviderXattr(xattrNames);
  const placeholderByXattr = hasDropboxPlaceholderXattr(xattrNames);
  const fallbackPathHint = !dropboxProvider && pathHasProviderHint(filePath);
  const placeholderLikely = Boolean(
    placeholderByXattr
    || (dropboxProvider && stat && stat.size === 0)
    || (!xattrNames?.length && fallbackPathHint && stat && stat.size === 0)
  );

  return {
    providerHint: dropboxProvider || fallbackPathHint,
    placeholderLikely,
  };
}

async function detectProviderFileState(filePath, stat) {
  const xattrNames = (
    stat?.size === 0 || pathHasProviderHint(filePath)
  ) ? await readXattrNames(filePath) : [];

  const derived = deriveProviderFileState({
    filePath,
    stat,
    xattrNames,
  });

  return {
    providerHint: derived.providerHint,
    xattrNames,
    placeholderLikely: derived.placeholderLikely,
  };
}

function stableRootKey(rootDir) {
  return createHash('sha1').update(path.resolve(rootDir)).digest('hex').slice(0, 16);
}

function checkpointEntryKey(rootDir, relPath) {
  return `${stableRootKey(rootDir)}\n${normalizeRelativePath(relPath)}`;
}

function hashEntryKey(namespace, assetKind, sourceContentHash) {
  return `${namespace}\n${assetKind}\n${sourceContentHash}`;
}

function buildCheckpointShape(options) {
  return {
    schemaVersion: 1,
    namespace: options.namespace,
    roots: [...options.roots],
    providerMode: options.providerMode,
    updatedAt: nowIso(),
    entries: {},
    hashEntries: {},
  };
}

async function loadCheckpoint(filePath, options) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return buildCheckpointShape(options);
    return {
      schemaVersion: 1,
      namespace: parsed.namespace || options.namespace,
      roots: Array.isArray(parsed.roots) ? parsed.roots : [...options.roots],
      providerMode: parsed.providerMode || options.providerMode,
      updatedAt: parsed.updatedAt || nowIso(),
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
      hashEntries: parsed.hashEntries && typeof parsed.hashEntries === 'object' ? parsed.hashEntries : {},
    };
  } catch {
    return buildCheckpointShape(options);
  }
}

async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function appendRunEvent(filePath, event) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify({ at: nowIso(), ...event })}\n`, 'utf8');
}

async function saveCheckpoint(filePath, checkpoint) {
  await writeJsonAtomic(filePath, {
    ...checkpoint,
    updatedAt: nowIso(),
  });
}

async function walkSupportedFiles(roots) {
  const results = [];
  const queue = [...roots].map((rootDir) => ({ rootDir, dir: rootDir }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const { rootDir, dir } = next;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      if (entry.name.startsWith('.')) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ rootDir, dir: absolutePath });
        continue;
      }
      if (!entry.isFile()) continue;
      const sourceType = sourceTypeForFile(absolutePath);
      if (!sourceType) continue;
      results.push({
        rootDir,
        absolutePath,
        relativePath: normalizeRelativePath(path.relative(rootDir, absolutePath)),
        sourceType,
        assetKind: assetKindForSourceType(sourceType),
      });
    }
  }

  return results;
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readPrefix(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(1, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function buildLogicalSourceFingerprint(filePath, stat) {
  return {
    absolutePath: path.resolve(filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    dev: typeof stat.dev === 'number' ? stat.dev : undefined,
    ino: typeof stat.ino === 'number' ? stat.ino : undefined,
  };
}

function sourceMatchesEntry(entry, filePath, stat) {
  if (!entry || !stat) return false;
  const statMtime = Math.trunc(stat.mtimeMs);
  const samePath = String(entry.absolutePath || '') === path.resolve(filePath);
  if (!samePath) return false;
  if (entry.size === stat.size && entry.mtimeMs === statMtime) return true;

  const providerHint = pathHasProviderHint(filePath);
  if (
    providerHint &&
    stat.size === 0 &&
    typeof entry.dev === 'number' &&
    typeof entry.ino === 'number' &&
    entry.dev === stat.dev &&
    entry.ino === stat.ino &&
    entry.mtimeMs === statMtime
  ) {
    return true;
  }

  return false;
}

function sanitizeSnagitMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}

function extractSnagxInfo(buffer, originalName) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const pngEntries = entries.filter((entry) => entry.entryName.toLowerCase().endsWith('.png'));
  if (pngEntries.length === 0) {
    throw new Error('No PNG images found inside .snagx archive');
  }

  const sorted = [...pngEntries].sort((a, b) => (b.header.size || 0) - (a.header.size || 0));
  const mainEntry = sorted[0];
  const metadataEntry = entries.find((entry) => entry.entryName.toLowerCase().endsWith('metadata.json'));

  let metadata;
  let captureDate;
  if (metadataEntry) {
    try {
      const parsed = JSON.parse(metadataEntry.getData().toString('utf8'));
      metadata = sanitizeSnagitMetadata(parsed);
      if (metadata && typeof metadata.CaptureDate === 'string') {
        captureDate = metadata.CaptureDate;
      }
    } catch {
      metadata = undefined;
    }
  }

  const baseName = originalName
    ? path.basename(originalName, path.extname(originalName))
    : path.basename(mainEntry.entryName, '.png');

  return {
    captureDate,
    metadata,
    extractedFilename: `${sanitizeFilenameBase(baseName)}.png`,
  };
}

export function buildSnagitSourceRecord({
  item,
  captureDate,
  metadata,
  extractedFilename,
}) {
  const extension = path.extname(item.absolutePath).toLowerCase();
  return {
    sourceType: item.sourceType,
    originalFileName: path.basename(item.absolutePath),
    originalExtension: extension,
    captureDate,
    metadata,
    extractedFilename,
  };
}

function formatSourcePath(filePath) {
  const absolute = path.resolve(filePath).split(path.sep).join('/');
  return {
    absolute: `local://${absolute}`,
    fileUrl: pathToFileURL(path.resolve(filePath)).toString(),
  };
}

function buildRawSourceRecord(item, stat, sourceContentHash, capturedAt) {
  const absolutePath = path.resolve(item.absolutePath);
  const fingerprint = createHash('sha1')
    .update([
      sourceContentHash,
      stat.size,
      Math.trunc(stat.mtimeMs),
      stat.dev || '',
      stat.ino || '',
    ].join('\n'))
    .digest('hex');

  return {
    absolutePath,
    relativePath: item.relativePath,
    pathHash: createHash('sha256').update(absolutePath).digest('hex'),
    contentHash: sourceContentHash,
    fingerprint,
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    dev: typeof stat.dev === 'number' ? stat.dev : undefined,
    ino: typeof stat.ino === 'number' ? stat.ino : undefined,
    capturedAt,
  };
}

function buildImageExtrasPayload({ item, stat, sourceContentHash, snagitInfo, capturedAt }) {
  return {
    rawSource: buildRawSourceRecord(item, stat, sourceContentHash, capturedAt),
    snagitSource: buildSnagitSourceRecord({
      item,
      captureDate: snagitInfo?.captureDate,
      metadata: snagitInfo?.metadata,
      extractedFilename: snagitInfo?.extractedFilename,
    }),
  };
}

function buildBaseTags(item, extraTags) {
  const tags = ['snagit', ...extraTags];
  if (item.sourceType === 'snagx') tags.push('snagx');
  return Array.from(new Set(tags.filter(Boolean)));
}

async function uploadImageFile({
  apiBase,
  item,
  bytes,
  namespace,
  folder,
  tags,
  duplicateAction,
}) {
  const sourcePath = formatSourcePath(item.absolutePath);
  const ext = path.extname(item.absolutePath).toLowerCase();
  const fileName = path.basename(item.absolutePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: MIME_BY_EXTENSION[ext] || 'application/octet-stream' }), fileName);
  form.append('namespace', namespace);
  if (folder) form.append('folder', folder);
  if (tags.length > 0) form.append('tags', tags.join(','));
  form.append('sourceUrl', sourcePath.absolute);
  form.append('originalUrl', sourcePath.fileUrl);
  if (duplicateAction) form.append('duplicateAction', duplicateAction);

  const response = await fetch(`${apiBase}/api/upload/external`, {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function uploadVideoFile({
  apiBase,
  item,
  bytes,
  namespace,
  folder,
  tags,
}) {
  const sourcePath = formatSourcePath(item.absolutePath);
  const ext = path.extname(item.absolutePath).toLowerCase();
  const fileName = path.basename(item.absolutePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: MIME_BY_EXTENSION[ext] || 'video/mp4' }), fileName);
  form.append('namespace', namespace);
  if (folder) form.append('folder', folder);
  if (tags.length > 0) form.append('tags', tags.join(','));
  form.append('sourceUrl', sourcePath.absolute);
  form.append('originalUrl', sourcePath.fileUrl);

  const response = await fetch(`${apiBase}/api/import/page/upload-video`, {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function patchImageExtras({ apiBase, imageId, payload }) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/extras`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `extras PATCH failed (${response.status})`);
  }
  return data;
}

async function ensureImageEmbeddings({ apiBase, imageId }) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clip: true, color: true, force: false }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `image embeddings POST failed (${response.status})`);
  }
  return data;
}

async function ensureVideoEmbeddings({ apiBase, videoId }) {
  const response = await fetch(`${apiBase}/api/videos/${encodeURIComponent(videoId)}`, {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `video embeddings POST failed (${response.status})`);
  }
  return data;
}

async function waitForThrottle(lastActionAt, throttleMs) {
  if (throttleMs <= 0) return Date.now();
  const waitMs = Math.max(0, (lastActionAt + throttleMs) - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return Date.now();
}

export function classifyProbeCapability(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const hydrateSuccesses = results.filter((result) => result.hydrated === true);
  if (hydrateSuccesses.length === 0) {
    return PROBE_VERDICTS.manualStage;
  }
  const allEvicted = hydrateSuccesses.every((result) => result.placeholderAfterEvict === true);
  if (allEvicted) {
    return PROBE_VERDICTS.supported;
  }
  return PROBE_VERDICTS.evictUnreliable;
}

export function nextPendingIngestPhase(entry, { assetKind, ensureEmbeddings }) {
  const phases = entry?.phases || {};
  const uploadStatus = phases.upload?.status || 'pending';
  if (!['uploaded', 'duplicate', 'skipped-by-hash'].includes(uploadStatus)) {
    return 'upload';
  }
  if (assetKind === 'image') {
    const extrasStatus = phases.extras?.status || 'pending';
    if (!['done', 'skipped'].includes(extrasStatus)) {
      return 'extras';
    }
  }
  if (ensureEmbeddings) {
    const embeddingStatus = phases.embeddings?.status || 'pending';
    if (!['done', 'skipped'].includes(embeddingStatus)) {
      return 'embeddings';
    }
  }
  return null;
}

export function shouldStopForTranche(progress, options) {
  if (progress.actionedFiles >= options.trancheMaxFiles) {
    return `tranche-max-files=${options.trancheMaxFiles}`;
  }
  if (progress.actionedBytes >= options.trancheMaxBytes) {
    return `tranche-max-bytes=${options.trancheMaxBytes}`;
  }
  const elapsedMinutes = (Date.now() - progress.startedAt) / 60000;
  if (elapsedMinutes >= options.trancheMaxMinutes) {
    return `tranche-max-minutes=${options.trancheMaxMinutes}`;
  }
  return null;
}

function buildProviderCommandLabel(command, args) {
  return [command, ...args.map((value) => JSON.stringify(String(value)))].join(' ');
}

function summarizeCommandError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  const message = error instanceof Error ? error.message : String(error);
  return [message, stderr, stdout].filter(Boolean).join(' | ');
}

function isUnsupportedProviderError(errorMessage) {
  const value = String(errorMessage || '').toLowerCase();
  return (
    value.includes('sandboxed process') ||
    value.includes('unknown command') ||
    value.includes('usage:') ||
    value.includes('not found') ||
    value.includes('no such file or directory')
  );
}

async function runProviderCommand(command, args, timeoutMs, logger) {
  const label = buildProviderCommandLabel(command, args);
  logger.debug(`provider command: ${label}`);
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      ok: true,
      supported: true,
      command: label,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (error) {
    const message = summarizeCommandError(error);
    return {
      ok: false,
      supported: !isUnsupportedProviderError(message),
      command: label,
      error: message,
    };
  }
}

async function waitForReadableMedia(filePath, options, logger) {
  const startedAt = Date.now();
  let nextHeartbeatAt = startedAt + options.heartbeatMs;
  let lastError = '';
  while ((Date.now() - startedAt) < options.hydrateTimeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 0) {
        const prefix = await readPrefix(filePath, Math.min(options.probeReadBytes, 4096));
        if (prefix.length > 0 || stat.size > 0) {
          return {
            ok: true,
            stat,
            elapsedMs: Date.now() - startedAt,
            bytesRead: prefix.length,
          };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() >= nextHeartbeatAt) {
      logger.heartbeat(`waiting for hydrate: ${filePath} elapsed=${Date.now() - startedAt}ms`);
      nextHeartbeatAt += options.heartbeatMs;
    }
    await sleep(1000);
  }

  return {
    ok: false,
    error: lastError || `Timed out waiting for hydrated bytes after ${options.hydrateTimeoutMs}ms`,
    elapsedMs: Date.now() - startedAt,
  };
}

async function waitForPlaceholderState(filePath, timeoutMs, logger) {
  const startedAt = Date.now();
  let nextHeartbeatAt = startedAt + DEFAULT_HEARTBEAT_MS;
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size === 0) {
        return {
          ok: true,
          stat,
          elapsedMs: Date.now() - startedAt,
        };
      }
    } catch (error) {
      logger.debug(`placeholder verify stat failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (Date.now() >= nextHeartbeatAt) {
      logger.heartbeat(`waiting for placeholder state: ${filePath} elapsed=${Date.now() - startedAt}ms`);
      nextHeartbeatAt += DEFAULT_HEARTBEAT_MS;
    }
    await sleep(1000);
  }

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
  };
}

async function hydrateFileIfNeeded(item, stat, options, logger) {
  const providerState = await detectProviderFileState(item.absolutePath, stat);
  const placeholderLikely = providerState.placeholderLikely;

  if (!placeholderLikely) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: null,
      commandSupported: true,
      stat,
      bytesRead: 0,
    };
  }

  if (options.providerMode === 'manual-stage') {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: null,
      commandSupported: false,
      error: 'Provider mode is manual-stage and file appears to be online-only',
    };
  }

  const commandResult = await runProviderCommand(
    'fileproviderctl',
    ['materialize', item.absolutePath],
    Math.max(30_000, options.hydrateTimeoutMs),
    logger
  );

  if (!commandResult.ok) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: commandResult.command,
      commandSupported: commandResult.supported,
      error: commandResult.error || 'Hydrate command failed',
    };
  }

  const waitResult = await waitForReadableMedia(item.absolutePath, options, logger);
  if (!waitResult.ok) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: commandResult.command,
      commandSupported: commandResult.supported,
      error: waitResult.error || commandResult.error || 'Hydrate wait failed',
    };
  }

  return {
    placeholderLikely,
    providerHint: providerState.providerHint,
    xattrNames: providerState.xattrNames,
    hydratedByScript: true,
    commandAttempted: commandResult.command,
    commandSupported: commandResult.supported,
    stat: waitResult.stat,
    bytesRead: waitResult.bytesRead,
    hydrateElapsedMs: waitResult.elapsedMs,
  };
}

async function evictHydratedFile(item, options, logger) {
  if (options.providerMode !== 'auto') {
    return { status: 'skipped', placeholderAfterEvict: false, command: null };
  }

  const attempts = [
    ['fileproviderctl', ['evict', item.absolutePath]],
    ['brctl', ['evict', item.absolutePath]],
  ];

  let lastFailure = null;
  for (const [command, args] of attempts) {
    const result = await runProviderCommand(command, args, DEFAULT_EVICT_VERIFY_TIMEOUT_MS, logger);
    if (!result.ok) {
      lastFailure = result;
      if (!result.supported) continue;
      return {
        status: 'failed',
        placeholderAfterEvict: false,
        command: result.command,
        error: result.error,
      };
    }

    const verify = await waitForPlaceholderState(item.absolutePath, DEFAULT_EVICT_VERIFY_TIMEOUT_MS, logger);
    if (verify.ok) {
      return {
        status: 'done',
        placeholderAfterEvict: true,
        command: result.command,
      };
    }

    return {
      status: 'failed',
      placeholderAfterEvict: false,
      command: result.command,
      error: 'Evict command returned successfully but file did not return to placeholder state',
    };
  }

  return {
    status: lastFailure?.supported === false ? 'unsupported' : 'failed',
    placeholderAfterEvict: false,
    command: lastFailure?.command || null,
    error: lastFailure?.error || 'No working evict command found',
  };
}

async function buildProbeSelection(files, statsByPath, options) {
  const selected = [];
  let totalBytes = 0;
  for (const item of files) {
    const stat = statsByPath.get(item.absolutePath);
    if (!stat) continue;
    const providerState = await detectProviderFileState(item.absolutePath, stat);
    const placeholderLikely = providerState.placeholderLikely;
    if (!placeholderLikely) continue;
    if (selected.length >= options.probeMaxFiles) break;
    const proposed = totalBytes + Math.max(1, stat.size);
    if (proposed > options.probeMaxBytes && selected.length > 0) break;
    selected.push(item);
    totalBytes = proposed;
  }
  return {
    selected,
    totalBytes,
  };
}

async function runProbe(options, logger) {
  logger.banner('Snagit provider probe');
  logger.info(`roots=${options.roots.join(', ')}`);
  const files = await walkSupportedFiles(options.roots);
  const statsByPath = new Map();
  for (const item of files) {
    const stat = await statSafe(item.absolutePath);
    if (stat) statsByPath.set(item.absolutePath, stat);
  }

  const selection = await buildProbeSelection(files, statsByPath, options);
  const reportBase = options.reportPrefix || defaultProbeReportBase(options);
  const jsonPath = `${reportBase}.json`;
  const ndjsonPath = `${reportBase}.ndjson`;

  const summary = {
    command: 'probe',
    roots: options.roots,
    selectedCount: selection.selected.length,
    scannedCount: files.length,
    placeholderCandidates: selection.selected.length,
    capabilityVerdict: null,
    note: '',
  };

  const results = [];

  if (selection.selected.length === 0) {
    summary.note = 'no_likely_placeholders_found';
    await writeJsonAtomic(jsonPath, {
      summary,
      results,
    });
    logger.warn('No likely Dropbox/File Provider placeholders found under the supplied roots.');
    logger.info(`Probe report: ${jsonPath}`);
    return;
  }

  for (const item of selection.selected) {
    const initialStat = statsByPath.get(item.absolutePath) || await statSafe(item.absolutePath);
    if (!initialStat) continue;
    const before = {
      size: initialStat.size,
      mtimeMs: Math.trunc(initialStat.mtimeMs),
    };

    const hydrate = await hydrateFileIfNeeded(item, initialStat, options, logger);
    let afterHydrateSize = null;
    let sampleHash = null;
    let sampleBytesRead = 0;
    if (hydrate.stat) {
      afterHydrateSize = hydrate.stat.size;
      const prefix = await readPrefix(item.absolutePath, Math.min(options.probeReadBytes, hydrate.stat.size || options.probeReadBytes))
        .catch(() => Buffer.alloc(0));
      sampleBytesRead = prefix.length;
      sampleHash = prefix.length > 0 ? createHash('sha256').update(prefix).digest('hex') : null;
    }

    let evict = { status: 'skipped', placeholderAfterEvict: false, command: null, error: null };
    if (hydrate.hydratedByScript) {
      evict = await evictHydratedFile(item, options, logger);
    }

    const result = {
      path: item.absolutePath,
      relativePath: item.relativePath,
      sourceType: item.sourceType,
      providerHint: Boolean(hydrate.providerHint),
      placeholderLikely: hydrate.placeholderLikely,
      xattrNames: hydrate.xattrNames,
      before,
      hydrated: Boolean(hydrate.stat),
      hydrateCommand: hydrate.commandAttempted,
      hydrateCommandSupported: hydrate.commandSupported,
      hydrateError: hydrate.error || null,
      hydrateElapsedMs: hydrate.hydrateElapsedMs || null,
      afterHydrateSize,
      sampleBytesRead,
      sampleHash,
      evictStatus: evict.status,
      evictCommand: evict.command,
      evictError: evict.error || null,
      placeholderAfterEvict: evict.placeholderAfterEvict,
    };
    results.push(result);
    await appendRunEvent(ndjsonPath, result);
  }

  summary.capabilityVerdict = classifyProbeCapability(results);
  await writeJsonAtomic(jsonPath, {
    summary,
    results,
  });

  logger.info(`Probe verdict: ${summary.capabilityVerdict}`);
  logger.info(`Probe report: ${jsonPath}`);
}

function ensureEntryShape(existingEntry, item, stat) {
  const baseStat = stat ? buildLogicalSourceFingerprint(item.absolutePath, stat) : {};
  return {
    sourceType: item.sourceType,
    assetKind: item.assetKind,
    relativePath: item.relativePath,
    rootDir: item.rootDir,
    absolutePath: path.resolve(item.absolutePath),
    ...baseStat,
    ...existingEntry,
    phases: {
      hydrate: { status: existingEntry?.phases?.hydrate?.status || 'pending', ...existingEntry?.phases?.hydrate },
      upload: { status: existingEntry?.phases?.upload?.status || 'pending', ...existingEntry?.phases?.upload },
      extras: { status: existingEntry?.phases?.extras?.status || 'pending', ...existingEntry?.phases?.extras },
      embeddings: { status: existingEntry?.phases?.embeddings?.status || 'pending', ...existingEntry?.phases?.embeddings },
      dehydrate: { status: existingEntry?.phases?.dehydrate?.status || 'pending', ...existingEntry?.phases?.dehydrate },
    },
  };
}

function markPhase(entry, phase, patch) {
  return {
    ...entry,
    updatedAt: nowIso(),
    phases: {
      ...entry.phases,
      [phase]: {
        ...entry.phases[phase],
        ...patch,
      },
    },
  };
}

function markFreshSource(entry, item, stat, sourceContentHash) {
  const sourceFingerprint = buildLogicalSourceFingerprint(item.absolutePath, stat);
  return {
    ...entry,
    ...sourceFingerprint,
    sourceContentHash,
  };
}

function uploadResultToAssetId(outcome) {
  return outcome?.payload?.id
    || outcome?.payload?.result?.id
    || (Array.isArray(outcome?.payload?.duplicates)
      ? outcome.payload.duplicates.find((duplicate) => duplicate && typeof duplicate.id === 'string')?.id
      : undefined);
}

function uploadPhaseFromOutcome(outcome) {
  if (outcome.ok) return 'uploaded';
  if (outcome.status === 409 && Array.isArray(outcome.payload?.duplicates) && outcome.payload.duplicates.length > 0) {
    return 'duplicate';
  }
  return 'failed';
}

async function processIngestItem({
  item,
  options,
  checkpoint,
  logger,
  runState,
}) {
  const pathKey = checkpointEntryKey(item.rootDir, item.relativePath);
  const initialStat = await statSafe(item.absolutePath);
  if (!initialStat) {
    logger.warn(`missing file ${item.absolutePath}`);
    return { actioned: false, bytes: 0 };
  }

  let entry = ensureEntryShape(checkpoint.entries[pathKey], item, initialStat);
  const isComplete = nextPendingIngestPhase(entry, {
    assetKind: item.assetKind,
    ensureEmbeddings: options.ensureEmbeddings,
  }) === null;

  if (options.resume && isComplete && sourceMatchesEntry(entry, item.absolutePath, initialStat)) {
    logger.debug(`skip(cached) ${item.relativePath}`);
    return { actioned: false, bytes: 0 };
  }

  const hydrate = await hydrateFileIfNeeded(item, initialStat, options, logger);
  if (hydrate.error) {
    entry = markPhase(entry, 'hydrate', {
      status: options.providerMode === 'manual-stage' ? 'manual-stage' : 'failed',
      error: hydrate.error,
      command: hydrate.commandAttempted,
      attemptedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'hydrate-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        error: hydrate.error,
      });
    }
    logger.error(`hydrate fail ${item.relativePath} -> ${hydrate.error}`);
    return { actioned: true, failed: true, bytes: 0 };
  }

  entry = markPhase(entry, 'hydrate', {
    status: hydrate.placeholderLikely ? 'done' : 'not-needed',
    hydratedByScript: hydrate.hydratedByScript,
    command: hydrate.commandAttempted,
    attemptedAt: nowIso(),
  });

  const readableStat = hydrate.stat || initialStat;
  const sourceBytes = await fs.readFile(item.absolutePath);
  const sourceContentHash = createHash('sha256').update(sourceBytes).digest('hex');
  entry = markFreshSource(entry, item, readableStat, sourceContentHash);

  const hashKey = hashEntryKey(options.namespace, item.assetKind, sourceContentHash);
  const cachedHashEntry = checkpoint.hashEntries[hashKey];
  if (options.resume && cachedHashEntry?.status === 'complete') {
    entry = markPhase(entry, 'upload', {
      status: 'skipped-by-hash',
      assetId: cachedHashEntry.assetId,
      completedAt: nowIso(),
    });
    if (item.assetKind === 'image') {
      entry = markPhase(entry, 'extras', { status: 'done', completedAt: nowIso() });
    } else {
      entry = markPhase(entry, 'extras', { status: 'skipped', completedAt: nowIso() });
    }
    entry = markPhase(entry, 'embeddings', {
      status: options.ensureEmbeddings ? 'done' : 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'skip-hash',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId: cachedHashEntry.assetId,
      });
    }

    if (hydrate.hydratedByScript) {
      const evict = await evictHydratedFile(item, options, logger);
      entry = markPhase(entry, 'dehydrate', {
        status: evict.status,
        command: evict.command,
        error: evict.error,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      if (!options.dryRun) {
        await saveCheckpoint(options.checkpointFile, checkpoint);
      }
      if (evict.status !== 'done' && evict.status !== 'skipped' && evict.status !== 'unsupported') {
        runState.evictFailures += 1;
        runState.retainedHydratedBytes += readableStat.size;
      }
    }

    logger.info(`skip(cached-hash) ${item.relativePath} -> ${cachedHashEntry.assetId}`);
    return { actioned: true, bytes: readableStat.size };
  }

  const phase = nextPendingIngestPhase(entry, {
    assetKind: item.assetKind,
    ensureEmbeddings: options.ensureEmbeddings,
  });

  let assetId = entry.phases.upload.assetId;

  if (phase === 'upload') {
    const tags = buildBaseTags(item, splitCsv(options.tagsCsv));
    if (options.dryRun) {
      logger.info(`dry-run upload ${item.relativePath} tags=${tags.join(',')}`);
      return { actioned: true, bytes: readableStat.size };
    }

    runState.lastUploadAt = await waitForThrottle(runState.lastUploadAt, options.throttleMs);

    const outcome = item.assetKind === 'image'
      ? await uploadImageFile({
          apiBase: options.apiBase,
          item,
          bytes: sourceBytes,
          namespace: options.namespace,
          folder: options.folder || undefined,
          tags,
        })
      : await uploadVideoFile({
          apiBase: options.apiBase,
          item,
          bytes: sourceBytes,
          namespace: options.namespace,
          folder: options.folder || undefined,
          tags,
        });

    const uploadStatus = uploadPhaseFromOutcome(outcome);
    assetId = uploadResultToAssetId(outcome);
    if (uploadStatus === 'failed' || !assetId) {
      const message = outcome.payload?.error
        || outcome.payload?.message
        || `HTTP ${outcome.status}`;
      entry = markPhase(entry, 'upload', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'upload-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        error: message,
      });
      logger.error(`upload fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }

    entry = markPhase(entry, 'upload', {
      status: uploadStatus,
      assetId,
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    await saveCheckpoint(options.checkpointFile, checkpoint);
    await appendRunEvent(options.runLogFile, {
      type: uploadStatus === 'duplicate' ? 'upload-duplicate' : 'upload-ok',
      path: item.absolutePath,
      relativePath: item.relativePath,
      assetId,
    });
    logger.success(`${uploadStatus === 'duplicate' ? 'duplicate' : 'upload'} ${item.relativePath} -> ${assetId}`);
  }

  assetId = assetId || entry.phases.upload.assetId;
  if (!assetId) {
    logger.error(`missing asset id after upload for ${item.relativePath}`);
    return { actioned: true, failed: true, bytes: readableStat.size };
  }

  if (item.assetKind === 'image' && entry.phases.extras.status !== 'done') {
    if (options.dryRun) {
      logger.info(`dry-run extras ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }

    let snagitInfo = null;
    if (item.sourceType === 'snagx') {
      try {
        snagitInfo = extractSnagxInfo(sourceBytes, path.basename(item.absolutePath));
      } catch (error) {
        logger.warn(`snagx metadata parse failed ${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      await patchImageExtras({
        apiBase: options.apiBase,
        imageId: assetId,
        payload: buildImageExtrasPayload({
          item,
          stat: readableStat,
          sourceContentHash,
          snagitInfo,
          capturedAt: nowIso(),
        }),
      });
      entry = markPhase(entry, 'extras', {
        status: 'done',
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'extras-ok',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
      });
      logger.debug(`extras ok ${item.relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry = markPhase(entry, 'extras', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'extras-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
        error: message,
      });
      logger.error(`extras fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }
  } else if (item.assetKind !== 'image' && entry.phases.extras.status === 'pending') {
    entry = markPhase(entry, 'extras', {
      status: 'skipped',
      completedAt: nowIso(),
    });
  }

  if (options.ensureEmbeddings && entry.phases.embeddings.status !== 'done') {
    if (options.dryRun) {
      logger.info(`dry-run embeddings ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }

    try {
      if (item.assetKind === 'image') {
        await ensureImageEmbeddings({ apiBase: options.apiBase, imageId: assetId });
      } else {
        await ensureVideoEmbeddings({ apiBase: options.apiBase, videoId: assetId });
      }
      entry = markPhase(entry, 'embeddings', {
        status: 'done',
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      checkpoint.hashEntries[hashKey] = {
        status: 'complete',
        namespace: options.namespace,
        assetKind: item.assetKind,
        sourceContentHash,
        assetId,
        sourcePath: item.relativePath,
        completedAt: nowIso(),
      };
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'embeddings-ok',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
      });
      logger.debug(`embeddings ok ${item.relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry = markPhase(entry, 'embeddings', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'embeddings-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
        error: message,
      });
      logger.error(`embeddings fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }
  } else if (!options.ensureEmbeddings && entry.phases.embeddings.status === 'pending') {
    entry = markPhase(entry, 'embeddings', {
      status: 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    checkpoint.hashEntries[hashKey] = {
      status: 'complete',
      namespace: options.namespace,
      assetKind: item.assetKind,
      sourceContentHash,
      assetId,
      sourcePath: item.relativePath,
      completedAt: nowIso(),
    };
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
    }
  }

  if (hydrate.hydratedByScript) {
    if (options.dryRun) {
      logger.info(`dry-run dehydrate ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }
    const evict = await evictHydratedFile(item, options, logger);
    entry = markPhase(entry, 'dehydrate', {
      status: evict.status,
      command: evict.command,
      error: evict.error,
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    await saveCheckpoint(options.checkpointFile, checkpoint);
    await appendRunEvent(options.runLogFile, {
      type: 'dehydrate',
      path: item.absolutePath,
      relativePath: item.relativePath,
      assetId,
      status: evict.status,
      command: evict.command,
      error: evict.error,
    });
    if (evict.status !== 'done' && evict.status !== 'skipped' && evict.status !== 'unsupported') {
      runState.evictFailures += 1;
      runState.retainedHydratedBytes += readableStat.size;
      logger.warn(`dehydrate fail ${item.relativePath} -> ${evict.error || evict.status}`);
    } else if (evict.status === 'unsupported') {
      logger.warn(`dehydrate unsupported ${item.relativePath}`);
    } else {
      logger.debug(`dehydrate ok ${item.relativePath}`);
    }
  } else if (entry.phases.dehydrate.status === 'pending') {
    entry = markPhase(entry, 'dehydrate', {
      status: 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
  }

  return { actioned: true, bytes: readableStat.size };
}

async function runIngest(options, logger) {
  logger.banner('Snagit archive ingest');
  logger.info(`roots=${options.roots.join(', ')}`);
  logger.info(`${kv('namespace', options.namespace)} ${kv('providerMode', options.providerMode)} ${kv('throttleMs', options.throttleMs)} ${kv('heartbeatMs', options.heartbeatMs)}`);
  logger.info(`${kv('checkpoint', options.checkpointFile)} ${kv('runlog', options.runLogFile || '[auto]')}`);

  const checkpoint = await loadCheckpoint(options.checkpointFile, options);
  const runLogFile = options.runLogFile || defaultRunLogPath(options);
  options.runLogFile = runLogFile;
  const files = await walkSupportedFiles(options.roots);
  logger.info(`scan files=${files.length}`);

  const runState = {
    lastUploadAt: 0,
    evictFailures: 0,
    retainedHydratedBytes: 0,
  };
  const progress = {
    startedAt: Date.now(),
    actionedFiles: 0,
    actionedBytes: 0,
    failedFiles: 0,
  };

  for (const item of files) {
    const outcome = await processIngestItem({
      item,
      options,
      checkpoint,
      logger,
      runState,
    });

    if (outcome.actioned) {
      progress.actionedFiles += 1;
      progress.actionedBytes += outcome.bytes || 0;
    }
    if (outcome.failed) {
      progress.failedFiles += 1;
    }

    if (runState.retainedHydratedBytes >= options.retainedHydratedBytesCap) {
      logger.warn(`stopping: retained hydrated bytes cap hit (${formatBytes(runState.retainedHydratedBytes)})`);
      break;
    }
    if (runState.evictFailures >= options.evictFailureCap) {
      logger.warn(`stopping: evict failure cap hit (${runState.evictFailures})`);
      break;
    }

    const trancheStopReason = shouldStopForTranche(progress, options);
    if (trancheStopReason) {
      logger.info(`stopping: ${trancheStopReason}`);
      break;
    }
  }

  logger.info(
    `done actioned=${progress.actionedFiles} failed=${progress.failedFiles} bytes=${formatBytes(progress.actionedBytes)} retainedHydratedBytes=${formatBytes(runState.retainedHydratedBytes)} evictFailures=${runState.evictFailures}`
  );
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const logger = createLogger({
    verbose: options.verbose,
    timestamps: options.timestamps,
    quiet: options.quiet,
  });

  if (options.command === 'probe') {
    await runProbe(options, logger);
    return;
  }

  await runIngest(options, logger);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
