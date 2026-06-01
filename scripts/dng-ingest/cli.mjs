import os from "node:os";
import path from "node:path";

export function printUsage() {
  console.log(`Media Filesystem Ingest CLI

Usage:
  node scripts/dng-ingest.mjs --root <dir> --namespace <name> [options]
  npm run media:ingest -- --root <dir> --namespace <name> [options]

Required:
  --root <dir>                Root directory to recursively scan for media files
  --namespace <name>          Target namespace (required)

Options:
  --api-base <url>            API base URL (default: http://localhost:3000)
  --checkpoint-file <path>    Override checkpoint file path
  --folder <name>             Optional folder value for uploaded assets
  --tags <csv>                Base tags to apply to every file
  --append-image-tag <tag>    Optional tag appended to image tags (after AI tags)
  --description-prefix <txt>  Prefix text prepended to description
  --include-filename          Include filename in description
  --include-path-tags         Add subdirectory names as tags
  --ai-metadata               Generate tags with AI (displayName is preserved by default)
  --ai-display-name           Generate displayName only (from preview)
  --ai-tags                   Generate tags only (from preview)
  --tag-count <n>             AI tag count target (default: 4)
  --preview-max <px|2k|4k|original>  Max DNG preview dimension (default: original)
  --preview-format <fmt>      Preview format: webp|jpeg (default: jpeg, DNG conversion uses jpeg)
  --preview-quality <n>       Preview quality 1-100 (default: 90)
  --jpeg-quality <n>          Preview JPEG quality 1-100 (default: 90)
  --concurrency <n>           Parallel workers (default: 2)
  --throttle-ms <n>           Minimum delay between upload requests (default: 0)
  --limit <n>                 Stop after N matching files
  --no-embeddings             Do not call /api/images/:id/embeddings after upload
  --dry-run                   Print planned uploads without uploading
  --no-timestamps             Disable per-line log timestamps (enabled by default)
  --verbose                   More logging (default on)
  --quiet                     Minimal logging
  --help                      Show this help

Examples:
  npm run media:ingest -- --root ~/Photos --namespace archive --ai-metadata --tag-count 4
  npm run media:ingest -- --root ~/Photos/RAW --namespace archive --checkpoint-file ./data/dng-shared.json --include-path-tags
`);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseDimensionToken(raw) {
  const token = String(raw || "").trim().toLowerCase();
  if (token === "original" || token === "full" || token === "source") return "original";
  const match = token.match(/^(\d+)(k)?$/);
  if (!match) return Number.NaN;
  const base = Number.parseInt(match[1], 10);
  if (!Number.isFinite(base) || base < 1) return Number.NaN;
  return match[2] ? base * 1024 : base;
}

export function parseArgs(argv) {
  const opts = {
    root: "",
    namespace: "",
    apiBase: "http://localhost:3000",
    checkpointFile: "",
    folder: "",
    tagsCsv: "",
    appendImageTag: "",
    descriptionPrefix: "",
    includeFilename: false,
    includePathTags: false,
    aiMetadata: false,
    aiDisplayName: false,
    aiTags: false,
    tagCount: 4,
    previewMax: "original",
    previewFormat: "jpeg",
    previewQuality: 90,
    jpegQuality: 90,
    concurrency: 2,
    throttleMs: 0,
    limit: 0,
    ensureEmbeddings: true,
    dryRun: false,
    timestamps: true,
    verbose: true,
    help: false,
  };
  const errors = [];

  function requireValue(flag, value) {
    if (!value || value.startsWith("--")) {
      errors.push(`Missing value for ${flag}`);
      return false;
    }
    return true;
  }

  function unknownFlagMessage(flag) {
    if (flag.startsWith("--namesp")) {
      return `Unknown option: ${flag} (did you mean --namespace?)`;
    }
    return `Unknown option: ${flag}`;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--root") {
      if (!requireValue(arg, next)) continue;
      opts.root = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === "--namespace") {
      if (!requireValue(arg, next)) continue;
      opts.namespace = next.trim();
      i += 1;
    } else if (arg === "--api-base") {
      if (!requireValue(arg, next)) continue;
      opts.apiBase = next.trim().replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--checkpoint-file") {
      if (!requireValue(arg, next)) continue;
      opts.checkpointFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === "--folder") {
      if (!requireValue(arg, next)) continue;
      opts.folder = next.trim();
      i += 1;
    } else if (arg === "--tags") {
      if (!requireValue(arg, next)) continue;
      opts.tagsCsv = next;
      i += 1;
    } else if (arg === "--append-image-tag") {
      if (!requireValue(arg, next)) continue;
      opts.appendImageTag = next;
      i += 1;
    } else if (arg === "--description-prefix") {
      if (!requireValue(arg, next)) continue;
      opts.descriptionPrefix = next;
      i += 1;
    } else if (arg === "--tag-count") {
      if (!requireValue(arg, next)) continue;
      opts.tagCount = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--preview-max") {
      if (!requireValue(arg, next)) continue;
      opts.previewMax = parseDimensionToken(next);
      i += 1;
    } else if (arg === "--jpeg-quality") {
      if (!requireValue(arg, next)) continue;
      opts.jpegQuality = Number.parseInt(next, 10);
      opts.previewQuality = opts.jpegQuality;
      i += 1;
    } else if (arg === "--preview-quality") {
      if (!requireValue(arg, next)) continue;
      opts.previewQuality = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--preview-format") {
      if (!requireValue(arg, next)) continue;
      opts.previewFormat = String(next || "").trim().toLowerCase();
      i += 1;
    } else if (arg === "--concurrency") {
      if (!requireValue(arg, next)) continue;
      opts.concurrency = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--throttle-ms") {
      if (!requireValue(arg, next)) continue;
      opts.throttleMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--limit") {
      if (!requireValue(arg, next)) continue;
      opts.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--include-filename") {
      opts.includeFilename = true;
    } else if (arg === "--include-path-tags") {
      opts.includePathTags = true;
    } else if (arg === "--ai-metadata") {
      opts.aiMetadata = true;
    } else if (arg === "--ai-display-name") {
      opts.aiDisplayName = true;
    } else if (arg === "--ai-tags") {
      opts.aiTags = true;
    } else if (arg === "--no-embeddings") {
      opts.ensureEmbeddings = false;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--no-timestamps") {
      opts.timestamps = false;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--quiet") {
      opts.verbose = false;
    } else if (arg.startsWith("-")) {
      errors.push(unknownFlagMessage(arg));
    } else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  if (opts.aiMetadata) {
    opts.aiTags = true;
  }
  if (!Number.isFinite(opts.tagCount) || opts.tagCount < 1) opts.tagCount = 4;
  if (opts.previewMax !== "original" && (!Number.isFinite(opts.previewMax) || opts.previewMax < 256)) {
    opts.previewMax = "original";
  }
  if (!["webp", "jpeg", "jpg"].includes(opts.previewFormat)) opts.previewFormat = "jpeg";
  if (opts.previewFormat === "jpg") opts.previewFormat = "jpeg";
  if (!Number.isFinite(opts.previewQuality) || opts.previewQuality < 1 || opts.previewQuality > 100) opts.previewQuality = 90;
  if (!Number.isFinite(opts.jpegQuality) || opts.jpegQuality < 1 || opts.jpegQuality > 100) opts.jpegQuality = 90;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = 2;
  if (!Number.isFinite(opts.throttleMs) || opts.throttleMs < 0) opts.throttleMs = 0;
  if (!Number.isFinite(opts.limit) || opts.limit < 0) opts.limit = 0;
  if (!opts.aiDisplayName && !opts.aiTags) {
    opts.aiTags = true;
  }
  return { ...opts, errors };
}
