function bestImageCandidate(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aArea = (a.width ?? a.config_width ?? 0) * (a.height ?? a.config_height ?? 0);
    const bArea = (b.width ?? b.config_width ?? 0) * (b.height ?? b.config_height ?? 0);
    return bArea - aArea;
  })[0];
}

function firstCount(...values) {
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return Math.trunc(count);
  }
  return null;
}

export function extractMediaUrls(item) {
  const imageUrls = [];
  const videoUrls = [];

  const pushFromNode = (node) => {
    const candidate = bestImageCandidate(node?.image_versions2?.candidates ?? node?.display_resources ?? []);
    if (candidate?.url) imageUrls.push(candidate.url);
    else if (candidate?.src) imageUrls.push(candidate.src);
    else if (node?.display_url) imageUrls.push(node.display_url);
    if (Array.isArray(node?.video_versions) && node.video_versions.length > 0) {
      const bestVideo = [...node.video_versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (bestVideo?.url) videoUrls.push(bestVideo.url);
    }
    else if (node?.video_url) videoUrls.push(node.video_url);
  };

  const children = item?.carousel_media ?? item?.edge_sidecar_to_children?.edges?.map((edge) => edge?.node) ?? [];
  // A carousel container repeats its cover image; its children define slide order.
  for (const node of children.length > 0 ? children : [item]) pushFromNode(node);

  return {
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
  };
}

export function mapItemToRecord(item, username, userId, imgIndex = null) {
  const children = item.carousel_media ?? item.edge_sidecar_to_children?.edges?.map((edge) => edge?.node) ?? [];
  const selectedChild = Number.isInteger(imgIndex) && imgIndex > 0 ? children[imgIndex - 1] : null;
  const mediaNode = selectedChild ?? item;
  const { imageUrls, videoUrls } = extractMediaUrls(mediaNode);
  const shortcode = item.code ?? item.shortcode ?? null;
  const takenAtUnix = item.taken_at ?? item.taken_at_timestamp ?? null;
  const graphType = String(mediaNode.__typename ?? "").replace(/^XDT/, "");
  const mediaType = mediaNode.media_type ?? ({ GraphImage: 1, GraphVideo: 2, GraphSidecar: 8 }[graphType]) ?? null;

  return {
    source: "instagram",
    fetchedAt: new Date().toISOString(),
    username: item.user?.username ?? item.owner?.username ?? username,
    userId: item.user?.pk ?? item.user?.id ?? item.owner?.id ?? userId,
    mediaId: item.id ?? null,
    pk: item.pk ?? null,
    shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/${selectedChild ? `?img_index=${imgIndex}` : ""}` : null,
    mediaType,
    carouselMediaCount: selectedChild ? null : item.carousel_media_count ?? (mediaType === 8 ? children.length : null),
    extractedMediaCount: mediaType === 8 ? children.length : 1,
    productType: mediaNode.product_type ?? null,
    takenAtUnix,
    takenAtIso: takenAtUnix ? new Date(takenAtUnix * 1000).toISOString() : null,
    likeCount: item.like_count ?? item.edge_media_preview_like?.count ?? item.edge_media_to_parent_like?.count ?? null,
    commentCount: item.comment_count ?? item.edge_media_to_comment?.count ?? item.edge_media_to_parent_comment?.count ?? null,
    viewCount: firstCount(item.view_count, item.video_view_count, item.play_count, item.ig_play_count),
    caption: item?.caption?.text ?? item.edge_media_to_caption?.edges?.[0]?.node?.text ?? "",
    imageUrls,
    videoUrls,
  };
}

export function buildInstagramSourceRecord(record) {
  return {
    username: record.username ?? undefined,
    userId: record.userId ?? undefined,
    mediaId: record.mediaId ?? undefined,
    shortcode: record.shortcode ?? undefined,
    permalink: record.permalink ?? undefined,
    takenAtUnix: record.takenAtUnix ?? undefined,
    takenAtIso: record.takenAtIso ?? undefined,
    likeCount: firstCount(record.likeCount),
    commentCount: firstCount(record.commentCount),
    viewCount: firstCount(record.viewCount),
    capturedAt: record.fetchedAt ?? new Date().toISOString(),
  };
}

export function isStopAtShortcodeMatch(record, stopAtShortcode) {
  const target = typeof stopAtShortcode === "string" ? stopAtShortcode.trim() : "";
  return Boolean(target) && record?.shortcode === target;
}
