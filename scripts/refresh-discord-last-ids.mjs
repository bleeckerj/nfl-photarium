#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export function normalizeLastId(value) {
  if (value === null || value === undefined) return "oldest";
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "oldest") return "oldest";
  return normalized;
}

function numericIdOrNull(value) {
  const normalized = normalizeLastId(value);
  if (normalized === "oldest") return null;
  if (!/^\d+$/.test(normalized)) return null;
  return normalized;
}

function channelIdOrNull(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

async function loadJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function extractConfigChannelFallbackFromText(raw) {
  const text = String(raw || "");
  const channelMatch = text.match(/"channel_id"\s*:\s*("?)(\d+)\1/);
  const afterMatch = text.match(/"after_id"\s*:\s*("(.*?)"|(\d+)|null)/);

  const channelId = channelMatch?.[2] || undefined;
  const afterId = afterMatch
    ? normalizeLastId(afterMatch[2] ?? afterMatch[3])
    : undefined;

  return { channelId, afterId };
}

async function* walkJsonFiles(rootDir) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        yield nextPath;
      }
    }
  }
}

export async function discoverDownloadedChannelLastIds(imagesRoot) {
  const discovered = new Map();
  const invalidFiles = [];

  for await (const jsonPath of walkJsonFiles(imagesRoot)) {
    const payload = await loadJsonFile(jsonPath, null);
    const channelId = channelIdOrNull(payload?.channel_id);
    const messageId = numericIdOrNull(payload?.id);
    if (!channelId || !messageId) {
      invalidFiles.push(jsonPath);
      continue;
    }
    const previous = discovered.get(channelId);
    if (!previous || BigInt(messageId) > BigInt(previous)) {
      discovered.set(channelId, messageId);
    }
  }

  return { discovered, invalidFiles };
}

export function mergeChannelLastIds({
  discoveredByChannel,
  existingChannels,
  configChannelId,
  configAfterId,
}) {
  const existingMap = new Map();
  const merged = [];
  const warnings = [];
  const seen = new Set();

  for (const entry of Array.isArray(existingChannels) ? existingChannels : []) {
    const channelId = channelIdOrNull(entry?.channel_id);
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    existingMap.set(channelId, normalizeLastId(entry?.last_id));
  }

  const configId = channelIdOrNull(configChannelId);
  const configLastId = normalizeLastId(configAfterId);
  const discoveredIds = Array.from(discoveredByChannel.keys()).sort((a, b) => a.localeCompare(b));

  const orderedChannelIds = [
    ...Array.from(existingMap.keys()),
    ...discoveredIds.filter((channelId) => !existingMap.has(channelId)),
  ];
  if (configId && !orderedChannelIds.includes(configId)) {
    orderedChannelIds.push(configId);
  }

  for (const channelId of orderedChannelIds) {
    const discoveredLastId = discoveredByChannel.get(channelId);
    const existingLastId = existingMap.get(channelId);
    const fallbackLastId = channelId === configId ? configLastId : undefined;

    const chosenLastId = discoveredLastId ?? existingLastId ?? fallbackLastId ?? "oldest";
    merged.push({ channel_id: channelId, last_id: chosenLastId });

    const existingNumeric = numericIdOrNull(existingLastId);
    if (discoveredLastId && existingNumeric && BigInt(existingNumeric) > BigInt(discoveredLastId)) {
      warnings.push(
        `channel ${channelId} saved last_id ${existingNumeric} is ahead of downloaded JSON ${discoveredLastId}; using downloaded JSON cursor`
      );
    }
  }

  return { merged, warnings };
}

function parseArgs(argv) {
  const defaults = {
    discordRepo: "/Users/julian/Code/chester-downloads-discord-images",
    imagesRoot: "",
    channelsFile: "",
    configFile: "",
    dryRun: false,
  };
  const opts = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--discord-repo" && next) {
      opts.discordRepo = path.resolve(next);
      i += 1;
    } else if (arg === "--images-root" && next) {
      opts.imagesRoot = path.resolve(next);
      i += 1;
    } else if (arg === "--channels-file" && next) {
      opts.channelsFile = path.resolve(next);
      i += 1;
    } else if (arg === "--config-file" && next) {
      opts.configFile = path.resolve(next);
      i += 1;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/refresh-discord-last-ids.mjs [--discord-repo <path>] [--dry-run]");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!opts.imagesRoot) opts.imagesRoot = path.join(opts.discordRepo, "images");
  if (!opts.channelsFile) opts.channelsFile = path.join(opts.discordRepo, "channels_last_ids.json");
  if (!opts.configFile) opts.configFile = path.join(opts.discordRepo, "config.json");
  return opts;
}

async function writeJsonAtomic(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 4) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const imagesRootStat = await fs.stat(opts.imagesRoot).catch(() => null);
  if (!imagesRootStat?.isDirectory()) {
    throw new Error(`Images root not found: ${opts.imagesRoot}`);
  }

  const existingChannels = await loadJsonFile(opts.channelsFile, []);
  const configRaw = await fs.readFile(opts.configFile, "utf8").catch(() => "");
  const configFallback = extractConfigChannelFallbackFromText(configRaw);
  const { discovered, invalidFiles } = await discoverDownloadedChannelLastIds(opts.imagesRoot);
  const { merged, warnings } = mergeChannelLastIds({
    discoveredByChannel: discovered,
    existingChannels,
    configChannelId: configFallback.channelId,
    configAfterId: configFallback.afterId,
  });

  console.log(
    `[discord-state] discovered=${discovered.size} existing=${Array.isArray(existingChannels) ? existingChannels.length : 0} merged=${merged.length} invalidJson=${invalidFiles.length} dryRun=${opts.dryRun ? "1" : "0"}`
  );
  for (const warning of warnings) {
    console.log(`[discord-state][warn] ${warning}`);
  }

  if (!opts.dryRun) {
    await writeJsonAtomic(opts.channelsFile, merged);
    console.log(`[discord-state] wrote ${opts.channelsFile}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
