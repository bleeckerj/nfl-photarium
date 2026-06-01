import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.tmp',
  '.venv',
  'adjacent',
  'build',
  'dist',
  'node_modules',
  'out',
]);

const CATEGORY_THRESHOLDS = {
  route: { warn: 250, fail: 500 },
  component: { warn: 500, fail: 1000 },
  hook: { warn: 700, fail: 1000 },
  service: { warn: 700, fail: 1000 },
  script: { warn: 700, fail: 1000 },
  test: { warn: 800, fail: 1200 },
  source: { warn: 700, fail: 1000 },
};

const ALLOWED_OVERSIZED_FILES = new Map([
  ['mcp-server/src/legacy/runtime.ts', {
    category: 'source',
    owner: 'maintainability-refactor',
    reason: 'legacy MCP runtime deferred from first-pass app refactor',
    expires: '2026-07-15',
  }],
  ['scripts/backfill-discord-image-metadata.mjs', {
    category: 'script',
    owner: 'maintainability-refactor',
    reason: 'legacy backfill awaiting CLI/library split',
    expires: '2026-07-15',
  }],
  ['scripts/dng-ingest.mjs', {
    category: 'script',
    owner: 'maintainability-refactor',
    reason: 'legacy ingest awaiting media pipeline split',
    expires: '2026-07-15',
  }],
  ['scripts/fs-ingest.mjs', {
    category: 'script',
    owner: 'maintainability-refactor',
    reason: 'legacy ingest awaiting scanner/uploader split',
    expires: '2026-07-15',
  }],
  ['scripts/instagram-ingest.mjs', {
    category: 'script',
    owner: 'maintainability-refactor',
    reason: 'legacy ingest awaiting provider module split',
    expires: '2026-07-15',
  }],
  ['scripts/snagit-ingest.mjs', {
    category: 'script',
    owner: 'maintainability-refactor',
    reason: 'legacy ingest awaiting capture metadata split',
    expires: '2026-07-15',
  }],
  ['src/app/api/import/page/scroll/route.ts', {
    category: 'route',
    owner: 'maintainability-refactor',
    reason: 'route adapter awaiting page-import service extraction',
    expires: '2026-07-15',
  }],
  ['src/app/api/import/page/scroll/stream/route.ts', {
    category: 'route',
    owner: 'maintainability-refactor',
    reason: 'route adapter awaiting page-import service extraction',
    expires: '2026-07-15',
  }],
  ['src/app/api/images/search/route.ts', {
    category: 'route',
    owner: 'maintainability-refactor',
    reason: 'search route awaiting vector query adapter extraction',
    expires: '2026-07-15',
  }],
  ['src/app/api/upload/external/route.ts', {
    category: 'route',
    owner: 'maintainability-refactor',
    reason: 'upload route awaiting request orchestration split',
    expires: '2026-07-15',
  }],
  ['src/app/images/[id]/page.tsx', {
    category: 'component',
    owner: 'maintainability-refactor',
    reason: 'image detail page awaiting workflow hook extraction',
    expires: '2026-07-15',
  }],
  ['src/app/videos/[id]/page.tsx', {
    category: 'component',
    owner: 'maintainability-refactor',
    reason: 'video detail page awaiting workflow hook extraction',
    expires: '2026-07-15',
  }],
  ['src/components/ImageGallery.tsx', {
    category: 'component',
    owner: 'maintainability-refactor',
    reason: 'gallery shell awaiting state/helper extraction',
    expires: '2026-07-15',
  }],
  ['src/components/ImageUploader.tsx', {
    category: 'component',
    owner: 'maintainability-refactor',
    reason: 'uploader shell awaiting archive/queue helper extraction',
    expires: '2026-07-15',
  }],
  ['src/components/gallery/ImageGallery.tsx', {
    category: 'component',
    owner: 'maintainability-refactor',
    reason: 'legacy gallery component awaiting consolidation',
    expires: '2026-07-15',
  }],
  ['src/server/cloudflareImageCache.ts', {
    category: 'service',
    owner: 'maintainability-refactor',
    reason: 'cache service awaiting storage/fetch split',
    expires: '2026-07-15',
  }],
  ['src/server/vectorSearch.ts', {
    category: 'service',
    owner: 'maintainability-refactor',
    reason: 'vector service awaiting provider/query split',
    expires: '2026-07-15',
  }],
]);

const color = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
};

const useColor = process.stdout.isTTY && process.env.NO_COLOR !== '1';
const paint = (value, code) => (useColor ? `${code}${value}${color.reset}` : value);

function categorizeFile(file) {
  const basename = path.basename(file);
  if (file.includes('__tests__/') || basename.includes('.test.')) return 'test';
  if (file.startsWith('scripts/')) return 'script';
  if (file.endsWith('/route.ts') || file.endsWith('/route.tsx')) return 'route';
  if (basename.startsWith('use') && (file.includes('/hooks/') || file.includes('/components/'))) return 'hook';
  if (file.includes('/server/') || file.includes('/services/') || basename.endsWith('Service.ts')) return 'service';
  if (file.endsWith('.tsx') && (file.includes('/components/') || file.includes('/app/'))) return 'component';
  return 'source';
}

function parseDate(value) {
  const timestamp = Date.parse(`${value}T23:59:59Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function validateAllowlistEntry(file, entry, category) {
  const problems = [];
  if (!entry) return problems;
  if (!entry.owner) problems.push('missing owner');
  if (!entry.reason) problems.push('missing reason');
  if (!entry.expires) {
    problems.push('missing expiry');
  } else {
    const expiresAt = parseDate(entry.expires);
    if (expiresAt === null) problems.push(`invalid expiry ${entry.expires}`);
    if (expiresAt !== null && expiresAt < Date.now()) problems.push(`expired ${entry.expires}`);
  }
  if (entry.category && entry.category !== category) {
    problems.push(`category mismatch allowlist=${entry.category} detected=${category}`);
  }
  if (!CATEGORY_THRESHOLDS[entry.category || category]) {
    problems.push(`unknown category ${entry.category || category}`);
  }
  if (problems.length > 0) {
    console.error(paint(`[size-audit] invalid allowlist entry for ${file}: ${problems.join(', ')}`, color.red));
  }
  return problems;
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT, absolutePath);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (relativePath === 'mcp-server/dist') continue;
      files.push(...await collectFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

async function countLines(relativePath) {
  const contents = await readFile(path.join(ROOT, relativePath), 'utf8');
  if (!contents) return 0;
  return contents.endsWith('\n')
    ? contents.split('\n').length - 1
    : contents.split('\n').length;
}

const files = await collectFiles(ROOT);
const reports = [];
const unusedAllowlist = new Set(ALLOWED_OVERSIZED_FILES.keys());
let invalidAllowlistEntries = 0;

for (const file of files) {
  const lines = await countLines(file);
  const category = categorizeFile(file);
  const thresholds = CATEGORY_THRESHOLDS[category];
  if (lines <= thresholds.warn) continue;
  const allowlistEntry = ALLOWED_OVERSIZED_FILES.get(file);
  unusedAllowlist.delete(file);
  const allowlistProblems = validateAllowlistEntry(file, allowlistEntry, category);
  invalidAllowlistEntries += allowlistProblems.length;
  reports.push({ file, lines, category, thresholds, allowlistEntry, allowlistProblems });
}

reports.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

if (unusedAllowlist.size > 0) {
  for (const file of [...unusedAllowlist].sort()) {
    console.error(paint(`[size-audit] stale allowlist entry: ${file}`, color.red));
  }
  invalidAllowlistEntries += unusedAllowlist.size;
}

if (reports.length === 0) {
  console.log(paint('[size-audit] ok: no tracked source files exceed category warning thresholds', color.cyan));
  process.exit(invalidAllowlistEntries > 0 ? 1 : 0);
}

console.log('[size-audit] category thresholds: route 250/500, component 500/1000, hook-service-script 700/1000, test 800/1200');

let failures = invalidAllowlistEntries;
let allowedCount = 0;
for (const report of reports) {
  const overFailureLimit = report.lines > report.thresholds.fail;
  const allowed = Boolean(report.allowlistEntry) && report.allowlistProblems.length === 0;
  if (overFailureLimit && !allowed) failures += 1;
  if (overFailureLimit && allowed) allowedCount += 1;

  const status = overFailureLimit
    ? allowed ? paint('ALLOW', color.cyan) : paint('FAIL ', color.red)
    : paint('WARN ', color.yellow);
  const threshold = `${report.category} ${report.thresholds.warn}/${report.thresholds.fail}`;
  const details = allowed
    ? paint(` (${report.allowlistEntry.owner}; expires ${report.allowlistEntry.expires}; ${report.allowlistEntry.reason})`, color.gray)
    : '';
  console.log(`${status} ${String(report.lines).padStart(5)} ${report.file} ${paint(`[${threshold}]`, color.gray)}${details}`);
}

if (failures > 0) {
  console.error(paint(`[size-audit] failed: ${failures} file(s) exceed limits or have invalid allowlist entries`, color.red));
  process.exit(1);
}

console.log(paint(`[size-audit] passed with warnings and ${allowedCount} temporary allowlist entries`, color.cyan));
