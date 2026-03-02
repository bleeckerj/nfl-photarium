#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv", ".ogg"]);

function printUsage() {
  console.log(`Migrate fs-ingest checkpoint entry keys from legacy relative-path keys
to root-scoped keys introduced for shared multi-root safety.

Usage:
  node scripts/migrate-fs-checkpoint-keys.mjs [options]

Options:
  --checkpoint-file <path>       Checkpoint JSON to migrate
                                 (default: data/fs-ingest-checkpoints/discord-shared-multi-namespace.json)
  --images-root <path>           Discord images root containing channel folders
                                 (default: ~/Code/chester-downloads-discord-images/images)
  --default-namespace <name>     Namespace for normal channels
                                 (default: cf-midjourney)
  --visually-namespace <name>    Namespace for channel folder names containing "visually"
                                 (default: cf-default)
  --autotrader-namespace <name>  Namespace for channel folder names containing "autotrader"
                                 (default: cf-autotrader)
  --rewrite-namespace            Rewrite migrated entries to routed namespace
                                 (default: off)
  --apply                        Write migrated checkpoint (default is dry-run)
  --no-backup                    Skip creating .bak timestamp backup when --apply is used
  --verbose                      Print per-entry details
  --help                         Show this help

Examples:
  node scripts/migrate-fs-checkpoint-keys.mjs
  node scripts/migrate-fs-checkpoint-keys.mjs --apply
  node scripts/migrate-fs-checkpoint-keys.mjs --apply --rewrite-namespace
`);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseArgs(argv) {
  const opts = {
    checkpointFile: path.resolve("data", "fs-ingest-checkpoints", "discord-shared-multi-namespace.json"),
    imagesRoot: path.resolve(os.homedir(), "Code", "chester-downloads-discord-images", "images"),
    defaultNamespace: "cf-midjourney",
    visuallyNamespace: "cf-default",
    autotraderNamespace: "cf-autotrader",
    rewriteNamespace: false,
    apply: false,
    backup: true,
    verbose: false,
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--checkpoint-file") {
      if (!requireValue(arg, next)) continue;
      opts.checkpointFile = path.resolve(expandHome(next));
      index += 1;
    } else if (arg === "--images-root") {
      if (!requireValue(arg, next)) continue;
      opts.imagesRoot = path.resolve(expandHome(next));
      index += 1;
    } else if (arg === "--default-namespace") {
      if (!requireValue(arg, next)) continue;
      opts.defaultNamespace = String(next).trim();
      index += 1;
    } else if (arg === "--visually-namespace") {
      if (!requireValue(arg, next)) continue;
      opts.visuallyNamespace = String(next).trim();
      index += 1;
    } else if (arg === "--autotrader-namespace") {
      if (!requireValue(arg, next)) continue;
      opts.autotraderNamespace = String(next).trim();
      index += 1;
    } else if (arg === "--rewrite-namespace") {
      opts.rewriteNamespace = true;
    } else if (arg === "--apply") {
      opts.apply = true;
    } else if (arg === "--no-backup") {
      opts.backup = false;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else {
      errors.push(`Unknown option: ${arg}`);
    }
  }

  return { opts, errors };
}

function normalizeRelativePath(relPath) {
  return String(relPath || "").split(path.sep).join("/");
}

function stablePathKey(rootDir, namespace) {
  return createHash("sha1")
    .update(`${path.resolve(rootDir)}\n${namespace}`)
    .digest("hex")
    .slice(0, 16);
}

function checkpointEntryKey({ rootDir, namespace, relPath }) {
  return `${stablePathKey(rootDir, namespace)}\n${normalizeRelativePath(relPath)}`;
}

function fileSignatureFromStat(stat) {
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function assetTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function pickChannelNamespace(folderName, opts) {
  const lowered = folderName.toLowerCase();
  if (lowered.includes("visually")) return opts.visuallyNamespace;
  if (lowered.includes("autotrader")) return opts.autotraderNamespace;
  return opts.defaultNamespace;
}

async function walkMediaFiles(rootDir) {
  const out = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = assetTypeForFile(abs);
      if (!kind) continue;
      out.push({ path: abs, kind });
    }
  }

  return out;
}

function isLegacyPathKey(key) {
  return typeof key === "string" && !key.includes("\n");
}

function cloneEntry(entry) {
  return entry && typeof entry === "object" ? { ...entry } : null;
}

async function main() {
  const { opts, errors } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`[args] ${error}`));
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    printUsage();
    return;
  }

  const checkpointRaw = await fs.readFile(opts.checkpointFile, "utf8").catch(() => null);
  if (!checkpointRaw) {
    throw new Error(`Checkpoint file not found: ${opts.checkpointFile}`);
  }

  const checkpoint = JSON.parse(checkpointRaw);
  if (!checkpoint || typeof checkpoint !== "object") {
    throw new Error(`Invalid checkpoint JSON: ${opts.checkpointFile}`);
  }
  if (!checkpoint.entries || typeof checkpoint.entries !== "object") {
    checkpoint.entries = {};
  }
  if (!checkpoint.hashEntries || typeof checkpoint.hashEntries !== "object") {
    checkpoint.hashEntries = {};
  }

  const stats = await fs.stat(opts.imagesRoot).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Images root not found or not a directory: ${opts.imagesRoot}`);
  }

  const allEntryKeys = Object.keys(checkpoint.entries);
  const legacyEntryKeys = allEntryKeys.filter(isLegacyPathKey);

  console.log(`[migrate] checkpoint=${opts.checkpointFile}`);
  console.log(`[migrate] imagesRoot=${opts.imagesRoot}`);
  console.log(`[migrate] legacyEntryKeys=${legacyEntryKeys.length} totalEntryKeys=${allEntryKeys.length}`);
  console.log(
    `[migrate] namespaceRules visually=${opts.visuallyNamespace} autotrader=${opts.autotraderNamespace} default=${opts.defaultNamespace} rewriteNamespace=${opts.rewriteNamespace ? "1" : "0"}`
  );
  console.log(`[migrate] mode=${opts.apply ? "apply" : "dry-run"}`);

  if (legacyEntryKeys.length === 0) {
    console.log("[migrate] No legacy keys found; nothing to do.");
    return;
  }

  const channelDirs = await fs.readdir(opts.imagesRoot, { withFileTypes: true });
  const usableChannels = channelDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      root: path.join(opts.imagesRoot, entry.name, "images"),
    }));

  let channelsScanned = 0;
  let filesScanned = 0;
  let migrated = 0;
  let existingScoped = 0;
  let missingLegacy = 0;
  let signatureMismatch = 0;
  let invalidLegacy = 0;

  for (const channel of usableChannels) {
    const channelRootStats = await fs.stat(channel.root).catch(() => null);
    if (!channelRootStats?.isDirectory()) continue;

    channelsScanned += 1;
    const namespace = pickChannelNamespace(channel.name, opts);
    const mediaFiles = await walkMediaFiles(channel.root);

    if (opts.verbose) {
      console.log(`[migrate][channel] ${channel.name} namespace=${namespace} files=${mediaFiles.length}`);
    }

    for (const item of mediaFiles) {
      filesScanned += 1;
      const relPath = normalizeRelativePath(path.relative(channel.root, item.path));
      const newKey = checkpointEntryKey({
        rootDir: channel.root,
        namespace,
        relPath,
      });

      if (checkpoint.entries[newKey]) {
        existingScoped += 1;
        continue;
      }

      const legacy = checkpoint.entries[relPath];
      if (!legacy) {
        missingLegacy += 1;
        continue;
      }

      const legacyClone = cloneEntry(legacy);
      if (!legacyClone) {
        invalidLegacy += 1;
        continue;
      }

      if (typeof legacyClone.signature === "string") {
        const stat = await fs.stat(item.path);
        const signature = fileSignatureFromStat(stat);
        if (legacyClone.signature !== signature) {
          signatureMismatch += 1;
          if (opts.verbose) {
            console.log(`[migrate][skip-signature] ${channel.name} ${relPath}`);
          }
          continue;
        }
      }

      if (opts.rewriteNamespace) {
        legacyClone.namespace = namespace;
      }

      if (!legacyClone.kind) {
        legacyClone.kind = item.kind;
      }

      checkpoint.entries[newKey] = legacyClone;
      migrated += 1;

      if (opts.verbose) {
        console.log(`[migrate][entry] ${relPath} -> ${newKey}`);
      }
    }
  }

  console.log(
    `[migrate] channelsScanned=${channelsScanned} filesScanned=${filesScanned} migrated=${migrated} existingScoped=${existingScoped} missingLegacy=${missingLegacy} signatureMismatch=${signatureMismatch} invalidLegacy=${invalidLegacy}`
  );

  if (!opts.apply) {
    console.log("[migrate] Dry-run complete. Use --apply to write changes.");
    return;
  }

  if (opts.backup) {
    const stamp = new Date().toISOString().replace(/[:]/g, "-");
    const backupPath = `${opts.checkpointFile}.${stamp}.bak`;
    await fs.copyFile(opts.checkpointFile, backupPath);
    console.log(`[migrate] Backup written: ${backupPath}`);
  }

  await fs.writeFile(opts.checkpointFile, JSON.stringify(checkpoint, null, 2), "utf8");
  console.log(`[migrate] Wrote checkpoint: ${opts.checkpointFile}`);
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
