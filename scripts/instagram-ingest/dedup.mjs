import fsp from "node:fs/promises";

const successfulAssetCount = (record, assetType) =>
  Array.isArray(record?.cloudflare)
    ? record.cloudflare.filter((asset) => asset?.assetType === assetType && asset?.ok === true).length
    : 0;

export function getInstagramRecordKey(record) {
  const shortcode = typeof record?.shortcode === "string" ? record.shortcode.trim() : "";
  if (shortcode) return `shortcode:${shortcode}`;

  const mediaId = typeof record?.mediaId === "string" ? record.mediaId.trim() : "";
  return mediaId ? `media:${mediaId}` : "";
}

export async function readInstagramNdjsonRecords(filePath) {
  try {
    const content = await fsp.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const record = JSON.parse(line);
          return record && typeof record === "object" ? [record] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function buildInstagramAssetIndex(records) {
  const index = new Map();
  for (const record of records) {
    const key = getInstagramRecordKey(record);
    if (!key) continue;

    const current = index.get(key) ?? { records: 0, images: 0, videos: 0 };
    current.records += 1;
    current.images += successfulAssetCount(record, "image");
    current.videos += successfulAssetCount(record, "video");
    index.set(key, current);
  }
  return index;
}

export function getInstagramAssetPlan(record, existingAssets) {
  const existingImages = Math.max(0, existingAssets?.images ?? 0);
  const existingVideos = Math.max(0, existingAssets?.videos ?? 0);
  const imageCount = Array.isArray(record?.imageUrls) ? record.imageUrls.length : 0;
  const videoCount = Array.isArray(record?.videoUrls) ? record.videoUrls.length : 0;
  const imageStart = Math.min(existingImages, imageCount);
  const videoStart = Math.min(existingVideos, videoCount);

  return {
    imageStart,
    videoStart,
    skipRecord: imageStart === imageCount && videoStart === videoCount,
  };
}

export function mergeInstagramAssetIndex(index, record) {
  const key = getInstagramRecordKey(record);
  if (!key) return;

  const current = index.get(key) ?? { records: 0, images: 0, videos: 0 };
  current.records += 1;
  current.images += successfulAssetCount(record, "image");
  current.videos += successfulAssetCount(record, "video");
  index.set(key, current);
}
