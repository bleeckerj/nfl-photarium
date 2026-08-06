#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { MAX_VERBOSITY, setupLogger, trace } from './lib/cliLogger.mjs';
import {
  buildCheckpointIndexes, buildDefaultReportPaths, choosePreferredRecord, createMinIntervalLimiter,
  expandHome, fetchJsonWithRetry, hashFileContent, loadJson, normalizeDiscordAttachmentUrl,
  normalizeUrlForExtras, runWithConcurrency, setWaitForHttpSlot, walkImageFiles,
} from './backfill-discord-image-metadata/helpers.mjs';

function printUsage() {
  console.log(`Backfill Discord prompt + folder metadata onto existing images (UUID-safe).

This script never re-uploads assets. It updates existing image records in place via:
- PATCH /api/images/:id/update (folder)
- PATCH /api/images/:id/extras (sourceUrl/originalUrl fields)
- PATCH /api/images/:id/prompt (PromptThis)

Usage:
  node scripts/backfill-discord-image-metadata.mjs [options]

Options:
  --api-base <url>          Local API base URL (default: http://localhost:3000)
  --checkpoint-file <path>  fs:ingest checkpoint JSON
                            (default: data/fs-ingest-checkpoints/discord-shared-multi-namespace.json)
  --images-root <path>      Discord channels root directory
                            (default: ~/Code/chester-downloads-discord-images/images)
  --concurrency <n>         Parallel processing workers (default: 4)
  --retries <n>             Retry attempts for API calls (default: 3)
  --request-spacing-ms <n>  Min delay between API attempts (default: 250)
  --timeout-ms <n>          HTTP timeout for each API call (default: 20000)
  --catalog-refresh-timeout-ms <n>
                            HTTP timeout for catalog refresh call (default: 120000)
  --no-catalog-refresh      Skip explicit catalog refresh=1 call (not recommended)
  --limit <n>               Stop after scanning N local images
  --report-json <path>      JSON report output path
  --report-ndjson <path>    NDJSON report output path
  --apply                   Execute updates (default: dry-run)
  --verbose                 Enable max verbosity (same as --verbosity 4)
  --verbosity <0..4>        Log level (default: 4)
  --quiet                   Errors only (same as --verbosity 0)
  --no-color                Disable ANSI colors
  --help                    Show this help

Examples:
  node scripts/backfill-discord-image-metadata.mjs
  node scripts/backfill-discord-image-metadata.mjs --apply
  node scripts/backfill-discord-image-metadata.mjs --apply --concurrency 2 --retries 4
`);
}

function parseArgs(argv) {
  const defaults = {
    apiBase: 'http://localhost:3000',
    checkpointFile: path.resolve('data', 'fs-ingest-checkpoints', 'discord-shared-multi-namespace.json'),
    imagesRoot: path.resolve(os.homedir(), 'Code', 'chester-downloads-discord-images', 'images'),
    concurrency: 2,
    retries: 3,
    requestSpacingMs: 250,
    timeoutMs: 20_000,
    catalogRefreshTimeoutMs: 120_000,
    catalogRefresh: true,
    limit: 0,
    apply: false,
    verbosity: 4,
    color: true,
    help: false,
  };

  const opts = { ...defaults, reportJson: '', reportNdjson: '' };
  const errors = [];

  function requireValue(flag, value) {
    if (!value || value.startsWith('--')) {
      errors.push(`Missing value for ${flag}`);
      return false;
    }
    return true;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--') {
      continue;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--api-base') {
      if (!requireValue(arg, next)) continue;
      opts.apiBase = String(next).trim().replace(/\/+$/, '');
      i += 1;
    } else if (arg === '--checkpoint-file') {
      if (!requireValue(arg, next)) continue;
      opts.checkpointFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--images-root') {
      if (!requireValue(arg, next)) continue;
      opts.imagesRoot = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--concurrency') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) errors.push(`Invalid concurrency: ${next}`);
      else opts.concurrency = parsed;
      i += 1;
    } else if (arg === '--retries') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) errors.push(`Invalid retries: ${next}`);
      else opts.retries = parsed;
      i += 1;
    } else if (arg === '--request-spacing-ms') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0) errors.push(`Invalid request-spacing-ms: ${next}`);
      else opts.requestSpacingMs = parsed;
      i += 1;
    } else if (arg === '--timeout-ms') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1000) errors.push(`Invalid timeout-ms: ${next}`);
      else opts.timeoutMs = parsed;
      i += 1;
    } else if (arg === '--catalog-refresh-timeout-ms') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1000) errors.push(`Invalid catalog-refresh-timeout-ms: ${next}`);
      else opts.catalogRefreshTimeoutMs = parsed;
      i += 1;
    } else if (arg === '--limit') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) errors.push(`Invalid limit: ${next}`);
      else opts.limit = parsed;
      i += 1;
    } else if (arg === '--no-catalog-refresh') {
      opts.catalogRefresh = false;
    } else if (arg === '--report-json') {
      if (!requireValue(arg, next)) continue;
      opts.reportJson = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--report-ndjson') {
      if (!requireValue(arg, next)) continue;
      opts.reportNdjson = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--apply') {
      opts.apply = true;
    } else if (arg === '--verbose') {
      opts.verbosity = MAX_VERBOSITY;
    } else if (arg === '--verbosity') {
      if (!requireValue(arg, next)) continue;
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_VERBOSITY) {
        errors.push(`Invalid verbosity (expected 0-${MAX_VERBOSITY}): ${next}`);
      } else {
        opts.verbosity = parsed;
      }
      i += 1;
    } else if (/^-v+$/.test(arg)) {
      const parsed = Math.min(MAX_VERBOSITY, Math.max(1, arg.length - 1));
      opts.verbosity = parsed;
    } else if (arg === '--quiet' || arg === '-q') {
      opts.verbosity = 0;
    } else if (arg === '--no-color') {
      opts.color = false;
    } else {
      errors.push(`Unknown option: ${arg}`);
    }
  }

  return { opts, errors };
}

async function main() {
  const { opts, errors } = parseArgs(process.argv.slice(2));
  setupLogger({ verbosity: opts.verbosity, color: opts.color });
  setWaitForHttpSlot(createMinIntervalLimiter(opts.requestSpacingMs));
  console.log('🎛️  Logger initialized', { verbosity: opts.verbosity, color: opts.color });
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

  console.log('🧰 Starting Discord metadata backfill script');
  trace(`📦 Runtime config ${JSON.stringify(opts)}`);
  if (opts.apply && opts.concurrency > 2) {
    console.warn(`🐢 --apply with concurrency=${opts.concurrency} may trigger throttling; consider --concurrency 1 or 2`);
  }

  const imagesRootStat = await fs.stat(opts.imagesRoot).catch(() => null);
  if (!imagesRootStat?.isDirectory()) {
    throw new Error(`Images root not found or not a directory: ${opts.imagesRoot}`);
  }
  console.log(`📂 Images root ready: ${opts.imagesRoot}`);

  const checkpointRaw = await fs.readFile(opts.checkpointFile, 'utf8').catch(() => null);
  if (!checkpointRaw) {
    throw new Error(`Checkpoint file not found: ${opts.checkpointFile}`);
  }
  console.log(`🗂️  Checkpoint loaded: ${opts.checkpointFile}`);
  const checkpoint = JSON.parse(checkpointRaw);
  const checkpointIndexes = buildCheckpointIndexes(checkpoint);

  const reportDefaults = buildDefaultReportPaths();
  const reportJsonPath = opts.reportJson || reportDefaults.jsonPath;
  const reportNdjsonPath = opts.reportNdjson || reportDefaults.ndjsonPath;

  console.log(`🔍 Scanning Discord images (limit=${opts.limit || 'none'}) ...`);
  const localFiles = await walkImageFiles(opts.imagesRoot, opts.limit);
  console.log(`🧮 Local image candidates discovered: ${localFiles.length}`);
  console.log('🌐 Fetching catalog snapshot from local API ...');
  let cachedCatalogImages = [];
  let refreshedCatalogImages = [];
  let cachedFetchError = null;

  try {
    const cachedPayload = await fetchJsonWithRetry(`${opts.apiBase}/api/images?namespace=__all__`, { method: 'GET' }, {
      retries: opts.retries,
      timeoutMs: opts.timeoutMs,
      label: 'catalog-list-cached',
    });
    cachedCatalogImages = Array.isArray(cachedPayload?.images) ? cachedPayload.images : [];
    console.log(`🧾 Cached catalog entries: ${cachedCatalogImages.length}`);
  } catch (error) {
    cachedFetchError = error;
    console.warn(`📡 Cached catalog fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (opts.catalogRefresh) {
    try {
      const refreshPayload = await fetchJsonWithRetry(`${opts.apiBase}/api/images?namespace=__all__&refresh=1`, { method: 'GET' }, {
        retries: opts.retries,
        timeoutMs: opts.catalogRefreshTimeoutMs,
        label: 'catalog-list-refresh',
      });
      refreshedCatalogImages = Array.isArray(refreshPayload?.images) ? refreshPayload.images : [];
      console.log(`🔄 Refreshed catalog entries: ${refreshedCatalogImages.length}`);
    } catch (error) {
      console.warn(`📡 Refresh catalog fetch failed: ${error instanceof Error ? error.message : String(error)}. Continuing with cached snapshot.`);
    }
  } else {
    console.log('⏭️  Catalog refresh disabled (--no-catalog-refresh)');
  }

  if (cachedCatalogImages.length === 0 && refreshedCatalogImages.length === 0) {
    if (cachedFetchError) {
      throw new Error(`Failed to load catalog snapshot: ${cachedFetchError instanceof Error ? cachedFetchError.message : String(cachedFetchError)}`);
    }
    throw new Error('Failed to load catalog snapshot: no images returned from cache or refresh');
  }

  const catalogByIdSeed = new Map();
  for (const image of cachedCatalogImages) {
    if (image && typeof image.id === 'string') {
      catalogByIdSeed.set(image.id, image);
    }
  }
  for (const image of refreshedCatalogImages) {
    if (image && typeof image.id === 'string') {
      catalogByIdSeed.set(image.id, image);
    }
  }
  const catalogImages = Array.from(catalogByIdSeed.values());
  console.log(`📚 Catalog IDs available for matching: ${catalogImages.length}`);
  const catalogById = new Map(
    catalogImages
      .filter((image) => image && typeof image.id === 'string')
      .map((image) => [image.id, image])
  );

  const planByAssetId = new Map();
  const ndjsonRows = [];

  let checkpointMatched = 0;
  let hashMatched = 0;
  let unmatched = 0;
  let matchConflicts = 0;
  let promptMissing = 0;
  let sourceUrlMissing = 0;

  for (let scanIndex = 0; scanIndex < localFiles.length; scanIndex += 1) {
    const localFile = localFiles[scanIndex];
    if (opts.verbosity >= 4) {
      trace(`🔎 [${scanIndex + 1}/${localFiles.length}] Inspecting ${localFile.relPath}`);
    } else if ((scanIndex + 1) % 25 === 0) {
      console.log(`🔎 Scan progress ${scanIndex + 1}/${localFiles.length}`);
    }
    let prompt = '';
    let sidecarChannelName = '';
    let sidecarChannelId = '';
    let sidecarMessageUrl = '';
    let sidecarOriginalUrl = '';

    const sidecar = await loadJson(localFile.sidecarPath).catch(() => null);
    if (sidecar && typeof sidecar === 'object') {
      prompt = typeof sidecar.content === 'string' ? sidecar.content.trim() : '';
      sidecarChannelName = typeof sidecar.channel_name === 'string' ? sidecar.channel_name.trim() : '';
      sidecarChannelId = typeof sidecar.channel_id === 'string' ? sidecar.channel_id.trim() : '';
      sidecarMessageUrl = typeof sidecar.message_url === 'string' ? sidecar.message_url.trim() : '';
      const attachments = Array.isArray(sidecar.attachments) ? sidecar.attachments : [];
      const firstAttachment = attachments.find((item) => typeof item === 'string' && item.trim());
      sidecarOriginalUrl = typeof firstAttachment === 'string' ? normalizeDiscordAttachmentUrl(firstAttachment) : '';
    }

    if (!prompt) promptMissing += 1;
    if (!sidecarMessageUrl) sourceUrlMissing += 1;

    const relCandidates = checkpointIndexes.relPathToAssetIds.get(localFile.relPath);
    let candidateAssetIds = relCandidates ? Array.from(relCandidates) : [];
    let matchMethod = 'none';
    let contentHash = '';

    if (candidateAssetIds.length === 1) {
      matchMethod = 'checkpoint';
      checkpointMatched += 1;
    } else if (candidateAssetIds.length > 1) {
      matchMethod = 'conflict';
      matchConflicts += 1;
    } else {
      contentHash = await hashFileContent(localFile.absPath).catch(() => '');
      if (contentHash) {
        const hashCandidates = checkpointIndexes.hashToAssetIds.get(contentHash);
        candidateAssetIds = hashCandidates ? Array.from(hashCandidates) : [];
      }
      if (candidateAssetIds.length === 1) {
        matchMethod = 'hash';
        hashMatched += 1;
      } else if (candidateAssetIds.length > 1) {
        matchMethod = 'conflict';
        matchConflicts += 1;
      } else {
        unmatched += 1;
      }
    }

    const rowBase = {
      localRelPath: localFile.relPath,
      channelFolder: localFile.channelFolderName,
      channelName: sidecarChannelName || localFile.channelName,
      channelId: sidecarChannelId || localFile.channelId,
      targetFolder: localFile.targetFolder,
      promptPresent: Boolean(prompt),
      sourceUrlPresent: Boolean(sidecarMessageUrl),
      originalUrlPresent: Boolean(sidecarOriginalUrl),
      matchMethod,
      contentHash: contentHash || undefined,
      candidateAssetIds,
    };

    if (candidateAssetIds.length !== 1) {
      ndjsonRows.push({
        status: matchMethod === 'conflict' ? 'conflicted' : 'unmatched',
        ...rowBase,
      });
      continue;
    }

    const assetId = candidateAssetIds[0];
    const candidateRecord = {
      assetId,
      localRelPath: localFile.relPath,
      channelFolder: localFile.channelFolderName,
      channelName: sidecarChannelName || localFile.channelName,
      channelId: sidecarChannelId || localFile.channelId,
      targetFolder: localFile.targetFolder,
      prompt,
      sourceUrl: sidecarMessageUrl,
      originalUrl: sidecarOriginalUrl,
      matchMethod,
    };

    const existing = planByAssetId.get(assetId) || {
      assetId,
      primary: null,
      collisions: [],
    };
    const previousPrimary = existing.primary;
    const nextPrimary = choosePreferredRecord(previousPrimary, candidateRecord);

    if (previousPrimary && nextPrimary !== previousPrimary) {
      existing.collisions.push(previousPrimary);
    }
    if (previousPrimary && nextPrimary === previousPrimary) {
      existing.collisions.push(candidateRecord);
    }

    existing.primary = nextPrimary;
    planByAssetId.set(assetId, existing);
  }

  const plans = Array.from(planByAssetId.values());
  const totalPlans = plans.length;
  let completedPlans = 0;
  let notInCatalogWarnCount = 0;

  const totals = {
    scannedLocalFiles: localFiles.length,
    matchedCheckpoint: checkpointMatched,
    matchedHashFallback: hashMatched,
    unmatched,
    conflictedMatches: matchConflicts,
    promptMissing,
    sourceUrlMissing,
    plannedAssets: plans.length,
    skippedNotInCatalog: 0,
    skippedConflict: 0,
    skippedNoChanges: 0,
    matched: 0,
    updatedFolder: 0,
    clearedMetadataUrlFields: 0,
    updatedSourceUrl: 0,
    updatedOriginalUrl: 0,
    updatedPrompt: 0,
    failed: 0,
  };

  console.log(`[backfill] mode=${opts.apply ? 'apply' : 'dry-run'} apiBase=${opts.apiBase}`);
  console.log(`[backfill] imagesRoot=${opts.imagesRoot}`);
  console.log(`[backfill] checkpointFile=${opts.checkpointFile}`);
  console.log(`[backfill] localFiles=${totals.scannedLocalFiles} checkpointMatched=${totals.matchedCheckpoint} hashMatched=${totals.matchedHashFallback} unmatched=${totals.unmatched} conflicted=${totals.conflictedMatches}`);
  console.log(`[backfill] plannedAssets=${totals.plannedAssets}`);

  await runWithConcurrency(plans, opts.concurrency, async (plan, index) => {
    const primary = plan.primary;
    if (opts.verbosity >= 4) {
      trace(`📌 plan ${index + 1}/${totalPlans} start asset=${plan.assetId}`);
    }
    try {
      if (!primary) {
        totals.skippedConflict += 1;
        if (opts.verbosity >= 4) {
          trace(`[backfill][skip:no-primary] ${plan.assetId} (no resolved primary candidate)`);
        }
        return;
      }

      if (plan.collisions.length > 0) {
        totals.skippedConflict += 1;
        if (opts.verbosity >= 4) {
          trace(`[backfill][collision] ${plan.assetId} primary=${primary.localRelPath} alternatives=${plan.collisions.length}`);
        }
      }

      const current = catalogById.get(plan.assetId);
      if (!current) {
        totals.skippedNotInCatalog += 1;
        ndjsonRows.push({
          status: 'skipped-not-in-catalog',
          assetId: plan.assetId,
          matchMethod: primary.matchMethod,
          localRelPath: primary.localRelPath,
          channelFolder: primary.channelFolder,
          collisionCount: plan.collisions.length,
        });
        notInCatalogWarnCount += 1;
        if (notInCatalogWarnCount <= 25) {
          console.warn(`[backfill][skip:not-in-catalog] asset=${plan.assetId} local=${primary.localRelPath} match=${primary.matchMethod} (catalog snapshot did not include this ID)`);
        } else if (notInCatalogWarnCount % 250 === 0) {
          console.warn(`[backfill][skip:not-in-catalog] count=${notInCatalogWarnCount} (showing first 25 individually; see NDJSON report for all IDs)`);
        }
        if (opts.verbosity >= 4) {
          trace(`[backfill][skip:not-in-catalog] ${plan.assetId} local=${primary.localRelPath}`);
        }
        return;
      }

      totals.matched += 1;

      const currentFolder = typeof current.folder === 'string' ? current.folder : '';
      const currentSourceUrl = typeof current.sourceUrl === 'string' ? current.sourceUrl : '';
      const currentOriginalUrl = typeof current.originalUrl === 'string' ? current.originalUrl : '';
      const desiredSourceUrl = primary.sourceUrl ? normalizeUrlForExtras(primary.sourceUrl) : '';
      const desiredOriginalUrl = primary.originalUrl ? normalizeUrlForExtras(primary.originalUrl) : '';
      const desiredSourceUrlNormalized = desiredSourceUrl;
      const desiredOriginalUrlNormalized = desiredOriginalUrl;
      const folderNeedsUpdate = currentFolder !== primary.targetFolder;
      const shouldClearMetadataUrlFields = Boolean(currentSourceUrl) || Boolean(currentOriginalUrl);
      const sourceUrlNeedsUpdate = Boolean(desiredSourceUrl) && currentSourceUrl !== desiredSourceUrl;
      const originalUrlNeedsUpdate = Boolean(desiredOriginalUrl) && currentOriginalUrl !== desiredOriginalUrl;
      const shouldUpdatePrompt = Boolean(primary.prompt);

      if (!folderNeedsUpdate && !shouldClearMetadataUrlFields && !sourceUrlNeedsUpdate && !originalUrlNeedsUpdate && !shouldUpdatePrompt) {
        totals.skippedNoChanges += 1;
        ndjsonRows.push({
          status: 'skipped-no-changes',
          assetId: plan.assetId,
          localRelPath: primary.localRelPath,
          matchMethod: primary.matchMethod,
          folder: currentFolder,
          sourceUrl: currentSourceUrl || undefined,
          originalUrl: currentOriginalUrl || undefined,
          promptPresent: shouldUpdatePrompt,
          collisionCount: plan.collisions.length,
        });
        if (opts.verbosity >= 4) {
          trace(`[backfill][skip:no-changes] ${plan.assetId} folder=${currentFolder || '(empty)'} sourceUrl=${currentSourceUrl ? '1' : '0'} originalUrl=${currentOriginalUrl ? '1' : '0'} prompt=${shouldUpdatePrompt ? '1' : '0'}`);
        }
        return;
      }

      if (!opts.apply) {
        if (folderNeedsUpdate) totals.updatedFolder += 1;
        if (shouldClearMetadataUrlFields) totals.clearedMetadataUrlFields += 1;
        if (sourceUrlNeedsUpdate) totals.updatedSourceUrl += 1;
        if (originalUrlNeedsUpdate) totals.updatedOriginalUrl += 1;
        if (shouldUpdatePrompt) totals.updatedPrompt += 1;
        ndjsonRows.push({
          status: 'dry-run',
          assetId: plan.assetId,
          localRelPath: primary.localRelPath,
          matchMethod: primary.matchMethod,
          currentFolder,
          desiredFolder: primary.targetFolder,
          wouldUpdateFolder: folderNeedsUpdate,
          currentSourceUrl: currentSourceUrl || undefined,
          desiredSourceUrl: desiredSourceUrl || undefined,
          wouldUpdateSourceUrl: sourceUrlNeedsUpdate,
          currentOriginalUrl: currentOriginalUrl || undefined,
          desiredOriginalUrl: desiredOriginalUrl || undefined,
          wouldUpdateOriginalUrl: originalUrlNeedsUpdate,
          wouldClearMetadataUrlFields: shouldClearMetadataUrlFields,
          wouldUpdatePrompt: shouldUpdatePrompt,
          collisionCount: plan.collisions.length,
        });
        if (opts.verbosity >= 4) {
          trace(`[backfill][dry-run] ${plan.assetId} folder=${folderNeedsUpdate ? '1' : '0'} clearMetaUrls=${shouldClearMetadataUrlFields ? '1' : '0'} sourceUrlExtras=${sourceUrlNeedsUpdate ? '1' : '0'} originalUrlExtras=${originalUrlNeedsUpdate ? '1' : '0'} prompt=${shouldUpdatePrompt ? '1' : '0'}`);
        }
        return;
      }

      if (folderNeedsUpdate || shouldClearMetadataUrlFields) {
        const updatePayload = {};
        if (folderNeedsUpdate) updatePayload.folder = primary.targetFolder;
        if (shouldClearMetadataUrlFields) {
          // Migrate URL-like fields out of Cloudflare metadata into extras storage.
          updatePayload.sourceUrl = '';
          updatePayload.originalUrl = '';
        }
        await fetchJsonWithRetry(`${opts.apiBase}/api/images/${encodeURIComponent(plan.assetId)}/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        }, {
          retries: opts.retries,
          timeoutMs: opts.timeoutMs,
          label: `update:${plan.assetId}`,
        });
        if (folderNeedsUpdate) totals.updatedFolder += 1;
        if (shouldClearMetadataUrlFields) totals.clearedMetadataUrlFields += 1;
      }

      if (sourceUrlNeedsUpdate || originalUrlNeedsUpdate) {
        const extrasPayload = {};
        if (sourceUrlNeedsUpdate) {
          extrasPayload.sourceUrl = desiredSourceUrl;
          extrasPayload.sourceUrlNormalized = desiredSourceUrlNormalized;
        }
        if (originalUrlNeedsUpdate) {
          extrasPayload.originalUrl = desiredOriginalUrl;
          extrasPayload.originalUrlNormalized = desiredOriginalUrlNormalized;
        }
        if (Object.keys(extrasPayload).length > 0) {
          await fetchJsonWithRetry(`${opts.apiBase}/api/images/${encodeURIComponent(plan.assetId)}/extras`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(extrasPayload),
          }, {
            retries: opts.retries,
            timeoutMs: opts.timeoutMs,
            label: `extras:${plan.assetId}`,
          });
          if (sourceUrlNeedsUpdate) totals.updatedSourceUrl += 1;
          if (originalUrlNeedsUpdate) totals.updatedOriginalUrl += 1;
        }
      }

      if (shouldUpdatePrompt) {
        await fetchJsonWithRetry(`${opts.apiBase}/api/images/${encodeURIComponent(plan.assetId)}/prompt`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: primary.prompt }),
        }, {
          retries: opts.retries,
          timeoutMs: opts.timeoutMs,
          label: `prompt:${plan.assetId}`,
        });
        totals.updatedPrompt += 1;
      }

      ndjsonRows.push({
        status: 'updated',
        assetId: plan.assetId,
        localRelPath: primary.localRelPath,
        matchMethod: primary.matchMethod,
        updatedFolder: folderNeedsUpdate,
        clearedMetadataUrlFields: shouldClearMetadataUrlFields,
        updatedSourceUrl: sourceUrlNeedsUpdate,
        updatedOriginalUrl: originalUrlNeedsUpdate,
        updatedPrompt: shouldUpdatePrompt,
        desiredFolder: primary.targetFolder,
        desiredSourceUrl: desiredSourceUrl || undefined,
        desiredOriginalUrl: desiredOriginalUrl || undefined,
        collisionCount: plan.collisions.length,
      });

      if (opts.verbosity >= 3) {
        console.log(`[backfill][updated] ${plan.assetId} folder=${folderNeedsUpdate ? '1' : '0'} clearMetaUrls=${shouldClearMetadataUrlFields ? '1' : '0'} sourceUrlExtras=${sourceUrlNeedsUpdate ? '1' : '0'} originalUrlExtras=${originalUrlNeedsUpdate ? '1' : '0'} prompt=${shouldUpdatePrompt ? '1' : '0'}`);
      }
    } catch (error) {
      totals.failed += 1;
      ndjsonRows.push({
        status: 'failed',
        assetId: plan.assetId,
        localRelPath: primary?.localRelPath,
        matchMethod: primary?.matchMethod,
        error: error instanceof Error ? error.message : String(error),
        collisionCount: plan.collisions.length,
      });
      console.warn(`[backfill][failed] ${plan.assetId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      completedPlans += 1;
      const remaining = Math.max(0, totalPlans - completedPlans);
      if (opts.verbosity >= 3 || completedPlans % 50 === 0 || completedPlans === totalPlans) {
        console.log(`📊 progress processed=${completedPlans}/${totalPlans} remaining=${remaining} failed=${totals.failed}`);
      }
    }
  });

  for (const plan of plans) {
    if (!plan.primary) continue;
    if (plan.collisions.length === 0) continue;
    ndjsonRows.push({
      status: 'collision',
      assetId: plan.assetId,
      primary: {
        localRelPath: plan.primary.localRelPath,
        channelFolder: plan.primary.channelFolder,
        matchMethod: plan.primary.matchMethod,
      },
      alternatives: plan.collisions.map((row) => ({
        localRelPath: row.localRelPath,
        channelFolder: row.channelFolder,
        matchMethod: row.matchMethod,
      })),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: opts.apply ? 'apply' : 'dry-run',
    config: {
      apiBase: opts.apiBase,
      imagesRoot: opts.imagesRoot,
      checkpointFile: opts.checkpointFile,
      concurrency: opts.concurrency,
      retries: opts.retries,
      timeoutMs: opts.timeoutMs,
      limit: opts.limit,
    },
    totals,
  };

  await fs.mkdir(path.dirname(reportJsonPath), { recursive: true });
  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  await fs.mkdir(path.dirname(reportNdjsonPath), { recursive: true });
  const ndjson = ndjsonRows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(reportNdjsonPath, ndjson.length ? `${ndjson}\n` : '', 'utf8');

  console.log(`[backfill] matched=${totals.matched} updatedFolder=${totals.updatedFolder} clearedMetadataUrlFields=${totals.clearedMetadataUrlFields} updatedSourceUrl=${totals.updatedSourceUrl} updatedOriginalUrl=${totals.updatedOriginalUrl} updatedPrompt=${totals.updatedPrompt} skippedNoChanges=${totals.skippedNoChanges} skippedNotInCatalog=${totals.skippedNotInCatalog} failed=${totals.failed}`);
  console.log(`[backfill] reportJson=${reportJsonPath}`);
  console.log(`[backfill] reportNdjson=${reportNdjsonPath}`);
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
