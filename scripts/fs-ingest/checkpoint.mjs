import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function stablePathKey(rootDir, namespace) {
  return createHash("sha1")
    .update(`${path.resolve(rootDir)}\n${namespace}`)
    .digest("hex")
    .slice(0, 16);
}

export function defaultCheckpointPath(rootDir, namespace) {
  const key = stablePathKey(rootDir, namespace);
  return path.resolve("data", "fs-ingest-checkpoints", `${key}.json`);
}

export function fileSignatureFromStat(stat) {
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

export function checkpointHashKey({ namespace, kind, contentHash }) {
  return `${namespace}\n${kind}\n${contentHash}`;
}

export function normalizeRelativePath(relPath) {
  return String(relPath || "").split(path.sep).join("/");
}

export function checkpointEntryKey({ rootDir, namespace, relPath }) {
  return `${stablePathKey(rootDir, namespace)}\n${normalizeRelativePath(relPath)}`;
}

export async function loadCheckpoint(checkpointPath) {
  try {
    const raw = await fs.readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 2, entries: {}, hashEntries: {} };
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const hashEntries = parsed.hashEntries && typeof parsed.hashEntries === "object" ? parsed.hashEntries : {};
    return {
      version: 2,
      entries,
      hashEntries,
    };
  } catch {
    return { version: 2, entries: {}, hashEntries: {} };
  }
}

export async function saveCheckpoint(checkpointPath, checkpoint) {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const tmpPath = `${checkpointPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(checkpoint, null, 2), "utf8");
  await fs.rename(tmpPath, checkpointPath);
}
