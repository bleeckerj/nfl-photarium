function bestImageCandidate(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aArea = (a.width ?? 0) * (a.height ?? 0);
    const bArea = (b.width ?? 0) * (b.height ?? 0);
    return bArea - aArea;
  })[0];
}

export function extractMediaUrls(item) {
  const imageUrls = [];
  const videoUrls = [];

  const pushFromNode = (node) => {
    const candidate = bestImageCandidate(node?.image_versions2?.candidates ?? []);
    if (candidate?.url) imageUrls.push(candidate.url);
    if (Array.isArray(node?.video_versions) && node.video_versions.length > 0) {
      const bestVideo = [...node.video_versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (bestVideo?.url) videoUrls.push(bestVideo.url);
    }
  };

  pushFromNode(item);
  if (Array.isArray(item?.carousel_media)) {
    for (const child of item.carousel_media) pushFromNode(child);
  }

  return {
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
  };
}

export function mapItemToRecord(item, username, userId) {
  const { imageUrls, videoUrls } = extractMediaUrls(item);
  const shortcode = item.code ?? null;
  const takenAtUnix = item.taken_at ?? null;

  return {
    source: "instagram",
    fetchedAt: new Date().toISOString(),
    username,
    userId,
    mediaId: item.id ?? null,
    pk: item.pk ?? null,
    shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
    mediaType: item.media_type ?? null,
    productType: item.product_type ?? null,
    takenAtUnix,
    takenAtIso: takenAtUnix ? new Date(takenAtUnix * 1000).toISOString() : null,
    likeCount: item.like_count ?? null,
    commentCount: item.comment_count ?? null,
    caption: item?.caption?.text ?? "",
    imageUrls,
    videoUrls,
  };
}
