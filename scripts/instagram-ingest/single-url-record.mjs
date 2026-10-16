import { appendSourceLabel } from "./cloudflare-upload.mjs";

export function needsInstagramMediaLookup(record) {
  if (record.mediaType === 8 || record.productType === "carousel_container") {
    return !record.carouselMediaCount || record.extractedMediaCount !== record.carouselMediaCount;
  }
  if (record.mediaType === 1) return record.imageUrls.length !== 1;
  if (record.mediaType === 2) return record.videoUrls.length === 0;
  return true;
}

export function mergeSingleUrlMediaRecord(record, recovered, source) {
  for (const field of ["mediaType", "productType", "userId", "mediaId", "pk", "likeCount", "commentCount", "viewCount"]) {
    record[field] = record[field] ?? recovered[field] ?? null;
  }
  if (!record.caption && recovered.caption) record.caption = recovered.caption;
  if (!record.takenAtUnix && recovered.takenAtUnix) {
    record.takenAtUnix = recovered.takenAtUnix;
    record.takenAtIso = recovered.takenAtIso;
  }
  if (recovered.username) {
    record.username = recovered.username;
    record.username_source = source;
  }
  // Structured post data is authoritative; mixing it with page-wide URLs duplicates covers.
  if (recovered.mediaType != null) {
    record.mediaType = recovered.mediaType;
    record.imageUrls = recovered.imageUrls;
    record.videoUrls = recovered.videoUrls;
    record.likelyVideo = recovered.mediaType === 2;
    record.carouselMediaCount = recovered.carouselMediaCount;
    record.extractedMediaCount = recovered.extractedMediaCount;
  }
  if (recovered.videoUrls.length > 0) record.video_source = appendSourceLabel(record.video_source, source);
}

export function assertSingleUrlMediaComplete(record) {
  if (needsInstagramMediaLookup(record)) {
    throw new Error(`Incomplete Instagram media extraction for ${record.shortcode}: expected_slides=${record.carouselMediaCount ?? "unknown"} extracted_slides=${record.extractedMediaCount ?? "unknown"}.`);
  }
}

export function assertSingleUrlUploadsComplete(record, options) {
  if (!options.pushCloudflare) return;
  const failures = record.cloudflare.filter((asset) => !asset.ok);
  const expectedImages = record.mediaType === 2 || record.likelyVideo ? 0 : record.imageUrls.length;
  const expectedVideos = options.skipVideoPush ? 0 : record.videoUrls.length;
  const persisted = record.cloudflare.filter((asset) => asset.ok && asset.id).length;
  if (failures.length > 0 || persisted !== expectedImages + expectedVideos) {
    throw new Error(`Instagram ingestion incomplete for ${record.shortcode}: persisted=${persisted} expected=${expectedImages + expectedVideos} failed=${failures.length}. Record saved at ${options.outputPath}.`);
  }
}
