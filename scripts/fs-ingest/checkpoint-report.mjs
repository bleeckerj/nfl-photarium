import fs from "node:fs/promises";
import path from "node:path";
import { runWithConcurrency } from "../lib/concurrency.mjs";
import {
  checkpointEntryKey,
  checkpointHashKey,
  fileSignatureFromStat,
} from "./checkpoint.mjs";

export async function reportCheckpointCoverage({
  opts,
  files,
  checkpoint,
  hashFileContent,
}) {
  let pathHits = 0;
  let hashHits = 0;
  let hashReadErrors = 0;
  let statErrors = 0;

  await runWithConcurrency(files, Math.max(1, opts.concurrency), async (item) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });

    let fileStat;
    try {
      fileStat = await fs.stat(filePath);
    } catch (error) {
      statErrors += 1;
      if (opts.verbose) {
        console.log(`[cache][warn] stat failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    const signature = fileSignatureFromStat(fileStat);
    const cached = checkpoint.entries?.[pathKey];
    if (
      cached &&
      cached.status === "uploaded" &&
      cached.signature === signature &&
      cached.kind === item.kind &&
      cached.namespace === opts.namespace
    ) {
      pathHits += 1;
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      hashReadErrors += 1;
      if (opts.verbose) {
        console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    const hashCached = checkpoint.hashEntries?.[checkpointHashKey({
      namespace: opts.namespace,
      kind: item.kind,
      contentHash,
    })];

    if (
      hashCached &&
      hashCached.status === "uploaded" &&
      hashCached.namespace === opts.namespace &&
      hashCached.kind === item.kind
    ) {
      hashHits += 1;
    }
  });

  const total = files.length;
  const totalHits = pathHits + hashHits;
  const hitRate = total > 0 ? (totalHits / total) * 100 : 100;
  const missRate = total > 0 ? ((total - totalHits) / total) * 100 : 0;
  console.log(
    `[cache] preflight total=${total} pathHits=${pathHits} hashHits=${hashHits} misses=${total - totalHits} hitRate=${hitRate.toFixed(2)}% missRate=${missRate.toFixed(2)}% statErrors=${statErrors} hashReadErrors=${hashReadErrors}`
  );
}
