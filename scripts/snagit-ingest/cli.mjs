import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

export function defaultRunLogPath(options, startedAt = new Date()) {
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

export function printUsage() {
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
