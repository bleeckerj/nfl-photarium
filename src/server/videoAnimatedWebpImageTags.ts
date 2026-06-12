const VIDEO_ANIMATED_WEBP_EXCLUDED_TAGS = new Set(['animated-webp', 'video-derivative']);

export const buildVideoAnimatedWebpImageTags = (tags: readonly string[] | undefined): string[] =>
  Array.from(
    new Set(
      (tags || []).filter((tag) => !VIDEO_ANIMATED_WEBP_EXCLUDED_TAGS.has(tag.trim().toLowerCase()))
    )
  );
