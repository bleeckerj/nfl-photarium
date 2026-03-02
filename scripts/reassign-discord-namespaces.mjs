#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

function printUsage() {
  console.log(`Reassign existing catalog image namespaces based on Discord channel rules.

This script uses fs-ingest checkpoint entries to infer channel origin and then
updates existing catalog image metadata in place via /api/images/:id/update.

Usage:
  node scripts/reassign-discord-namespaces.mjs [options]

Options:
  --api-base <url>              Local API base URL (default: http://localhost:3000)
  --checkpoint-file <path>      Checkpoint file to inspect
                                (default: data/fs-ingest-checkpoints/discord-shared-multi-namespace.json)
  --images-root <path>          Discord images root with channel folders
                                (default: ~/Code/chester-downloads-discord-images/images)
  --default-namespace <name>    Namespace for normal channels (default: cf-midjourney)
  --visually-namespace <name>   Namespace when channel name contains "visually" (default: cf-default)
  --autotrader-namespace <name> Namespace when channel name contains "autotrader" (default: cf-autotrader)
  --legacy-namespace <name>     Additional namespace to match old checkpoint prefixes (default: cf-default)
  --concurrency <n>             Parallel PATCH requests during apply (default: 4)
  --apply                       Execute updates (default is dry-run)
  --verbose                     Print extra detail
  --help                        Show help

Examples:
  node scripts/reassign-discord-namespaces.mjs
  node scripts/reassign-discord-namespaces.mjs --apply
  node scripts/reassign-discord-namespaces.mjs --api-base http://localhost:3000 --apply --concurrency 2
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
    apiBase: "http://localhost:3000",
    checkpointFile: path.resolve("data", "fs-ingest-checkpoints", "discord-shared-multi-namespace.json"),
    imagesRoot: path.resolve(os.homedir(), "Code", "chester-downloads-discord-images", "images"),
    defaultNamespace: "cf-midjourney",
    visuallyNamespace: "cf-default",
    autotraderNamespace: "cf-autotrader",
    legacyNamespace: "cf-default",
    concurrency: 4,
    apply: false,
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
    } else if (arg === "--api-base") {
      if (!requireValue(arg, next)) continue;
      opts.apiBase = String(next).trim().replace(/\/+$/, "");
      index += 1;
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
    } else if (arg === "--legacy-namespace") {
      if (!requireValue(arg, next)) continue;
      opts.legacyNamespace = String(next).trim();
      index += 1;
    } else if (arg === "--concurrency") {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        errors.push(`Invalid concurrency: ${next}`);
      } else {
        opts.concurrency = parsed;
      }
      index += 1;
    } else if (arg === "--apply") {
      opts.apply = true;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else {
      errors.push(`Unknown option: ${arg}`);
    }
  }

  return { opts, errors };
}

function stablePathKey(rootDir, namespace) {
  return createHash("sha1")
    .update(`${path.resolve(rootDir)}\n${namespace}`)
    .digest("hex")
    .slice(0, 16);
}

function pickChannelNamespace(folderName, opts) {
  const lowered = folderName.toLowerCase();
  if (lowered.includes("visually")) return opts.visuallyNamespace;
  if (lowered.includes("autotrader")) return opts.autotraderNamespace;
  return opts.defaultNamespace;
}

function isScopedKey(entryKey) {
  return typeof entryKey === "string" && entryKey.includes("\n") && entryKey.indexOf("\n") > 0;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
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

async function fetchCatalogImages(apiBase) {
  const response = await fetch(`${apiBase}/api/images?namespace=__all__&refresh=1`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to fetch catalog images (${response.status})`);
  }
  return Array.isArray(payload?.images) ? payload.images : [];
}

async function patchNamespace(apiBase, imageId, namespace) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/update`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ namespace }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
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
  const entries = checkpoint?.entries && typeof checkpoint.entries === "object" ? checkpoint.entries : {};

  const imagesRootStats = await fs.stat(opts.imagesRoot).catch(() => null);
  if (!imagesRootStats?.isDirectory()) {
    throw new Error(`Images root not found or not a directory: ${opts.imagesRoot}`);
  }

  const channelDirents = await fs.readdir(opts.imagesRoot, { withFileTypes: true });
  const channels = [];
  for (const dirent of channelDirents) {
    if (!dirent.isDirectory()) continue;
    const channelRoot = path.join(opts.imagesRoot, dirent.name, "images");
    const channelRootStats = await fs.stat(channelRoot).catch(() => null);
    if (!channelRootStats?.isDirectory()) continue;
    channels.push({
      folderName: dirent.name,
      rootDir: channelRoot,
      desiredNamespace: pickChannelNamespace(dirent.name, opts),
    });
  }

  const candidateNamespaces = Array.from(
    new Set([
      opts.defaultNamespace,
      opts.visuallyNamespace,
      opts.autotraderNamespace,
      opts.legacyNamespace,
    ].filter(Boolean))
  );

  const prefixToChannel = new Map();
  for (const channel of channels) {
    for (const namespace of candidateNamespaces) {
      const prefix = stablePathKey(channel.rootDir, namespace);
      if (!prefixToChannel.has(prefix)) {
        prefixToChannel.set(prefix, channel);
      }
    }
  }

  const scopedEntries = Object.entries(entries).filter(([entryKey]) => isScopedKey(entryKey));
  const legacyEntries = Object.keys(entries).length - scopedEntries.length;

  const assetPlans = new Map();
  let ignoredMissingAsset = 0;
  let ignoredUnknownPrefix = 0;
  let ignoredUnmapped = 0;
  let ignoredNonUploaded = 0;
  let conflicts = 0;

  for (const [entryKey, entryValue] of scopedEntries) {
    const entry = entryValue && typeof entryValue === "object" ? entryValue : null;
    if (!entry) {
      ignoredUnmapped += 1;
      continue;
    }
    if (entry.status !== "uploaded") {
      ignoredNonUploaded += 1;
      continue;
    }
    const assetId = typeof entry.assetId === "string" ? entry.assetId.trim() : "";
    if (!assetId || assetId === "n/a" || assetId === "assumed-uploaded" || assetId === "duplicate") {
      ignoredMissingAsset += 1;
      continue;
    }

    const separator = entryKey.indexOf("\n");
    const prefix = separator >= 0 ? entryKey.slice(0, separator) : "";
    const relPath = separator >= 0 ? entryKey.slice(separator + 1) : "";
    const channel = prefixToChannel.get(prefix);
    if (!channel) {
      ignoredUnknownPrefix += 1;
      continue;
    }

    const desiredNamespace = channel.desiredNamespace;
    const existing = assetPlans.get(assetId);
    if (!existing) {
      assetPlans.set(assetId, {
        assetId,
        desiredNamespace,
        channels: new Set([channel.folderName]),
        relPaths: new Set([relPath]),
        conflict: false,
      });
      continue;
    }

    existing.channels.add(channel.folderName);
    if (relPath) existing.relPaths.add(relPath);
    if (existing.desiredNamespace !== desiredNamespace) {
      existing.conflict = true;
      conflicts += 1;
    }
  }

  const catalogImages = await fetchCatalogImages(opts.apiBase);
  const catalogById = new Map(
    catalogImages
      .filter((image) => image && typeof image.id === "string")
      .map((image) => [image.id, image])
  );

  const candidates = [];
  let skipConflict = 0;
  let skipNotInCatalog = 0;
  let skipAlreadyCorrect = 0;

  for (const plan of assetPlans.values()) {
    if (plan.conflict) {
      skipConflict += 1;
      continue;
    }
    const catalog = catalogById.get(plan.assetId);
    if (!catalog) {
      skipNotInCatalog += 1;
      continue;
    }
    const currentNamespace = typeof catalog.namespace === "string" ? catalog.namespace : "";
    if (currentNamespace === plan.desiredNamespace) {
      skipAlreadyCorrect += 1;
      continue;
    }
    candidates.push({
      assetId: plan.assetId,
      currentNamespace,
      desiredNamespace: plan.desiredNamespace,
      channels: Array.from(plan.channels),
      relPaths: Array.from(plan.relPaths),
    });
  }

  console.log(`[reassign] checkpoint=${opts.checkpointFile}`);
  console.log(`[reassign] imagesRoot=${opts.imagesRoot}`);
  console.log(`[reassign] apiBase=${opts.apiBase}`);
  console.log(
    `[reassign] rules visually=${opts.visuallyNamespace} autotrader=${opts.autotraderNamespace} default=${opts.defaultNamespace}`
  );
  console.log(`[reassign] mode=${opts.apply ? "apply" : "dry-run"}`);
  console.log(
    `[reassign] channels=${channels.length} checkpointEntries=${Object.keys(entries).length} scopedEntries=${scopedEntries.length} legacyEntries=${legacyEntries}`
  );
  console.log(
    `[reassign] plannedAssets=${assetPlans.size} candidates=${candidates.length} skipAlreadyCorrect=${skipAlreadyCorrect} skipConflict=${skipConflict} skipNotInCatalog=${skipNotInCatalog} ignoredMissingAsset=${ignoredMissingAsset} ignoredUnknownPrefix=${ignoredUnknownPrefix} ignoredNonUploaded=${ignoredNonUploaded} ignoredUnmapped=${ignoredUnmapped}`
  );

  if (opts.verbose) {
    candidates.slice(0, 25).forEach((candidate) => {
      console.log(
        `[reassign][candidate] ${candidate.assetId} ${candidate.currentNamespace || "(none)"} -> ${candidate.desiredNamespace} channels=${candidate.channels.join(",")}`
      );
    });
    if (candidates.length > 25) {
      console.log(`[reassign] ...and ${candidates.length - 25} more candidates`);
    }
  }

  if (!opts.apply) {
    console.log("[reassign] Dry-run complete. Use --apply to update catalog namespaces.");
    return;
  }

  let updated = 0;
  let failed = 0;

  await runWithConcurrency(candidates, opts.concurrency, async (candidate) => {
    try {
      await patchNamespace(opts.apiBase, candidate.assetId, candidate.desiredNamespace);
      updated += 1;
      if (opts.verbose) {
        console.log(
          `[reassign][updated] ${candidate.assetId} ${candidate.currentNamespace || "(none)"} -> ${candidate.desiredNamespace}`
        );
      }
    } catch (error) {
      failed += 1;
      console.warn(
        `[reassign][failed] ${candidate.assetId} ${candidate.currentNamespace || "(none)"} -> ${candidate.desiredNamespace}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  console.log(`[reassign] apply complete updated=${updated} failed=${failed} total=${candidates.length}`);
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
