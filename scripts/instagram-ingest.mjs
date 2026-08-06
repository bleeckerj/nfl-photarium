#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  C,
  createLogger,
  DEFAULT_DATA_DIR,
  parseArgs,
  printUsage,
} from "./instagram-ingest/cli.mjs";
import {
  appendSourceLabel,
  buildInstagramUploadTags,
  extensionFromUrl,
  extractProfileUsernameFromInstagramUrl,
  ingestImageToCloudflare,
  parseInstagramMediaUrl,
  pushImageToCloudflare,
  pushVideoToCloudflare,
  reduceVideoUrlsForUpload,
} from "./instagram-ingest/cloudflare-upload.mjs";
import {
  buildInstagramSourceRecord,
  isStopAtShortcodeMatch,
  mapItemToRecord,
} from "./instagram-ingest/records.mjs";
import {
  extractSingleUrlRecord,
  fetchSingleUrlRecordFromApiByShortcode,
  fetchSingleUrlRecordFromUserFeedByShortcode,
  igGet,
  selectInstagramImageUrls,
} from "./instagram-ingest/single-url-extract.mjs";
import {
  downloadFile, ensureDir, ensureParentDir, launchBrowser, logIngestStart, openInstagramProfile,
  readJsonIfExists, runAuth, runVideosFromNdjson, sleep, validateInstagramProfile,
} from "./instagram-ingest/workflows.mjs";

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
  let cloudflareVideoPushOk = 0;
  let cloudflareVideoPushFail = 0;
  let stopAtShortcodeFound = false;
  await ensureParentDir(opts.outputPath);
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

      if (opts.pushCloudflare && record.mediaType === 2 && record.imageUrls.length > 0) {
        log.trace(
          `cloudflare_image_skip_video_post shortcode=${record.shortcode ?? "n/a"} media_type=${record.mediaType} images=${record.imageUrls.length}`,
        );
      } else if (opts.pushCloudflare && record.imageUrls.length > 0) {
        const sourcePageUrl = record.permalink || `https://www.instagram.com/${opts.username}/`;
        for (const imageUrl of record.imageUrls) {
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

      if (opts.pushCloudflare && opts.skipVideoPush && record.videoUrls.length > 0) {
        log.trace(
          `cloudflare_video_skip shortcode=${record.shortcode ?? "n/a"} reason=skip_video_push urls=${record.videoUrls.length}`,
        );
      } else if (opts.pushCloudflare && record.videoUrls.length > 0) {
        const sourcePageUrl = record.permalink || `https://www.instagram.com/${opts.username}/`;
        for (const videoUrl of record.videoUrls) {
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
              log,
            });
            cloudflareVideoPushOk += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: true,
              id: pushed.id,
              streamUid: pushed.streamUid,
              playbackUrl: pushed.playbackUrl,
              hlsUrl: pushed.hlsUrl,
              thumbnailUrl: pushed.thumbnailUrl,
              previewUrl: pushed.previewUrl,
            });
            log.trace(
              `cloudflare_video_push_ok shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} id=${pushed.id ?? "n/a"} stream_uid=${pushed.streamUid ?? "n/a"}`,
            );
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
  log.success(`records_written=${recordCount} pages_fetched=${pageCount}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`checkpoint=${opts.checkpointPath}`);
  if (opts.downloadDir) {
    log.info(`download_dir=${opts.downloadDir} downloaded=${downloadedCount} download_failures=${downloadFailCount}`);
  }
  if (opts.pushCloudflare) {
    log.info(
      `cloudflare_push images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_failed=${cloudflareVideoPushFail}`,
    );
  }
}

async function runSingleUrl(opts, log) {
  if (!opts.instagramUrl) {
    throw new Error("single-url requires --url <instagram_post_or_reel_url>");
  }

  const parsedInputUrl = parseInstagramMediaUrl(opts.instagramUrl);
  const normalizedInstagramUrl = parsedInputUrl?.canonicalUrl || opts.instagramUrl;

  log.headline("Instagram Single URL Ingest");
  log.info(`url=${opts.instagramUrl}`);
  if (normalizedInstagramUrl !== opts.instagramUrl) {
    log.info(`normalized_url=${normalizedInstagramUrl}`);
  }
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`push_cloudflare=${opts.pushCloudflare}`);

  const inputProfileUsername = parsedInputUrl?.profileUsername || extractProfileUsernameFromInstagramUrl(opts.instagramUrl) || "";

  if (opts.pushCloudflare) {
    if (opts.namespace === "__all__" || opts.namespace === "__none__") {
      throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
    }
    log.info(`api_base=${opts.apiBase}`);
    log.info(`push_namespace=${opts.namespace}`);
    log.info("push_tags=(resolved after post owner extraction) push_folder=instagram");
  }

  const browser = await launchBrowser(opts.profileDir, opts.headful ? false : true);
  try {
    const page = await browser.newPage();

    const record = await extractSingleUrlRecord(page, normalizedInstagramUrl, opts.username, log);
    record.cloudflare = [];
    const resolveSourceUsername = () => {
      const resolvedOwnerUsername =
        record.username_source && record.username_source !== "fallback_arg" && record.username_source !== "unresolved"
          ? record.username
          : "";
      return resolvedOwnerUsername || inputProfileUsername || "";
    };
    let sourceUsername = resolveSourceUsername();
    record.profileUsername = sourceUsername || null;
    record.uploadTags = buildInstagramUploadTags(sourceUsername, "");

    if (
      record.shortcode &&
      (record.videoUrls.length === 0 || record.likeCount == null || record.commentCount == null)
    ) {
      const apiFallback = await fetchSingleUrlRecordFromApiByShortcode(
        page,
        record.shortcode,
        sourceUsername || opts.username,
        record.userId || null,
        log,
      );
      if (apiFallback) {
        record.mediaType = record.mediaType ?? apiFallback.mediaType ?? null;
        record.productType = record.productType ?? apiFallback.productType ?? null;
        record.userId = record.userId || apiFallback.userId || null;
        record.mediaId = record.mediaId || apiFallback.mediaId || null;
        record.pk = record.pk || apiFallback.pk || null;
        record.likeCount = record.likeCount ?? apiFallback.likeCount ?? null;
        record.commentCount = record.commentCount ?? apiFallback.commentCount ?? null;
        record.viewCount = record.viewCount ?? apiFallback.viewCount ?? null;
        if (!record.caption && apiFallback.caption) record.caption = apiFallback.caption;
        if (!record.takenAtUnix && apiFallback.takenAtUnix) {
          record.takenAtUnix = apiFallback.takenAtUnix;
          record.takenAtIso = apiFallback.takenAtIso;
        }
        if ((!record.username || record.username === opts.username) && apiFallback.username) {
          record.username = apiFallback.username;
          record.username_source = "api_fallback";
        }
        const mergedImages = [...record.imageUrls, ...apiFallback.imageUrls];
        const mergedVideos = [...record.videoUrls, ...apiFallback.videoUrls];
        const hadVideoBefore = record.videoUrls.length > 0;
        record.imageUrls = selectInstagramImageUrls(mergedImages, {
          mediaType: record.mediaType,
          productType: record.productType,
        });
        record.videoUrls = [...new Set(mergedVideos.filter(Boolean))];
        if (record.videoUrls.length > 0 && apiFallback.videoUrls.length > 0) {
          record.video_source = appendSourceLabel(
            hadVideoBefore ? record.video_source : "",
            "api_fallback",
          );
        }
        log.info(
          `single_url_api_fallback_merged shortcode=${record.shortcode} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
        );
        sourceUsername = resolveSourceUsername();
        record.profileUsername = sourceUsername || null;
        record.uploadTags = buildInstagramUploadTags(sourceUsername, "");
      }
    }

    const feedLookupUsername = sourceUsername || "";
    if (
      record.shortcode &&
      feedLookupUsername &&
      (record.videoUrls.length === 0 || record.likeCount == null || record.commentCount == null)
    ) {
      const feedFallback = await fetchSingleUrlRecordFromUserFeedByShortcode(
        page,
        feedLookupUsername,
        record.shortcode,
        log,
      );
      if (feedFallback) {
        record.mediaType = record.mediaType ?? feedFallback.mediaType ?? null;
        record.productType = record.productType ?? feedFallback.productType ?? null;
        record.userId = record.userId || feedFallback.userId || null;
        record.mediaId = record.mediaId || feedFallback.mediaId || null;
        record.pk = record.pk || feedFallback.pk || null;
        record.likeCount = record.likeCount ?? feedFallback.likeCount ?? null;
        record.commentCount = record.commentCount ?? feedFallback.commentCount ?? null;
        record.viewCount = record.viewCount ?? feedFallback.viewCount ?? null;
        if (!record.caption && feedFallback.caption) record.caption = feedFallback.caption;
        if (!record.takenAtUnix && feedFallback.takenAtUnix) {
          record.takenAtUnix = feedFallback.takenAtUnix;
          record.takenAtIso = feedFallback.takenAtIso;
        }
        if ((!record.username || record.username === opts.username) && feedFallback.username) {
          record.username = feedFallback.username;
          record.username_source = "feed_fallback";
        }
        const mergedImages = [...record.imageUrls, ...feedFallback.imageUrls];
        const mergedVideos = [...record.videoUrls, ...feedFallback.videoUrls];
        const hadVideoBefore = record.videoUrls.length > 0;
        record.imageUrls = selectInstagramImageUrls(mergedImages, {
          mediaType: record.mediaType,
          productType: record.productType,
        });
        record.videoUrls = [...new Set(mergedVideos.filter(Boolean))];
        if (record.videoUrls.length > 0 && feedFallback.videoUrls.length > 0) {
          record.video_source = appendSourceLabel(
            hadVideoBefore ? record.video_source : "",
            "feed_fallback",
          );
        }
        log.info(
          `single_url_feed_fallback_merged shortcode=${record.shortcode} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
        );
        sourceUsername = resolveSourceUsername();
        record.profileUsername = sourceUsername || null;
        record.uploadTags = buildInstagramUploadTags(sourceUsername, "");
      }
    }

    const beforeReduceVideoCount = record.videoUrls.length;
    record.videoUrls = reduceVideoUrlsForUpload(record.videoUrls);
    if (beforeReduceVideoCount !== record.videoUrls.length) {
      log.info(
        `single_url_video_urls_reduced shortcode=${record.shortcode ?? "n/a"} before=${beforeReduceVideoCount} after=${record.videoUrls.length}`,
      );
    }
    if (record.videoUrls.length > 1) {
      log.info(
        `single_url_video_urls_truncated shortcode=${record.shortcode ?? "n/a"} keeping=1 dropped=${record.videoUrls.length - 1}`,
      );
      record.videoUrls = [record.videoUrls[0]];
    }
    if (record.videoUrls.length === 0) {
      record.video_source = record.likelyVideo ? "missing_likely_video" : "none";
    }

    if (!opts.outputPathProvided) {
      const routedUsername =
        sourceUsername ||
        (record.shortcode ? `single-url-${record.shortcode}` : "single-url-unresolved");
      opts.outputPath = path.join(DEFAULT_DATA_DIR, `${routedUsername}.ndjson`);
      log.info(`single_url_output_auto_routed username=${routedUsername} output=${opts.outputPath}`);
    }

    log.success(
      `single_url_record_ready shortcode=${record.shortcode ?? "n/a"} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
    );
    log.info(
      `single_url_sources username_source=${record.username_source ?? "unknown"} video_source=${record.video_source ?? "unknown"}`,
    );

    let cloudflareImagePushOk = 0;
    let cloudflareImageAlreadyExists = 0;
    let cloudflareImagePushFail = 0;
    let cloudflareVideoPushOk = 0;
    let cloudflareVideoPushFail = 0;

    if (opts.pushCloudflare) {
      const sourcePageUrl = record.permalink || opts.instagramUrl;
      const uploadTags = buildInstagramUploadTags(sourceUsername, "");
      record.uploadTags = uploadTags;

      const shouldTreatAsVideoPost =
        record.mediaType === 2 ||
        record.productType === "clips" ||
        record.likelyVideo === true ||
        parsedInputUrl?.kind === "reel" ||
        parsedInputUrl?.kind === "reels" ||
        parsedInputUrl?.kind === "tv";

      if (shouldTreatAsVideoPost && record.imageUrls.length > 0) {
        log.trace(
          `cloudflare_image_skip_video_post shortcode=${record.shortcode ?? "n/a"} media_type=${record.mediaType} likely_video=${record.likelyVideo === true} product_type=${record.productType ?? "n/a"} images=${record.imageUrls.length}`,
        );
      } else {
        for (const imageUrl of record.imageUrls) {
          try {
            const pushed = await pushImageToCloudflare({
              apiBase: opts.apiBase,
              imageUrl,
              username: sourceUsername || "instagram",
              uploadTags,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              description: record.caption,
              instagramSource: buildInstagramSourceRecord(record),
              namespace: opts.namespace,
              log,
            });
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: true,
              tags: uploadTags,
              alreadyExists: pushed.alreadyExists === true,
              id: pushed.id ?? null,
              url: pushed.url ?? null,
              variants: pushed.variants ?? [],
              duplicateIds: pushed.duplicateIds ?? [],
            });
            if (pushed.alreadyExists) cloudflareImageAlreadyExists += 1;
            else cloudflareImagePushOk += 1;
          } catch (err) {
            cloudflareImagePushFail += 1;
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: false,
              tags: uploadTags,
              error: err.message,
            });
            log.warn(
              `cloudflare_push_failed shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
        }
      }

      if (opts.skipVideoPush && record.videoUrls.length > 0) {
        log.trace(
          `cloudflare_video_skip shortcode=${record.shortcode ?? "n/a"} reason=skip_video_push urls=${record.videoUrls.length}`,
        );
      } else {
        for (const videoUrl of record.videoUrls) {
          try {
            const pushed = await pushVideoToCloudflare({
              apiBase: opts.apiBase,
              videoUrl,
              username: sourceUsername || "instagram",
              uploadTags,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              description: record.caption,
              namespace: opts.namespace,
              log,
            });
            cloudflareVideoPushOk += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: true,
              tags: uploadTags,
              id: pushed.id,
              streamUid: pushed.streamUid,
              playbackUrl: pushed.playbackUrl,
              hlsUrl: pushed.hlsUrl,
              thumbnailUrl: pushed.thumbnailUrl,
              previewUrl: pushed.previewUrl,
            });
          } catch (err) {
            cloudflareVideoPushFail += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: false,
              tags: uploadTags,
              error: err.message,
            });
            log.warn(
              `cloudflare_video_push_failed shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
        }
      }

      if (shouldTreatAsVideoPost && record.videoUrls.length === 0) {
        log.warn(
          `cloudflare_video_missing shortcode=${record.shortcode ?? "n/a"} likely_video=true media_type=${record.mediaType ?? "n/a"} product_type=${record.productType ?? "n/a"} no videoUrls recovered; skipped thumbnail image upload`,
        );
      }

      log.success(
        `single_url_cloudflare images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_failed=${cloudflareVideoPushFail}`,
      );
    }

    await ensureParentDir(opts.outputPath);
    await fsp.appendFile(opts.outputPath, `${JSON.stringify(record)}\n`, "utf8");
    log.success(`single_url_record_written output=${opts.outputPath}`);
    log.success(`single_url_complete output=${opts.outputPath}`);
  } finally {
    await browser.close();
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
