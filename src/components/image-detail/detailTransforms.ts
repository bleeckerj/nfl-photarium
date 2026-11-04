import { IMAGE_VARIANTS } from '@/utils/imageUtils';

export type BulkUpdateFailure = {
  id: string;
  name: string;
  error?: string;
  reason?: 'metadata' | 'network' | 'unknown';
};

type FamilyImage = {
  id: string;
  uploaded: string;
  parentId?: string;
  variationSort?: number;
};

type AnimatedImage = {
  assetType?: 'image' | 'video';
  filename: string;
  tags?: string[];
  contentType?: string;
  isAnimated?: boolean;
} | null;

const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));
const MAX_CLOUDFLARE_TEXT_MIRROR_CHARS = 160;

export const ensureWebpFormat = (inputUrl: string) => {
  const parts = inputUrl.split('?');
  const base = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  params.set('format', 'webp');
  return `${base}?${params.toString()}`;
};

export const getVariantWidthLabel = (variant: string) => {
  const width = VARIANT_DIMENSIONS.get(variant);
  if (!width) {
    return null;
  }
  return `${width}px`;
};

export const isMetadataLimitError = (message?: string) => {
  if (!message) return false;
  const lowered = message.toLowerCase();
  return (
    lowered.includes('metadata') &&
    (lowered.includes('too large') ||
      lowered.includes('size') ||
      lowered.includes('limit') ||
      lowered.includes('exceed') ||
      lowered.includes('maximum'))
  );
};

export const formatFailureNames = (failures: BulkUpdateFailure[]) => {
  const names = failures.map((failure) => failure.name);
  const preview = names.slice(0, 3).join(', ');
  if (names.length <= 3) {
    return preview;
  }
  return `${preview} +${names.length - 3} more`;
};

export const formatEntriesAsYaml = (entries: { url: string; altText: string }[]) => {
  const lines = ['imagesFromGridDirectory:'];
  entries.forEach((entry) => {
    lines.push(`  - url: ${entry.url}`);
    lines.push(`    altText: ${JSON.stringify(entry.altText ?? '')}`);
  });
  return lines.join('\n');
};

export const toCloudflareTextMirror = (value?: string) => {
  if (!value) return '';
  const compact = value.trim();
  if (!compact) return '';
  return compact.length <= MAX_CLOUDFLARE_TEXT_MIRROR_CHARS
    ? compact
    : `${compact.slice(0, MAX_CLOUDFLARE_TEXT_MIRROR_CHARS)}…`;
};

export const mergeUniqueTags = (existingTags: string[], incomingTags: string[]) => {
  const merged = new Map<string, string>();
  existingTags.forEach((tag) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      merged.set(normalized, tag.trim());
    }
  });
  incomingTags.forEach((tag) => {
    const trimmed = tag.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized && !merged.has(normalized)) {
      merged.set(normalized, trimmed);
    }
  });
  return Array.from(merged.values());
};

export const isAnimatedWebpAsset = (image: AnimatedImage) => {
  if (!image || image.assetType === 'video') return false;
  if (image.isAnimated === true) return true;
  const tags = Array.isArray(image.tags) ? image.tags : [];
  if (tags.some((tag) => tag.trim().toLowerCase() === 'animated-webp')) return true;
  const contentType = image.contentType?.trim().toLowerCase();
  return contentType === 'image/webp' && image.filename.trim().toLowerCase().endsWith('.webp');
};

export const mergeUniqueImagesById = <T extends { id: string }>(base: T[], incoming: T[]) => {
  const merged = new Map<string, T>();
  base.forEach((entry) => merged.set(entry.id, entry));
  incoming.forEach((entry) => {
    const existing = merged.get(entry.id);
    merged.set(entry.id, existing ? { ...existing, ...entry } : entry);
  });
  return Array.from(merged.values());
};

export const mergeFamilyContextImages = <T extends FamilyImage>(
  base: T[],
  incoming: T[],
  familyRootId?: string
) => {
  if (!familyRootId) {
    return mergeUniqueImagesById(base, incoming);
  }

  const incomingIds = new Set(incoming.map((entry) => entry.id));
  const pruned = base.filter((entry) => {
    const isKnownFamilyMember = entry.id === familyRootId || entry.parentId === familyRootId;
    return !isKnownFamilyMember || incomingIds.has(entry.id);
  });

  return mergeUniqueImagesById(pruned, incoming);
};

export { sortFamilyMembers } from '@/utils/familyOrder';
