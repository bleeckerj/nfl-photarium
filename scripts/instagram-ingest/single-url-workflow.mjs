import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DATA_DIR } from "./cli.mjs";
import {
  buildInstagramUploadTags, extractProfileUsernameFromInstagramUrl,
  parseInstagramMediaUrl, pushImageToCloudflare, pushVideoToCloudflare, reduceVideoUrlsForUpload,
} from "./cloudflare-upload.mjs";
import { buildInstagramSourceRecord } from "./records.mjs";
import {
  extractSingleUrlRecord, fetchSingleUrlRecordFromApiByShortcode,
  fetchSingleUrlRecordFromUserFeedByShortcode,
} from "./single-url-extract.mjs";
import { ensureParentDir, launchBrowser, sleep } from "./workflows.mjs";
import {
  assertSingleUrlMediaComplete, assertSingleUrlUploadsComplete,
  mergeSingleUrlMediaRecord, needsInstagramMediaLookup,
} from "./single-url-record.mjs";

export async function runSingleUrl(opts, log) {
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
      needsInstagramMediaLookup(record)
    ) {
      const apiFallback = await fetchSingleUrlRecordFromApiByShortcode(
        page,
        record.shortcode,
        sourceUsername || opts.username,
        record.userId || null,
        log,
        parsedInputUrl?.imgIndex ?? null,
      );
      if (apiFallback) {
        mergeSingleUrlMediaRecord(record, apiFallback, "api_fallback");
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
      needsInstagramMediaLookup(record)
    ) {
      const feedFallback = await fetchSingleUrlRecordFromUserFeedByShortcode(
        page,
        feedLookupUsername,
        record.shortcode,
        log,
        parsedInputUrl?.imgIndex ?? null,
      );
      if (feedFallback) {
        mergeSingleUrlMediaRecord(record, feedFallback, "feed_fallback");
        log.info(
          `single_url_feed_fallback_merged shortcode=${record.shortcode} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
        );
        sourceUsername = resolveSourceUsername();
        record.profileUsername = sourceUsername || null;
        record.uploadTags = buildInstagramUploadTags(sourceUsername, "");
      }
    }

    assertSingleUrlMediaComplete(record);

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
    let cloudflareVideoAlreadyExists = 0;
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
        for (const [slideIndex, imageUrl] of record.imageUrls.entries()) {
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
            log.success(`single_url_image_verified slide=${slideIndex + 1}/${record.imageUrls.length} id=${pushed.id ?? "missing"} already_exists=${pushed.alreadyExists === true}`);
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
              deduplicateBySourceUrl: Boolean(record.permalink || parsedInputUrl?.shortcode),
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

      const report = cloudflareImagePushFail + cloudflareVideoPushFail > 0 ? log.warn : log.success;
      report(
        `single_url_cloudflare images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_exists=${cloudflareVideoAlreadyExists} videos_failed=${cloudflareVideoPushFail}`,
      );
    }

    await ensureParentDir(opts.outputPath);
    await fsp.appendFile(opts.outputPath, `${JSON.stringify(record)}\n`, "utf8");
    log.success(`single_url_record_written output=${opts.outputPath}`);
    assertSingleUrlUploadsComplete(record, opts);
    log.success(`single_url_complete output=${opts.outputPath}`);
  } finally {
    await browser.close();
  }
}
