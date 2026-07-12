import { hasFavoriteTag } from '@/utils/systemTags';

export interface GalleryImage {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  promptThis?: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  altText?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  parentId?: string;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  contentHash?: string;
  namespace?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  videoStatus?: 'pending' | 'ready' | 'error';
  videoDurationSeconds?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  // Embedding status fields
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
}

export interface GalleryFilterOptions {
  selectedFolder: string;
  selectedTag: string;
  searchTerm: string;
  onlyCanonical: boolean;
  hiddenFolders?: string[];
  hiddenTags?: string[];
  hiddenNamespaces?: string[];
  showFavoritesOnly?: boolean;
}

const normalize = (value?: string) => value?.toLowerCase() ?? '';
export const SOURCE_QUERY_MIN_DIGITS = 10;

export function isLikelySourceSearchTerm(value: string): boolean {
  const normalized = normalize(value.trim());
  if (!normalized) return false;
  if (normalized.includes('discord.com/channels/')) return true;
  return /\d{10,}/.test(normalized);
}

const splitCamelCase = (value?: string) =>
  (value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

const matchesFolderFilter = (image: GalleryImage, selectedFolder: string) => {
  if (selectedFolder === 'all') return true;
  if (selectedFolder === 'no-folder') return !image.folder;
  return image.folder === selectedFolder;
};

const matchesTagFilter = (image: GalleryImage, selectedTag: string) => {
  if (!selectedTag) return true;
  return Array.isArray(image.tags) && image.tags.includes(selectedTag);
};

const stripQuery = (value: string) => value.split('?')[0];

const matchesSearchFilter = (image: GalleryImage, searchTerm: string) => {
  const normalizedSearch = normalize(searchTerm.trim());
  const normalizedSearchNoQuery = normalizedSearch ? stripQuery(normalizedSearch) : '';
  if (!normalizedSearch) return true;

  const baseHaystacks = [
    normalize(image.id),
    normalize(image.filename),
    normalize(image.displayName),
    normalize(splitCamelCase(image.displayName)),
    normalize(image.promptThis),
    normalize(image.folder),
    normalize(image.altTag),
    normalize(image.altText),
    normalize(image.description),
    normalize(image.originalUrl),
    normalize(image.originalUrlNormalized),
    normalize(image.sourceUrl),
    normalize(image.sourceUrlNormalized),
    ...(image.tags?.map(normalize) ?? []),
    ...(image.variants?.map(normalize) ?? [])
  ].filter(Boolean);

  const haystacks = new Set<string>();
  baseHaystacks.forEach((value) => {
    haystacks.add(value);
    haystacks.add(stripQuery(value));
  });

  return Array.from(haystacks).some(
    (candidate) =>
      candidate.includes(normalizedSearch) || (normalizedSearchNoQuery && candidate.includes(normalizedSearchNoQuery))
  );
};

const matchesHiddenFolderFilter = (image: GalleryImage, hiddenFolders?: string[]) => {
  if (!hiddenFolders || hiddenFolders.length === 0) return true;
  const hiddenNoFolder = hiddenFolders.some(
    (folder) => normalize(folder).replace(/\s+/g, '-') === 'no-folder'
  );
  if (!image.folder) return !hiddenNoFolder;
  return !hiddenFolders.includes(image.folder);
};

const matchesHiddenTagFilter = (image: GalleryImage, hiddenTags?: string[]) => {
  if (!hiddenTags || hiddenTags.length === 0) return true;
  if (!Array.isArray(image.tags) || image.tags.length === 0) return true;
  const hiddenSet = new Set(hiddenTags.map(normalize));
  return !image.tags.some(tag => hiddenSet.has(normalize(tag)));
};

const matchesHiddenNamespaceFilter = (image: GalleryImage, hiddenNamespaces?: string[]) => {
  if (!hiddenNamespaces || hiddenNamespaces.length === 0 || !image.namespace) return true;
  const hiddenSet = new Set(hiddenNamespaces.map(normalize));
  return !hiddenSet.has(normalize(image.namespace));
};

export const filterImagesForGallery = (
  images: GalleryImage[],
  options: GalleryFilterOptions
): GalleryImage[] => {
  const {
    selectedFolder,
    selectedTag,
    searchTerm,
    onlyCanonical,
    hiddenFolders,
    hiddenTags,
    hiddenNamespaces,
    showFavoritesOnly,
  } = options;
  return images.filter((image) => {
    if (!matchesFolderFilter(image, selectedFolder)) return false;
    if (!matchesTagFilter(image, selectedTag)) return false;
    if (showFavoritesOnly && !hasFavoriteTag(image.tags)) return false;
    if (!matchesSearchFilter(image, searchTerm)) return false;
    if (onlyCanonical && image.parentId) return false;
    if (!matchesHiddenFolderFilter(image, hiddenFolders)) return false;
    if (!matchesHiddenTagFilter(image, hiddenTags)) return false;
    if (!matchesHiddenNamespaceFilter(image, hiddenNamespaces)) return false;
    return true;
  });
};
