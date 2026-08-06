#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs, printUsage } from "./fs-ingest/cli.mjs";
import { createMinIntervalLimiter, runWithConcurrency } from "./lib/concurrency.mjs";
import {
  checkpointEntryKey,
  checkpointHashKey,
  defaultCheckpointPath,
  fileSignatureFromStat,
  loadCheckpoint,
  saveCheckpoint,
} from "./fs-ingest/checkpoint.mjs";
import { reportCheckpointCoverage } from "./fs-ingest/checkpoint-report.mjs";
import {
  buildFlickrSourceRecord,
  buildSidecarIndex,
  enrichUploadFromSidecar,
  loadSidecar,
  lookupSidecarForFile,
} from "./fs-ingest/flickr-sidecar.mjs";
import {
  mergeTagsWithOptionalTail,
  normalizeTag,
  splitCsv,
  uniqueStrings,
} from "./fs-ingest/tagging.mjs";
import { buildDescription, createSerializedTaskQueue, formatSourcePath, hashFileContent, patchImageExtras, suggestAiMetadata, uploadImage, uploadVideo, walkMediaFiles } from "./fs-ingest/mediaPipeline.mjs";
export { uploadImage } from "./fs-ingest/mediaPipeline.mjs";
async function backfillHashCacheOnly({
  opts,
  files,
  checkpoint,
  checkpointPath,
  checkpointWrite,
  counts,
}) {
  let scanned = 0;
  let addedHashEntries = 0;
  let updatedPathEntries = 0;
  let assumedSeeded = 0;
  let skippedNotInPathCache = 0;
  let skippedPathMismatch = 0;
  let skippedExistingHash = 0;
  let failedHashReads = 0;

  console.log("[mode] hash-cache-backfill-only (no uploads, no AI metadata)");
  if (opts.assumeUploaded) {
    console.log("[mode][warn] assume-uploaded enabled: seeding cache for files without prior path-cache evidence");
  }

  await runWithConcurrency(files, opts.concurrency, async (item, index) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });
    const prefix = `[${index + 1}/${counts.total}] ${item.kind.toUpperCase()}`;
    scanned += 1;

    const existingPathEntry = checkpoint.entries?.[pathKey];
    const hasMatchingPathCache =
      !existingPathEntry ||
      existingPathEntry.status !== "uploaded" ||
      existingPathEntry.namespace !== opts.namespace ||
      existingPathEntry.kind !== item.kind
        ? false
        : true;

    if (!hasMatchingPathCache && !opts.assumeUploaded) {
      skippedNotInPathCache += 1;
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-skip(no-path-cache) ${relPath}`);
      }
      return;
    }

    if (!hasMatchingPathCache && opts.assumeUploaded) {
      const fileStat = await fs.stat(filePath);
      const signature = fileSignatureFromStat(fileStat);
      let contentHash;
      try {
        contentHash = await hashFileContent(filePath);
      } catch (error) {
        failedHashReads += 1;
        console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const hashKey = checkpointHashKey({
        namespace: opts.namespace,
        kind: item.kind,
        contentHash,
      });
      const existingHashEntry = checkpoint.hashEntries?.[hashKey];

      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        contentHash,
        assetId: typeof existingHashEntry?.assetId === "string" ? existingHashEntry.assetId : "assumed-uploaded",
        uploadedAt:
          typeof existingHashEntry?.uploadedAt === "string" ? existingHashEntry.uploadedAt : new Date().toISOString(),
        note: "hash-cache-backfill-assume-uploaded",
      };
      checkpoint.hashEntries[hashKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        contentHash,
        assetId: typeof existingHashEntry?.assetId === "string" ? existingHashEntry.assetId : "assumed-uploaded",
        uploadedAt:
          typeof existingHashEntry?.uploadedAt === "string" ? existingHashEntry.uploadedAt : new Date().toISOString(),
        sourcePath: relPath,
        note: "hash-cache-backfill-assume-uploaded",
      };
      assumedSeeded += 1;
      updatedPathEntries += 1;
      if (!existingHashEntry) addedHashEntries += 1;
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-assumed ${relPath}`);
      }
      return;
    }

    const fileStat = await fs.stat(filePath);
    const signature = fileSignatureFromStat(fileStat);
    if (existingPathEntry.signature !== signature) {
      skippedPathMismatch += 1;
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-skip(signature-mismatch) ${relPath}`);
      }
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      failedHashReads += 1;
      console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const hashKey = checkpointHashKey({
      namespace: opts.namespace,
      kind: item.kind,
      contentHash,
    });
    const existingHashEntry = checkpoint.hashEntries?.[hashKey];

    let touched = false;
    if (
      existingPathEntry.contentHash !== contentHash
    ) {
      checkpoint.entries[pathKey] = {
        ...existingPathEntry,
        contentHash,
      };
      updatedPathEntries += 1;
      touched = true;
    }

    if (
      !existingHashEntry ||
      existingHashEntry.status !== "uploaded" ||
      existingHashEntry.namespace !== opts.namespace ||
      existingHashEntry.kind !== item.kind
    ) {
      checkpoint.hashEntries[hashKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        contentHash,
        assetId: typeof existingPathEntry?.assetId === "string" ? existingPathEntry.assetId : "n/a",
        uploadedAt:
          typeof existingPathEntry?.uploadedAt === "string" ? existingPathEntry.uploadedAt : new Date().toISOString(),
        sourcePath: relPath,
        note: "hash-cache-backfill-only",
      };
      addedHashEntries += 1;
      touched = true;
    } else {
      skippedExistingHash += 1;
    }

    if (touched) {
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
    }

    if (opts.verbose) {
      const action = touched ? "hash-cache-updated" : "hash-cache-present";
      console.log(`${prefix} ${action} ${relPath}`);
    }
  });

  console.log(
    `[hash-cache] scanned=${scanned} addedHashEntries=${addedHashEntries} updatedPathEntries=${updatedPathEntries} assumedSeeded=${assumedSeeded} existingHashEntries=${skippedExistingHash} skippedNoPathCache=${skippedNotInPathCache} skippedSignatureMismatch=${skippedPathMismatch} failedHashReads=${failedHashReads}`
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (Array.isArray(opts.errors) && opts.errors.length > 0) {
    for (const err of opts.errors) console.error(`[args] ${err}`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    printUsage();
    return;
  }

  if (!opts.root || !opts.namespace) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (["__all__", "__none__", "undefined"].includes(opts.namespace)) {
    throw new Error("Provide a specific --namespace (not __all__/__none__).");
  }

  const stats = await fs.stat(opts.root).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Root directory not found or not a directory: ${opts.root}`);
  }

  if (!opts.allowZipsInRoot) {
    const topLevel = await fs.readdir(opts.root, { withFileTypes: true });
    const zips = topLevel.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
    if (zips.length > 0) {
      const example = zips.slice(0, 3).map((z) => z.name).join(", ");
      throw new Error(
        `Found ${zips.length} .zip file(s) at the top level of --root (e.g. ${example}). ` +
        `Extract them first, or pass --allow-zips-in-root to bypass this check.`
      );
    }
  }

  const baseTags = splitCsv(opts.tagsCsv).map(normalizeTag).filter(Boolean);
  const appendImageTag = normalizeTag(opts.appendImageTag);
  const checkpointPath = opts.checkpointFile || defaultCheckpointPath(opts.root, opts.namespace);
  const checkpoint = await loadCheckpoint(checkpointPath);
  const checkpointWrite = createSerializedTaskQueue();
  const files = await walkMediaFiles(opts.root, { limit: opts.limit });
  const counts = {
    total: files.length,
    images: files.filter((f) => f.kind === "image").length,
    videos: files.filter((f) => f.kind === "video").length,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    skippedCached: 0,
    aiSuggested: 0,
  };

  console.log(`[scan] root=${opts.root}`);
  console.log(`[scan] found=${counts.total} images=${counts.images} videos=${counts.videos}`);
  console.log(
    `[config] namespace=${opts.namespace} apiBase=${opts.apiBase} concurrency=${opts.concurrency} throttleMs=${opts.throttleMs} onDuplicate=${opts.onDuplicate} dryRun=${opts.dryRun ? "1" : "0"} hashBackfillOnly=${opts.hashCacheBackfillOnly ? "1" : "0"} assumeUploaded=${opts.assumeUploaded ? "1" : "0"} sidecarMode=${opts.sidecarMode}`
  );
  console.log(`[checkpoint] ${checkpointPath}`);

  let sidecarIndex = null;
  if (opts.sidecarMode === "flickr") {
    console.log(`[sidecars] Building index from ${opts.root}...`);
    sidecarIndex = await buildSidecarIndex(opts.root);
    console.log(`[sidecars] Found ${sidecarIndex.size} sidecar file(s)`);

    const usedSidecarIds = new Set();
    let matched = 0;
    let missing = 0;
    const missingExamples = [];
    for (const item of files) {
      if (item.kind !== "image") continue;
      const hit = lookupSidecarForFile(path.basename(item.path), sidecarIndex);
      if (hit) {
        matched += 1;
        usedSidecarIds.add(hit.photoId);
      } else {
        missing += 1;
        if (missingExamples.length < 5) missingExamples.push(path.basename(item.path));
      }
    }
    const orphans = sidecarIndex.size - usedSidecarIds.size;
    const imageCount = counts.images;
    const coverage = imageCount > 0 ? (matched / imageCount) * 100 : 0;
    console.log(
      `[sidecars] Matched ${matched} / ${imageCount} image(s) to sidecars (${coverage.toFixed(2)}% coverage)`
    );
    if (missing > 0) {
      console.log(
        `[sidecars] ${missing} image(s) without a sidecar — will use filename/path metadata only` +
          (missingExamples.length ? ` (e.g. ${missingExamples.join(", ")})` : "")
      );
    }
    if (orphans > 0) {
      console.log(`[sidecars] ${orphans} sidecar(s) without a matching photo (unused)`);
    }

    if (opts.reportSidecars) {
      console.log(`[sidecars] --report-sidecars mode: printing per-file matches and exiting`);
      for (const item of files) {
        const filename = path.basename(item.path);
        if (item.kind !== "image") {
          if (opts.verbose) console.log(`[sidecars] skip-non-image ${filename}`);
          continue;
        }
        const hit = lookupSidecarForFile(filename, sidecarIndex);
        if (hit) {
          if (opts.verbose) console.log(`[sidecars] match ${filename} -> photo_${hit.photoId}.json`);
        } else {
          console.log(`[sidecars] miss ${filename}`);
        }
      }
      return;
    }
  } else if (opts.reportSidecars) {
    throw new Error("--report-sidecars requires --sidecar-mode flickr");
  }

  if (counts.total === 0) return;
  if (opts.reportCache) {
    await reportCheckpointCoverage({
      opts,
      files,
      checkpoint,
      hashFileContent,
    });
  }

  if (opts.hashCacheBackfillOnly) {
    await backfillHashCacheOnly({
      opts,
      files,
      checkpoint,
      checkpointPath,
      checkpointWrite,
      counts,
    });
    console.log(
      `[done] uploaded=${counts.uploaded} failed=${counts.failed} skipped=${counts.skipped} skippedCached=${counts.skippedCached} aiSuggested=${counts.aiSuggested}`
    );
    return;
  }
  const waitForUploadSlot = createMinIntervalLimiter(opts.throttleMs);

  await runWithConcurrency(files, opts.concurrency, async (item, index) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });
    const relDir = path.dirname(relPath).split(path.sep).join("/");
    const filename = path.basename(filePath);
    const fileStat = await fs.stat(filePath);
    const signature = fileSignatureFromStat(fileStat);
    const cached = checkpoint.entries?.[pathKey];
    const prefix = `[${index + 1}/${counts.total}] ${item.kind.toUpperCase()}`;
    if (
      cached &&
      cached.status === "uploaded" &&
      cached.signature === signature &&
      cached.kind === item.kind &&
      cached.namespace === opts.namespace
    ) {
      counts.skipped += 1;
      counts.skippedCached += 1;
      if (opts.verbose || opts.dryRun) {
        const cachedId = typeof cached.assetId === "string" ? cached.assetId : "n/a";
        console.log(`${prefix} skip(cached) ${relPath} -> ${cachedId}`);
      }

      if (item.kind === "image" || item.kind === "video") {
        const hasHashIndex =
          typeof cached.contentHash === "string" &&
          Boolean(checkpoint.hashEntries?.[checkpointHashKey({
            namespace: opts.namespace,
            kind: item.kind,
            contentHash: cached.contentHash,
          })]);
        if (!hasHashIndex) {
          try {
            const contentHash = await hashFileContent(filePath);
            cached.contentHash = contentHash;
            checkpoint.hashEntries[checkpointHashKey({
              namespace: opts.namespace,
              kind: item.kind,
              contentHash,
            })] = {
              status: "uploaded",
              kind: item.kind,
              namespace: opts.namespace,
              contentHash,
              assetId: typeof cached.assetId === "string" ? cached.assetId : "n/a",
              uploadedAt: typeof cached.uploadedAt === "string" ? cached.uploadedAt : new Date().toISOString(),
              sourcePath: relPath,
              note: "hash-cache-backfilled-from-path-cache",
            };
            await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
          } catch (error) {
            console.log(`[cache][warn] hash backfill failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
    }

    if (contentHash) {
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
        counts.skipped += 1;
        counts.skippedCached += 1;
        checkpoint.entries[pathKey] = {
          status: "uploaded",
          kind: item.kind,
          namespace: opts.namespace,
          signature,
          contentHash,
          assetId: typeof hashCached.assetId === "string" ? hashCached.assetId : "n/a",
          uploadedAt: typeof hashCached.uploadedAt === "string" ? hashCached.uploadedAt : new Date().toISOString(),
          note: "hash-cache-hit",
        };
        await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
        if (opts.verbose || opts.dryRun) {
          const cachedId = typeof hashCached.assetId === "string" ? hashCached.assetId : "n/a";
          console.log(`${prefix} skip(cached-hash) ${relPath} -> ${cachedId}`);
        }
        return;
      }
    }

    const pathTags = opts.includePathTags && relDir && relDir !== "."
      ? relDir.split("/").map(normalizeTag).filter(Boolean)
      : [];
    const baseTagsLocal = uniqueStrings([...baseTags, ...pathTags]).slice(0, 12);
    const baseDescription = buildDescription({
      relDir,
      filename,
      descriptionPrefix: opts.descriptionPrefix,
      includeFilename: opts.includeFilename,
    });
    const baseSourceUrl = formatSourcePath(opts.root, filePath);

    let sidecar = null;
    let sidecarPhotoId = null;
    if (opts.sidecarMode === "flickr" && sidecarIndex) {
      const hit = lookupSidecarForFile(filename, sidecarIndex);
      if (hit) {
        sidecarPhotoId = hit.photoId;
        try {
          sidecar = await loadSidecar(hit.sidecarPath);
        } catch (error) {
          console.log(`[sidecar][warn] failed to load ${hit.sidecarPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (opts.sidecarMode === "flickr" && !sidecar && opts.sidecarRequired) {
      counts.failed += 1;
      console.log(`${prefix} fail ${relPath} -> sidecar required but not found`);
      return;
    }

    const enriched = enrichUploadFromSidecar({
      baseTags: baseTagsLocal,
      baseDescription,
      baseFolder: opts.folder || undefined,
      baseDisplayName: undefined,
      baseSourceUrl,
      baseOriginalUrl: undefined,
      descriptionPrefix: sidecar ? opts.descriptionPrefix : "",
      sidecar,
      folderFromAlbum: opts.folderFromAlbum,
      albumTags: opts.albumTags,
    });

    const hasSidecarName = Boolean(sidecar?.name);
    const hasSidecarTags = Boolean(sidecar?.tags?.length);
    const wantAiDisplayName = opts.aiDisplayName && !hasSidecarName;
    const wantAiTags = opts.aiTags && !hasSidecarTags;

    let displayName = enriched.displayName;
    let aiTags = [];
    if (item.kind === "image" && (wantAiDisplayName || wantAiTags)) {
      try {
        const ai = await suggestAiMetadata({
          apiBase: opts.apiBase,
          filePath,
          filename,
          folder: enriched.folder,
          existingTags: enriched.tags,
          wantDisplayName: wantAiDisplayName,
          wantTags: wantAiTags,
          tagCount: opts.tagCount,
        });
        if (wantAiDisplayName && ai.displayName) displayName = ai.displayName;
        if (wantAiTags) aiTags = (ai.tags || []).map(normalizeTag).filter(Boolean);
        counts.aiSuggested += 1;
      } catch (error) {
        console.log(`[ai][warn] ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const mergedTags = uniqueStrings([...enriched.tags, ...aiTags]).slice(0, 12);
    const finalTags = item.kind === "image"
      ? mergeTagsWithOptionalTail(mergedTags, appendImageTag, 12)
      : mergedTags;
    const description = enriched.description;
    const folder = enriched.folder;
    const sourcePath = enriched.sourceUrl;
    const originalUrl = enriched.originalUrl;
    if (opts.verbose || opts.dryRun) {
      console.log(`${prefix} ${relPath}`);
      if (sidecarPhotoId) console.log(`  sidecar=photo_${sidecarPhotoId}.json`);
      else if (opts.sidecarMode === "flickr") console.log(`  sidecar=(missing)`);
      if (displayName) console.log(`  displayName=${displayName}`);
      if (folder) console.log(`  folder=${folder}`);
      if (finalTags.length) console.log(`  tags=${finalTags.join(", ")}`);
      if (description) console.log(`  description=${description}`);
      if (originalUrl) console.log(`  originalUrl=${originalUrl}`);
    }

    if (opts.dryRun) {
      counts.skipped += 1;
      return;
    }

    await waitForUploadSlot();

    const outcome = item.kind === "image"
      ? await uploadImage({
          apiBase: opts.apiBase,
          filePath,
          namespace: opts.namespace,
          folder: folder || undefined,
          createFolder: opts.createFolder,
          tags: finalTags,
          description,
          displayName,
          sourcePath,
          originalUrl,
          duplicateAction: opts.onDuplicate,
          generateSemanticTags: opts.generateSemanticTags,
          semanticTagCount: opts.tagCount,
        })
      : await uploadVideo({
          apiBase: opts.apiBase,
          filePath,
          namespace: opts.namespace,
          folder: folder || undefined,
          createFolder: opts.createFolder,
          tags: finalTags,
          description,
          sourcePath,
          originalUrl,
        });

    if (outcome.ok) {
      counts.uploaded += 1;
      const id = outcome.payload?.id || outcome.payload?.result?.id || "n/a";
      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        ...(contentHash ? { contentHash } : {}),
        assetId: id,
        uploadedAt: new Date().toISOString(),
      };
      if (contentHash) {
        checkpoint.hashEntries[checkpointHashKey({
          namespace: opts.namespace,
          kind: item.kind,
          contentHash,
        })] = {
          status: "uploaded",
          kind: item.kind,
          namespace: opts.namespace,
          contentHash,
          assetId: id,
          uploadedAt: new Date().toISOString(),
          sourcePath: relPath,
        };
      }
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      console.log(`${prefix} ok ${relPath} -> ${id}`);

      if (item.kind === "image" && sidecar && id && id !== "n/a") {
        const flickrSource = buildFlickrSourceRecord({ sidecar, contentHash });
        if (flickrSource) {
          try {
            await patchImageExtras({ apiBase: opts.apiBase, imageId: id, flickrSource });
          } catch (error) {
            console.log(`[extras][warn] ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return;
    }

    if (
      item.kind === "image" &&
      outcome.status === 409 &&
      Array.isArray(outcome.payload?.duplicates) &&
      outcome.payload.duplicates.length > 0
    ) {
      counts.skipped += 1;
      const duplicateId = outcome.payload.duplicates.find((d) => d && typeof d.id === "string")?.id || "duplicate";
      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        ...(contentHash ? { contentHash } : {}),
        assetId: duplicateId,
        uploadedAt: new Date().toISOString(),
        note: "duplicate-detected",
      };
      if (contentHash) {
        checkpoint.hashEntries[checkpointHashKey({
          namespace: opts.namespace,
          kind: item.kind,
          contentHash,
        })] = {
          status: "uploaded",
          kind: item.kind,
          namespace: opts.namespace,
          contentHash,
          assetId: duplicateId,
          uploadedAt: new Date().toISOString(),
          sourcePath: relPath,
          note: "duplicate-detected",
        };
      }
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      console.log(`${prefix} skip(duplicate) ${relPath} -> ${duplicateId}`);

      if (sidecar && duplicateId && duplicateId !== "duplicate") {
        const flickrSource = buildFlickrSourceRecord({ sidecar, contentHash });
        if (flickrSource) {
          try {
            await patchImageExtras({ apiBase: opts.apiBase, imageId: duplicateId, flickrSource });
          } catch (error) {
            console.log(`[extras][warn] ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return;
    }

    counts.failed += 1;
    const message =
      outcome.payload?.error ||
      outcome.payload?.message ||
      (Array.isArray(outcome.payload?.errors) && outcome.payload.errors[0]?.message) ||
      `HTTP ${outcome.status}`;
    console.log(`${prefix} fail ${relPath} -> ${message}`);
  });

  console.log(
    `[done] uploaded=${counts.uploaded} failed=${counts.failed} skipped=${counts.skipped} skippedCached=${counts.skippedCached} aiSuggested=${counts.aiSuggested}`
  );
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { parseArgs };
