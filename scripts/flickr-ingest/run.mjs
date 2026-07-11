import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  accessToken,
  buildAuthorizeUrl,
  requestToken,
} from './oauth.mjs';
import { createFlickrClient, resolveAlbumsBySelector } from './flickr-client.mjs';
import {
  buildEntryUpdate,
  appendRunEvent,
  checkpointLogLabel,
  countSuccessfulCheckpointEntries,
  isSuccessfulCheckpointEntry,
  loadCheckpoint,
  saveCheckpoint,
  shouldSkipCheckpointEntry,
} from './checkpoint.mjs';
import {
  buildFlickrExtras,
  buildPhotariumMetadata,
  chooseBestPhotoSource,
  chooseBestVideoSource,
  inferDownloadFileName,
  normalizeAlbumTitles,
} from './mapping.mjs';
import {
  patchPhotariumExtras,
  uploadImageToPhotarium,
  uploadVideoToPhotarium,
} from './photarium-client.mjs';
import { selectorFingerprint } from './constants.mjs';
import {
  contentHash,
  createMinIntervalLimiter,
  createSharedDownloadGate,
  createSerializedTaskQueue,
  retryWithBackoff,
  runWithConcurrency,
  writeJsonAtomic,
} from './util.mjs';

function buildSelectorSpec(options) {
  return {
    selector: options.selector,
    albums: options.albums,
    albumIds: options.albumIds,
    tags: options.tags,
    tagMode: options.tagMode,
    namespace: options.namespace,
  };
}

async function loadStoredAuth(options) {
  const payload = await import('./util.mjs').then(({ readJsonIfExists }) => readJsonIfExists(options.authFile, null));
  if (!payload) {
    throw new Error(`Auth file not found: ${options.authFile}`);
  }
  return payload;
}

async function downloadBuffer(url, options, logger, downloadGate) {
  const response = await retryWithBackoff(
    async () => {
      await downloadGate.waitForTurn();
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Photarium Flickr Ingest/1.0',
        },
      });
      if (!res.ok) {
        const error = new Error(`Download failed (${res.status})`);
        const retryAfterHeader = res.headers.get('retry-after') || '';
        const retryAfterMs = Number(retryAfterHeader || 0) * 1000;
        error.retryAfterMs = retryAfterMs;
        error.status = res.status;
        error.host = new URL(url).host;
        error.retryAfterHeader = retryAfterHeader;
        error.rateLimitRemaining = res.headers.get('x-ratelimit-remaining') || '';
        error.rateLimitReset = res.headers.get('x-ratelimit-reset') || '';
        error.cacheStatus = res.headers.get('x-cache') || res.headers.get('cf-cache-status') || '';
        error.responseExcerpt = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 240);
        if (res.status === 429) {
          const cooldown = downloadGate.reportRateLimit(retryAfterMs);
          error.retryAfterMs = cooldown.cooldownMs;
          error.sharedCooldownMs = cooldown.cooldownMs;
          error.consecutiveRateLimits = cooldown.consecutiveRateLimits;
        }
        error.downloadDiagnostics = [
          `host=${error.host}`,
          `retry-after=${error.retryAfterHeader || 'absent'}`,
          `rate-remaining=${error.rateLimitRemaining || 'unknown'}`,
          `rate-reset=${error.rateLimitReset || 'unknown'}`,
          `cache=${error.cacheStatus || 'unknown'}`,
          error.sharedCooldownMs ? `shared-cooldown-ms=${error.sharedCooldownMs}` : '',
          error.responseExcerpt ? `response=${JSON.stringify(error.responseExcerpt)}` : '',
        ].filter(Boolean).join(' ');
        throw error;
      }
      downloadGate.reportSuccess();
      return res;
    },
    {
      retries: options.retryMax,
      baseDelayMs: options.retryBaseMs,
      shouldRetry(error) {
        const status = Number(error?.status || 0);
        return status === 429 || status >= 500;
      },
      onRetry(error, attempt, waitMs) {
        logger.warn(`retrying download after attempt ${attempt} in ${waitMs}ms (${error.message}; ${error.downloadDiagnostics})`);
      },
    }
  );

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: (response.headers.get('content-type') || '').split(';')[0].trim(),
  };
}

async function fetchPhotoDetails(client, listPhoto, logger, apiLimiter, options) {
  await apiLimiter();
  const info = await retryWithBackoff(
    () => client.getPhotoInfo(listPhoto.id),
    {
      retries: options.retryMax,
      baseDelayMs: options.retryBaseMs,
      shouldRetry: () => true,
      onRetry(error, attempt, waitMs) {
        logger.warn(`retrying photo info for ${listPhoto.id} after attempt ${attempt} in ${waitMs}ms (${error.message})`);
      },
    }
  );

  await apiLimiter();
  const contexts = await retryWithBackoff(
    () => client.getPhotoContexts(listPhoto.id),
    {
      retries: options.retryMax,
      baseDelayMs: options.retryBaseMs,
      shouldRetry: () => true,
      onRetry(error, attempt, waitMs) {
        logger.warn(`retrying photo contexts for ${listPhoto.id} after attempt ${attempt} in ${waitMs}ms (${error.message})`);
      },
    }
  );

  let source = info.media === 'video' ? null : chooseBestPhotoSource(listPhoto);
  if (!source || info.media === 'video') {
    await apiLimiter();
    const sizes = await retryWithBackoff(
      () => client.getPhotoSizes(listPhoto.id),
      {
        retries: options.retryMax,
        baseDelayMs: options.retryBaseMs,
        shouldRetry: () => true,
        onRetry(error, attempt, waitMs) {
          logger.warn(`retrying photo sizes for ${listPhoto.id} after attempt ${attempt} in ${waitMs}ms (${error.message})`);
        },
      }
    );
    source = info.media === 'video'
      ? chooseBestVideoSource(sizes)
      : chooseBestPhotoSource(listPhoto, sizes);
  }

  return {
    info,
    contexts,
    source,
  };
}

export async function runAuthCommand(options, logger) {
  logger.banner('Flickr auth handshake');
  const request = await requestToken({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
  });

  const authorizeUrl = buildAuthorizeUrl(request.oauth_token);
  logger.info(`Open this URL in a browser and approve read access: ${authorizeUrl}`);

  const rl = createInterface({ input, output });
  const verifier = (await rl.question('Paste the Flickr verifier code: ')).trim();
  rl.close();

  if (!verifier) {
    throw new Error('Verifier code is required.');
  }

  const access = await accessToken({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    requestTokenValue: request.oauth_token,
    requestTokenSecret: request.oauth_token_secret,
    verifier,
  });

  const client = createFlickrClient({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    oauthToken: access.oauth_token,
    oauthTokenSecret: access.oauth_token_secret,
  });
  const profile = await client.testLogin();

  await writeJsonAtomic(options.authFile, {
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    oauthToken: access.oauth_token,
    oauthTokenSecret: access.oauth_token_secret,
    userId: access.user_nsid || profile.userId,
    username: access.username || profile.username,
    updatedAt: new Date().toISOString(),
  });

  logger.success(`Stored Flickr auth for ${profile.username || profile.userId} at ${options.authFile}`);
}

export async function collectSelectedPhotos({ client, authProfile, options, logger, checkpoint }) {
  const seen = new Set();
  const selected = [];
  const selectedAlbumsByPhotoId = new Map();
  const accountProgressByPhotoId = new Map();
  let accountPosition = 0;
  let accountTotal = 0;

  const isEligible = (photo) => !shouldSkipCheckpointEntry(
    checkpoint.entries[photo.id],
    photo.lastUpdate,
    options.resume,
  );

  if (options.selector === 'album') {
    const albums = await client.listAlbums(authProfile.userId);
    const resolved = resolveAlbumsBySelector(albums, options.albums, options.albumIds);
    if (resolved.duplicateTitles.length > 0) {
      throw new Error(`Album title is ambiguous: ${resolved.duplicateTitles.join(', ')}. Use --album-id.`);
    }
    if (resolved.missing.length > 0) {
      throw new Error(`Album selector did not match: ${resolved.missing.join(', ')}`);
    }

    for (const album of resolved.matched) {
      logger.info(`Resolving album "${album.title}" (${album.id})`);
      for await (const page of client.listAlbumPhotos(album.id)) {
        logger.debug(`album ${album.id} page ${page.page}/${page.totalPages} -> ${page.items.length} photo(s)`);
        for (const photo of page.items) {
          if (seen.has(photo.id)) {
            const titles = selectedAlbumsByPhotoId.get(photo.id) || [];
            titles.push(album.title);
            selectedAlbumsByPhotoId.set(photo.id, titles);
            continue;
          }
          seen.add(photo.id);
          if (!isEligible(photo)) continue;
          selected.push(photo);
          selectedAlbumsByPhotoId.set(photo.id, [album.title]);
          if (options.limit > 0 && selected.length >= options.limit) {
            return { selected, selectedAlbumsByPhotoId, accountProgressByPhotoId, accountTotal };
          }
        }
      }
    }

    return { selected, selectedAlbumsByPhotoId, accountProgressByPhotoId, accountTotal };
  }

  const source = options.selector === 'tag'
    ? client.searchUserPhotosByTags(authProfile.userId, options.tags, options.tagMode)
    : client.listAllUserPhotos(authProfile.userId);

  for await (const page of source) {
    logger.debug(`selector ${options.selector} page ${page.page}/${page.totalPages} -> ${page.items.length} photo(s)`);
    if (options.selector === 'all') accountTotal = page.totalItems;
    for (const photo of page.items) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      if (options.selector === 'all') {
        accountPosition += 1;
        accountProgressByPhotoId.set(photo.id, { position: accountPosition, total: accountTotal });
      }
      if (!isEligible(photo)) continue;
      selected.push(photo);
      if (options.limit > 0 && selected.length >= options.limit) {
        return { selected, selectedAlbumsByPhotoId, accountProgressByPhotoId, accountTotal };
      }
    }
  }

  return { selected, selectedAlbumsByPhotoId, accountProgressByPhotoId, accountTotal };
}

export function formatCompletionProgress(completed, total) {
  if (!total) return '';
  const boundedCompleted = Math.min(completed, total);
  const remaining = Math.max(total - boundedCompleted, 0);
  return `[${boundedCompleted.toLocaleString('en-US')}/${remaining.toLocaleString('en-US')}/${total.toLocaleString('en-US')} complete/left/total]`;
}

export function formatElapsedTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function estimateRemainingTime({ elapsedMs, successful, remaining }) {
  if (successful <= 0 || remaining <= 0) return null;
  return (elapsedMs / successful) * remaining;
}

export function formatPhotoProgress({ index, trancheSize, completionProgress, elapsedMs }) {
  const tranche = `[${index + 1}/${trancheSize} tranche]`;
  const completion = completionProgress
    ? formatCompletionProgress(completionProgress.completed, completionProgress.total)
    : '';
  const elapsed = Number.isFinite(elapsedMs) ? `[elapsed ${formatElapsedTime(elapsedMs)}]` : '';
  return [completion, tranche, elapsed].filter(Boolean).join(' ');
}

export async function runIngestCommand(options, logger) {
  const auth = await loadStoredAuth(options);
  const authProfile = {
    userId: auth.userId,
    username: auth.username,
  };
  const client = createFlickrClient(auth);
  if (!authProfile.userId || !authProfile.username) {
    const login = await client.testLogin();
    authProfile.userId = login.userId;
    authProfile.username = login.username;
  }

  const selectorSpec = buildSelectorSpec(options);
  const checkpointKey = selectorFingerprint(selectorSpec);
  const checkpoint = await loadCheckpoint(options.checkpointFile, checkpointKey);
  if (!checkpoint.selectorKey) {
    checkpoint.selectorKey = checkpointKey;
  }
  const checkpointWrite = createSerializedTaskQueue();
  const apiLimiter = createMinIntervalLimiter(options.apiThrottleMs);
  const downloadGate = createSharedDownloadGate({ minIntervalMs: options.throttleMs });

  logger.banner('Flickr ingest');
  logger.info(`namespace=${options.namespace} selector=${options.selector} user=${authProfile.username}`);
  logger.info(`checkpoint=${checkpointLogLabel(options.checkpointFile)} runlog=${checkpointLogLabel(options.runLogFile)}`);

  const { selected, selectedAlbumsByPhotoId, accountTotal } = await collectSelectedPhotos({
    client,
    authProfile,
    options,
    logger,
    checkpoint,
  });

  const completionProgress = {
    completed: countSuccessfulCheckpointEntries(checkpoint),
    total: accountTotal,
  };
  logger.info(`selected ${selected.length} media item(s)`);
  if (accountTotal > 0) {
    logger.info(`account progress ${formatCompletionProgress(completionProgress.completed, accountTotal)}`);
  }
  if (selected.length === 0) {
    logger.warn('No incomplete media matched the selector.');
    return;
  }

  const counts = {
    uploaded: 0,
    duplicate: 0,
    failed: 0,
    skipped: 0,
    unsupported: 0,
  };
  const trancheStartedAt = Date.now();

  const runtimeDeadline = options.runtimeMs > 0 ? trancheStartedAt + options.runtimeMs : null;
  let startedCount = 0;

  await runWithConcurrency(selected, options.concurrency, async (listPhoto, index) => {
    startedCount += 1;
    const existingEntry = checkpoint.entries[listPhoto.id];
    const wasComplete = isSuccessfulCheckpointEntry(existingEntry);
    const prefix = () => `${formatPhotoProgress({
      index,
      trancheSize: options.runtimeMs > 0 ? 'runtime' : selected.length,
      completionProgress,
      elapsedMs: Date.now() - trancheStartedAt,
    })} ${listPhoto.id}`;

    if (shouldSkipCheckpointEntry(existingEntry, listPhoto.lastUpdate, options.resume)) {
      counts.skipped += 1;
      logger.debug(`${prefix()} skip unchanged`);
      await appendRunEvent(options.runLogFile, {
        photoId: listPhoto.id,
        status: 'skipped-unchanged',
      });
      checkpoint.entries[listPhoto.id] = buildEntryUpdate({
        existingEntry,
        status: 'skipped-unchanged',
        listPhoto,
        photariumId: existingEntry?.photariumId,
        sourceUrl: existingEntry?.sourceUrl,
        folder: existingEntry?.folder,
        tags: existingEntry?.tags,
        displayName: existingEntry?.displayName,
      });
      await checkpointWrite(() => saveCheckpoint(options.checkpointFile, checkpoint));
      return;
    }

    try {
      const { info, contexts, source } = await fetchPhotoDetails(client, listPhoto, logger, apiLimiter, options);
      if (info.media !== 'photo' && info.media !== 'video') {
        counts.unsupported += 1;
        logger.warn(`${prefix()} unsupported media=${info.media}`);
        checkpoint.entries[listPhoto.id] = buildEntryUpdate({
          existingEntry,
          status: 'unsupported',
          listPhoto,
          errorMessage: `unsupported media=${info.media}`,
        });
        await checkpointWrite(() => saveCheckpoint(options.checkpointFile, checkpoint));
        await appendRunEvent(options.runLogFile, {
          photoId: listPhoto.id,
          status: 'unsupported',
          media: info.media,
        });
        return;
      }

      if (!source?.url) {
        throw new Error('No downloadable media source found.');
      }

      const contextAlbumTitles = normalizeAlbumTitles(contexts);
      const selectedAlbumTitles = selectedAlbumsByPhotoId.get(listPhoto.id) || [];
      const mergedAlbumTitles = Array.from(new Set([...selectedAlbumTitles, ...contextAlbumTitles]));
      const selectedAlbumTitle = selectedAlbumTitles[0];
      const photariumMetadata = buildPhotariumMetadata({
        selector: options.selector,
        namespace: options.namespace,
        selectedAlbumTitle,
        listPhoto,
        info,
        albumTitles: mergedAlbumTitles,
        sourceUrl: source.url,
      });

      if (options.dryRun) {
        counts.skipped += 1;
        logger.info(`${prefix()} dry-run folder=${photariumMetadata.folder || '[none]'} tags=${photariumMetadata.tags.join(',')}`);
        await appendRunEvent(options.runLogFile, {
          photoId: listPhoto.id,
          status: 'dry-run',
          folder: photariumMetadata.folder,
          tags: photariumMetadata.tags,
          sourceUrl: source.url,
        });
        return;
      }

      const download = await downloadBuffer(source.url, options, logger, downloadGate);
      const fileName = inferDownloadFileName(listPhoto, source.url, download.contentType);
      const downloadedContentHash = contentHash(download.buffer);
      const extrasPatch = buildFlickrExtras({
        authProfile,
        listPhoto,
        info,
        albumTitles: mergedAlbumTitles,
        source,
        originalUrl: source.url,
        downloadedContentHash,
      });

      const outcome = await retryWithBackoff(
        async () => {
          const upload = info.media === 'video' ? uploadVideoToPhotarium : uploadImageToPhotarium;
          const result = await upload({
            apiBase: options.apiBase,
            buffer: download.buffer,
            fileName,
            contentType: download.contentType,
            metadata: {
              ...photariumMetadata,
              originalUrl: source.url,
            },
          });

          if (!result.ok && (result.status === 429 || result.status >= 500)) {
            const error = new Error(result.payload?.error || result.payload?.message || `Upload failed (${result.status})`);
            error.status = result.status;
            throw error;
          }

          return result;
        },
        {
          retries: options.retryMax,
          baseDelayMs: options.retryBaseMs,
          shouldRetry(error) {
            return Boolean(error?.status && (error.status === 429 || error.status >= 500));
          },
          onRetry(error, attempt, waitMs) {
            logger.warn(`${prefix()} retrying upload attempt ${attempt} in ${waitMs}ms (${error.message})`);
          },
        }
      );

      if (outcome.ok) {
        const photariumId = outcome.payload?.id || outcome.payload?.result?.id;
        if (info.media === 'photo') {
          await patchPhotariumExtras({
            apiBase: options.apiBase,
            imageId: photariumId,
            patch: extrasPatch,
          });
        }

        counts.uploaded += 1;
        if (!wasComplete) completionProgress.completed += 1;
        logger.success(`${prefix()} uploaded ${info.media} -> ${photariumId}`);
        checkpoint.entries[listPhoto.id] = buildEntryUpdate({
          existingEntry,
          status: 'uploaded',
          listPhoto,
          photariumId,
          sourceUrl: source.url,
          folder: photariumMetadata.folder,
          tags: photariumMetadata.tags,
          displayName: photariumMetadata.displayName,
        });
        await checkpointWrite(() => saveCheckpoint(options.checkpointFile, checkpoint));
        await appendRunEvent(options.runLogFile, {
          photoId: listPhoto.id,
          status: 'uploaded',
          photariumId,
          folder: photariumMetadata.folder,
          sourceUrl: source.url,
        });
        return;
      }

      throw new Error(outcome.payload?.error || outcome.payload?.message || `Upload failed (${outcome.status})`);
    } catch (error) {
      counts.failed += 1;
      const baseMessage = error instanceof Error ? error.message : String(error);
      const message = error?.downloadDiagnostics
        ? `${baseMessage}; ${error.downloadDiagnostics}`
        : baseMessage;
      logger.error(`${prefix()} ${message}`);
      checkpoint.entries[listPhoto.id] = buildEntryUpdate({
        existingEntry,
        status: 'failed',
        listPhoto,
        errorMessage: message,
      });
      await checkpointWrite(() => saveCheckpoint(options.checkpointFile, checkpoint));
      await appendRunEvent(options.runLogFile, {
        photoId: listPhoto.id,
        status: 'failed',
        error: message,
      });
    }
  }, {
    shouldStart: () => runtimeDeadline === null || Date.now() < runtimeDeadline,
  });

  const trancheElapsedMs = Date.now() - trancheStartedAt;
  const successful = counts.uploaded + counts.duplicate;
  const remaining = Math.max(completionProgress.total - completionProgress.completed, 0);
  const estimatedRemainingMs = estimateRemainingTime({
    elapsedMs: trancheElapsedMs,
    successful,
    remaining,
  });
  logger.banner('Run complete');
  if (runtimeDeadline !== null && startedCount < selected.length) {
    logger.info(`runtime deadline reached; started=${startedCount} deferred=${selected.length - startedCount}`);
  }
  logger.info(`uploaded=${counts.uploaded} duplicate=${counts.duplicate} skipped=${counts.skipped} unsupported=${counts.unsupported} failed=${counts.failed}`);
  logger.info(
    `tranche elapsed=${formatElapsedTime(trancheElapsedMs)} successful=${successful}/${startedCount}`
    + ` estimated-account-remaining=${estimatedRemainingMs === null ? 'unavailable' : formatElapsedTime(estimatedRemainingMs)}`
  );
}
