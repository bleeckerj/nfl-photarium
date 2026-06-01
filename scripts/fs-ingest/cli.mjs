import os from "node:os";
import path from "node:path";

export function printUsage() {
  console.log(`Recursive Filesystem Ingest CLI

Usage:
  node scripts/fs-ingest.mjs --root <dir> --namespace <name> [options]

Required:
  --root <dir>                Root directory to recursively scan
  --namespace <name>          Target namespace (required)

Options:
  --api-base <url>            API base URL (default: http://localhost:3000)
  --checkpoint-file <path>    Override checkpoint file path (share cache across roots)
  --folder <name>             Optional folder value for uploaded assets
  --tags <csv>                Base tags to apply to every file
  --append-image-tag <tag>    Optional tag appended to image tags (after AI tags)
  --hash-cache-backfill-only  Compute/write content-hash cache entries only (no uploads)
  --assume-uploaded           With --hash-cache-backfill-only, seed cache for files not in path cache
  --report-cache              Print exact checkpoint hit estimate before upload pass (path + hash cache coverage)
  --description-prefix <txt>  Prefix text prepended to description
  --include-filename          Include filename in description
  --include-path-tags         Add subdirectory names as tags
  --ai-metadata               For images: generate displayName and tags with AI
  --ai-display-name           For images: generate displayName only
  --ai-tags                   For images: generate tags only
  --tag-count <n>             AI tag count target (default: 4)
  --concurrency <n>           Parallel uploads (default: 2)
  --throttle-ms <n>          Minimum delay between upload requests (global, default: 0)
  --on-duplicate <mode>      Duplicate handling for image uploads: reject|family (default: reject)
  --limit <n>                 Stop after N matching files
  --dry-run                   Print planned uploads without uploading
  --verbose                   More logging
  --help                      Show this help

Flickr sidecar options (for "Request my Flickr data" exports):
  --sidecar-mode <none|flickr> Default: none. When 'flickr', look for photo_<id>.json
                              sidecars next to (or anywhere under) --root and use their
                              metadata to enrich uploads. Also defaults --namespace to
                              'cf-flickr' if not set.
  --sidecar-required          Fail any file that has no matching sidecar (default:
                              warn and proceed with filename/path metadata only).
  --no-folder-from-album      Don't use the photo's primary album title as its folder.
  --album-tags                Also add all album titles as lowercase tags.
  --report-sidecars           Print which files match which sidecars and exit without
                              uploading. Useful for validating coverage before a run.
  --allow-zips-in-root        Bypass the preflight that refuses to run when --root
                              contains *.zip files at its top level.

Examples:
  node scripts/fs-ingest.mjs --root ~/Code/chester-downloads-discord-images --namespace midjourney
  node scripts/fs-ingest.mjs --root ~/Code/chester-downloads-discord-images --namespace mj-archive --folder discord --ai-metadata --tag-count 4

  # Flickr export — preflight: how many photos have a matching sidecar?
  node scripts/fs-ingest.mjs --root ~/flickr-export --sidecar-mode flickr --report-sidecars

  # Flickr export — first real run, limited and into the default cf-flickr namespace
  node scripts/fs-ingest.mjs --root ~/flickr-export --sidecar-mode flickr --limit 25 --concurrency 1 -v
`);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
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
    hashCacheBackfillOnly: false,
    reportCache: false,
    assumeUploaded: false,
    descriptionPrefix: "",
    includeFilename: false,
    includePathTags: false,
    aiMetadata: false,
    aiDisplayName: false,
    aiTags: false,
    tagCount: 4,
    concurrency: 2,
    throttleMs: 0,
    onDuplicate: "reject",
    limit: 0,
    dryRun: false,
    verbose: false,
    help: false,
    sidecarMode: "none",
    sidecarRequired: false,
    folderFromAlbum: true,
    albumTags: false,
    reportSidecars: false,
    allowZipsInRoot: false,
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
    } else if (arg === "--hash-cache-backfill-only") {
      opts.hashCacheBackfillOnly = true;
    } else if (arg === "--assume-uploaded") {
      opts.assumeUploaded = true;
    } else if (arg === "--report-cache") {
      opts.reportCache = true;
    } else if (arg === "--description-prefix") {
      if (!requireValue(arg, next)) continue;
      opts.descriptionPrefix = next;
      i += 1;
    } else if (arg === "--tag-count") {
      if (!requireValue(arg, next)) continue;
      opts.tagCount = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--concurrency") {
      if (!requireValue(arg, next)) continue;
      opts.concurrency = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--throttle-ms") {
      if (!requireValue(arg, next)) continue;
      opts.throttleMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--on-duplicate") {
      if (!requireValue(arg, next)) continue;
      opts.onDuplicate = next.trim().toLowerCase();
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
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--sidecar-mode") {
      if (!requireValue(arg, next)) continue;
      opts.sidecarMode = next.trim().toLowerCase();
      i += 1;
    } else if (arg === "--sidecar-required") {
      opts.sidecarRequired = true;
    } else if (arg === "--no-folder-from-album") {
      opts.folderFromAlbum = false;
    } else if (arg === "--album-tags") {
      opts.albumTags = true;
    } else if (arg === "--report-sidecars") {
      opts.reportSidecars = true;
    } else if (arg === "--allow-zips-in-root") {
      opts.allowZipsInRoot = true;
    } else if (arg.startsWith("-")) {
      errors.push(unknownFlagMessage(arg));
    } else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  if (opts.aiMetadata) {
    opts.aiDisplayName = true;
    opts.aiTags = true;
  }
  if (!Number.isFinite(opts.tagCount) || opts.tagCount < 1) opts.tagCount = 4;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = 2;
  if (!Number.isFinite(opts.throttleMs) || opts.throttleMs < 0) opts.throttleMs = 0;
  if (!Number.isFinite(opts.limit) || opts.limit < 0) opts.limit = 0;
  if (!["reject", "family"].includes(opts.onDuplicate)) {
    errors.push(`Invalid value for --on-duplicate: ${opts.onDuplicate} (expected reject or family)`);
    opts.onDuplicate = "reject";
  }
  if (!["none", "flickr"].includes(opts.sidecarMode)) {
    errors.push(`Invalid value for --sidecar-mode: ${opts.sidecarMode} (expected none or flickr)`);
    opts.sidecarMode = "none";
  }
  if (opts.sidecarMode === "flickr" && !opts.namespace) {
    opts.namespace = "cf-flickr";
  }
  return { ...opts, errors };
}
