#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  C,
  createLogger,
  parseArgs,
  printUsage,
} from "./instagram-ingest/cli.mjs";
import {
  buildInstagramUploadTags,
  extensionFromUrl,
  ingestImageToCloudflare,
  pushVideoToCloudflare,
} from "./instagram-ingest/cloudflare-upload.mjs";
import {
  isStopAtShortcodeMatch,
  mapItemToRecord,
} from "./instagram-ingest/records.mjs";
import {
  buildInstagramAssetIndex,
  getInstagramAssetPlan,
  getInstagramRecordKey,
  mergeInstagramAssetIndex,
  readInstagramNdjsonRecords,
} from "./instagram-ingest/dedup.mjs";
import {
  igGet,
} from "./instagram-ingest/single-url-extract.mjs";
import {
  downloadFile, ensureDir, ensureParentDir, logIngestStart, openInstagramProfile,
  readJsonIfExists, runAuth, runVideosFromNdjson, sleep, validateInstagramProfile,
} from "./instagram-ingest/workflows.mjs";

import { runSingleUrl } from "./instagram-ingest/single-url-workflow.mjs";

export { parseArgs } from "./instagram-ingest/cli.mjs";
export {
  ingestImageToCloudflare,
  pushImageToCloudflare,
  suggestDisplayNameFromBuffer,
} from "./instagram-ingest/cloudflare-upload.mjs";
export { isStopAtShortcodeMatch } from "./instagram-ingest/records.mjs";

async function runIngest(opts, log) {
  logIngestStart(opts, log);
  const { browser, page, profileResp } = await openInstagramProfile(opts, log);
  const user = await validateInstagramProfile(profileResp, browser);
  const userId = user.id;
  const totalCount = user?.edge_owner_to_timeline_media?.count ?? null;
  log.success(`profile_ok user_id=${userId} profile_media_count=${totalCount ?? "unknown"}`);

  const checkpoint = opts.resume ? await readJsonIfExists(opts.checkpointPath) : null;
  let maxId = checkpoint?.nextMaxId ?? "";
  if (checkpoint) {
    log.info(
      `resume_checkpoint found pages_fetched=${checkpoint.pagesFetched ?? 0} records_written=${checkpoint.recordsWritten ?? 0} next_max_id=${checkpoint.nextMaxId ?? "null"}`,
    );
  } else if (opts.resume) {
    log.info("resume_checkpoint not found; starting at newest.");
  } else {
    log.info("resume disabled; starting at newest.");
  }
  let pageCount = 0;
  let recordCount = 0;
  let downloadedCount = 0;
  let downloadFailCount = 0;
  let cloudflareImagePushOk = 0;
  let cloudflareImageAlreadyExists = 0;
  let cloudflareImagePushFail = 0;
  let cloudflareImageSkippedExisting = 0;
  let cloudflareVideoPushOk = 0;
  let cloudflareVideoAlreadyExists = 0;
  let cloudflareVideoPushFail = 0;
  let cloudflareVideoSkippedExisting = 0;
  let recordsSkippedExisting = 0;
  let stopAtShortcodeFound = false;
  await ensureParentDir(opts.outputPath);
  const existingAssetIndex = buildInstagramAssetIndex(await readInstagramNdjsonRecords(opts.outputPath));
  const out = fs.createWriteStream(opts.outputPath, { flags: "a" });
  if (opts.downloadDir) await ensureDir(opts.downloadDir);
  while (true) {
    const apiPath =
      `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${encodeURIComponent(opts.count)}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    log.debug(`fetch_page index=${pageCount + 1} max_id=${maxId || "null"} api_path=${apiPath}`);
    const resp = await igGet(page, apiPath);
    if (resp.status === 401 || resp.json?.require_login) {
      log.error(`auth_required status=${resp.status}`);
      throw new Error("Session expired or blocked (require_login). Re-run auth and resume.");
    }
    if (resp.status !== 200 || !resp.json) {
      log.error(`feed_error status=${resp.status}`);
      throw new Error(`Feed request failed (status ${resp.status}).`);
    }
    const items = Array.isArray(resp.json.items) ? resp.json.items : [];
    log.info(`page_result index=${pageCount + 1} status=${resp.status} items=${items.length}`);
    if (items.length === 0) {
      log.info("No more items on this page; stopping.");
      break;
    }
    for (const item of items) {
      const record = mapItemToRecord(item, opts.username, userId);
      if (isStopAtShortcodeMatch(record, opts.stopAtShortcode)) {
        stopAtShortcodeFound = true;
        log.info(
          `stop_at_shortcode_found shortcode=${record.shortcode} records_written=${recordCount} checkpoint_unchanged=true`,
        );
        break;
      }
      const recordKey = getInstagramRecordKey(record);
      const assetPlan = getInstagramAssetPlan(record, existingAssetIndex.get(recordKey));
      const skipVideoPostImages = opts.skipVideoPostImages && record.mediaType === 2;
      const imageStart = skipVideoPostImages ? record.imageUrls.length : assetPlan.imageStart;
      const videoStart = assetPlan.videoStart;
      if (
        (recordKey && opts.pushCloudflare && assetPlan.skipRecord) ||
        (recordKey && !opts.pushCloudflare && existingAssetIndex.has(recordKey))
      ) {
        recordsSkippedExisting += 1;
        log.info(`record_skip_existing shortcode=${record.shortcode ?? "n/a"} media_id=${record.mediaId ?? "n/a"}`);
        continue;
      }
      record.cloudflare = [];
      const captionPreview = (record.caption || "").replace(/\s+/g, " ").slice(0, 80);
      log.trace(
        `item media_id=${record.mediaId} shortcode=${record.shortcode ?? "n/a"} type=${record.mediaType} images=${record.imageUrls.length} videos=${record.videoUrls.length} caption="${captionPreview}"`,
      );

      if (opts.downloadDir) {
        for (let idx = 0; idx < record.imageUrls.length; idx += 1) {
          const imageUrl = record.imageUrls[idx];
          const ext = extensionFromUrl(imageUrl);
          const short = record.shortcode ?? record.mediaId ?? "unknown";
          const fileName = `${short}_${idx + 1}${ext}`;
          const destPath = path.join(opts.downloadDir, fileName);
          if (!fs.existsSync(destPath)) {
            try {
              log.trace(`download_start url=${imageUrl} dest=${destPath}`);
              await downloadFile(imageUrl, destPath);
              downloadedCount += 1;
              log.trace(`download_ok dest=${destPath}`);
            } catch (err) {
              downloadFailCount += 1;
              log.warn(`download_failed url=${imageUrl} err=${err.message}`);
            }
          } else {
            log.trace(`download_skip_exists dest=${destPath}`);
          }
        }
      }

      if (opts.pushCloudflare && imageStart > 0) {
        cloudflareImageSkippedExisting += imageStart;
        log.trace(
          `cloudflare_image_skip_existing shortcode=${record.shortcode ?? "n/a"} count=${imageStart}`,
        );
      }
      if (opts.pushCloudflare && skipVideoPostImages && record.imageUrls.length > 0) {
        log.trace(
          `cloudflare_image_skip_video_post shortcode=${record.shortcode ?? "n/a"} media_type=${record.mediaType} images=${record.imageUrls.length}`,
        );
      } else if (opts.pushCloudflare && imageStart < record.imageUrls.length) {
        const sourcePageUrl = record.permalink || `https://www.instagram.com/${opts.username}/`;
        for (const imageUrl of record.imageUrls.slice(imageStart)) {
          try {
            const pushed = await ingestImageToCloudflare({
              apiBase: opts.apiBase,
              imageUrl,
              username: opts.username,
              uploadTags: buildInstagramUploadTags(opts.username, ""),
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              description: record.caption,
              instagramSource: buildInstagramSourceRecord(record),
              namespace: opts.namespace,
              log,
              aiDisplayName: opts.aiDisplayName,
            });
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: true,
              alreadyExists: pushed.alreadyExists === true,
              id: pushed.id ?? null,
              url: pushed.url ?? null,
              variants: pushed.variants ?? [],
              duplicateIds: pushed.duplicateIds ?? [],
            });
            if (pushed.alreadyExists) {
              cloudflareImageAlreadyExists += 1;
              log.trace(
                `cloudflare_push_exists shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} duplicate_ids=${(pushed.duplicateIds ?? []).join(",") || "n/a"}`,
              );
            } else {
              cloudflareImagePushOk += 1;
              log.trace(
                `cloudflare_push_ok shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} id=${pushed.id ?? "n/a"}`,
              );
            }
          } catch (err) {
            cloudflareImagePushFail += 1;
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: false,
              error: err.message,
            });
            log.warn(
              `cloudflare_push_failed shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) {
            log.trace(`request_sleep_ms=${opts.requestDelayMs} after=image_push`);
            await sleep(opts.requestDelayMs);
          }
        }
      }

      if (opts.pushCloudflare && videoStart > 0) {
        cloudflareVideoSkippedExisting += videoStart;
        log.trace(
          `cloudflare_video_skip_existing shortcode=${record.shortcode ?? "n/a"} count=${videoStart}`,
        );
      }
      if (opts.pushCloudflare && opts.skipVideoPush && videoStart < record.videoUrls.length) {
        log.trace(
          `cloudflare_video_skip shortcode=${record.shortcode ?? "n/a"} reason=skip_video_push urls=${record.videoUrls.length - videoStart}`,
        );
      } else if (opts.pushCloudflare && videoStart < record.videoUrls.length) {
        const sourcePageUrl = record.permalink || `https://www.instagram.com/${opts.username}/`;
        for (const videoUrl of record.videoUrls.slice(videoStart)) {
          try {
            const pushed = await pushVideoToCloudflare({
              apiBase: opts.apiBase,
              videoUrl,
              username: opts.username,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              description: record.caption,
              namespace: opts.namespace,
              deduplicateBySourceUrl: Boolean(record.permalink),
              log,
            });
            if (pushed.alreadyExists) {
              cloudflareVideoAlreadyExists += 1;
            } else {
              cloudflareVideoPushOk += 1;
            }
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: true,
              alreadyExists: pushed.alreadyExists === true,
              duplicateIds: pushed.duplicateIds ?? [],
              id: pushed.id,
              streamUid: pushed.streamUid,
              playbackUrl: pushed.playbackUrl,
              hlsUrl: pushed.hlsUrl,
              thumbnailUrl: pushed.thumbnailUrl,
              previewUrl: pushed.previewUrl,
            });
            log.trace(pushed.alreadyExists
              ? `cloudflare_video_push_exists shortcode=${record.shortcode ?? "n/a"} duplicate_ids=${(pushed.duplicateIds ?? []).join(",") || "n/a"}`
              : `cloudflare_video_push_ok shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} id=${pushed.id ?? "n/a"} stream_uid=${pushed.streamUid ?? "n/a"}`);
          } catch (err) {
            cloudflareVideoPushFail += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: false,
              error: err.message,
            });
            log.warn(
              `cloudflare_video_push_failed shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) {
            log.trace(`request_sleep_ms=${opts.requestDelayMs} after=video_push`);
            await sleep(opts.requestDelayMs);
          }
        }
      } else if (opts.pushCloudflare && record.mediaType === 2 && record.videoUrls.length === 0) {
        log.warn(
          `cloudflare_video_missing shortcode=${record.shortcode ?? "n/a"} media_type=2 has no videoUrls in payload`,
        );
      }

      out.write(`${JSON.stringify(record)}\n`);
      recordCount += 1;
      mergeInstagramAssetIndex(existingAssetIndex, record);
    }

    if (stopAtShortcodeFound) break;

    pageCount += 1;
    maxId = resp.json.next_max_id ?? "";

    await ensureParentDir(opts.checkpointPath);
    await fsp.writeFile(
      opts.checkpointPath,
      JSON.stringify(
        {
          username: opts.username,
          userId,
          totalProfileCount: totalCount,
          pagesFetched: pageCount,
          recordsWritten: recordCount,
          nextMaxId: maxId || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    log.debug(
      `checkpoint_saved pages_fetched=${pageCount} records_written=${recordCount} next_max_id=${maxId || "null"}`,
    );

    if (!maxId) {
      log.info("No next_max_id returned; reached end.");
      break;
    }
    if (opts.maxPages > 0 && pageCount >= opts.maxPages) {
      log.info(`Reached max_pages=${opts.maxPages}; stopping.`);
      break;
    }
    if (opts.delayMs > 0) {
      log.trace(`sleep delay_ms=${opts.delayMs}`);
      await sleep(opts.delayMs);
    }
  }

  out.end();
  await browser.close();

  if (opts.stopAtShortcode && !stopAtShortcodeFound) {
    log.warn(`stop_at_shortcode_not_found shortcode=${opts.stopAtShortcode}`);
  }

  log.success(`Ingest complete for @${opts.username}`);
  log.success(`records_written=${recordCount} records_skipped_existing=${recordsSkippedExisting} pages_fetched=${pageCount}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`checkpoint=${opts.checkpointPath}`);
  if (opts.downloadDir) {
    log.info(`download_dir=${opts.downloadDir} downloaded=${downloadedCount} download_failures=${downloadFailCount}`);
  }
  if (opts.pushCloudflare) {
    log.info(
      `cloudflare_push images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_skipped_existing=${cloudflareImageSkippedExisting} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_exists=${cloudflareVideoAlreadyExists} videos_skipped_existing=${cloudflareVideoSkippedExisting} videos_failed=${cloudflareVideoPushFail}`,
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = createLogger(opts);

  if (opts.command === "help" || opts.command === "--help" || opts.command === "-h") {
    printUsage();
    return;
  }

  if (!Number.isFinite(opts.count) || opts.count <= 0) throw new Error("--count must be a positive integer.");
  if (!Number.isFinite(opts.maxPages) || opts.maxPages < 0) throw new Error("--max-pages must be >= 0.");
  if (!Number.isFinite(opts.delayMs) || opts.delayMs < 0) throw new Error("--delay-ms must be >= 0.");
  if (!Number.isFinite(opts.requestDelayMs) || opts.requestDelayMs < 0) {
    throw new Error("--request-delay-ms must be >= 0.");
  }

  if (opts.command === "auth") {
    if (!opts.username || !opts.username.trim()) {
      throw new Error("auth requires --username <name>");
    }
    await runAuth(opts, log);
    return;
  }
  if (opts.command === "ingest") {
    if (!opts.username || !opts.username.trim()) {
      throw new Error("ingest requires --username <name>");
    }
    await runIngest(opts, log);
    return;
  }
  if (opts.command === "single-url") {
    await runSingleUrl(opts, log);
    return;
  }
  if (opts.command === "videos-from-ndjson") {
    if ((!opts.username || !opts.username.trim()) && !opts.inputPathProvided) {
      throw new Error("videos-from-ndjson requires --username <name> (or pass --input <path>)");
    }
    await runVideosFromNdjson(opts, log);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${C.red}${err.message}${C.reset}`);
    process.exitCode = 1;
  });
}
