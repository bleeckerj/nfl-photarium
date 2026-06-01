import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const WARN_LINES = 500;
const FAIL_LINES = 1000;
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

const ALLOWED_OVERSIZED_FILES = new Map([
  // Temporary refactor allowlist: each file is a known large-file reduction target.
  ['scripts/backfill-discord-image-metadata.mjs', 'legacy script awaiting operational CLI split'],
  ['scripts/dng-ingest.mjs', 'legacy ingest script awaiting media pipeline split'],
  ['scripts/fs-ingest.mjs', 'legacy ingest script awaiting scanner/uploader split'],
  ['scripts/instagram-ingest.mjs', 'legacy ingest script awaiting provider module split'],
  ['scripts/snagit-ingest.mjs', 'legacy ingest script awaiting capture metadata split'],
  ['mcp-server/src/legacy/runtime.ts', 'legacy MCP runtime awaiting package-level split'],
  ['src/app/api/import/page/scroll/stream/route.ts', 'route adapter awaiting page-import service extraction'],
  ['src/app/images/[id]/page.tsx', 'detail page awaiting controller/helper extraction'],
  ['src/app/videos/[id]/page.tsx', 'video detail page awaiting controller/helper extraction'],
  ['src/components/ImageGallery.tsx', 'gallery shell awaiting state/helper extraction'],
  ['src/components/ImageUploader.tsx', 'uploader shell awaiting archive/queue helper extraction'],
  ['src/components/gallery/ImageGallery.tsx', 'legacy gallery component awaiting consolidation'],
  ['src/server/cloudflareImageCache.ts', 'cache service awaiting storage/fetch split'],
  ['src/server/vectorSearch.ts', 'vector service awaiting provider/query split'],
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

for (const file of files) {
  const lines = await countLines(file);
  if (lines <= WARN_LINES) continue;
  const allowedReason = ALLOWED_OVERSIZED_FILES.get(file);
  reports.push({ file, lines, allowedReason });
}

reports.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

if (reports.length === 0) {
  console.log(paint(`[size-audit] ok: no ${EXTENSIONS.size} tracked source files exceed ${WARN_LINES} lines`, color.cyan));
  process.exit(0);
}

console.log(`[size-audit] warning threshold=${WARN_LINES} lines, failure threshold=${FAIL_LINES} lines`);

let failures = 0;
for (const report of reports) {
  const overFailureLimit = report.lines > FAIL_LINES;
  const allowed = Boolean(report.allowedReason);
  if (overFailureLimit && !allowed) failures += 1;

  const status = overFailureLimit
    ? allowed ? paint('ALLOW', color.cyan) : paint('FAIL ', color.red)
    : paint('WARN ', color.yellow);
  const reason = allowed ? paint(` (${report.allowedReason})`, color.gray) : '';
  console.log(`${status} ${String(report.lines).padStart(5)} ${report.file}${reason}`);
}

if (failures > 0) {
  console.error(paint(`[size-audit] failed: ${failures} file(s) exceed ${FAIL_LINES} lines without an allowlist reason`, color.red));
  process.exit(1);
}

console.log(paint('[size-audit] passed with warnings/temporary allowlist entries', color.cyan));
