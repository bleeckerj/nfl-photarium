export interface GalleryImage {
  id: string;
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  parentId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
}

export interface GalleryFilterOptions {
  selectedFolder: string;
  selectedTag: string;
  searchTerm: string;
  onlyCanonical: boolean;
  hiddenFolders?: string[];
  hiddenTags?: string[];
}

const normalize = (value?: string) => value?.toLowerCase() ?? '';

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
    normalize(image.folder),
    normalize(image.altTag),
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

export const filterImagesForGallery = (
  images: GalleryImage[],
  options: GalleryFilterOptions
): GalleryImage[] => {
  const { selectedFolder, selectedTag, searchTerm, onlyCanonical, hiddenFolders, hiddenTags } = options;
  return images.filter((image) => {
    if (!matchesFolderFilter(image, selectedFolder)) return false;
    if (!matchesTagFilter(image, selectedTag)) return false;
    if (!matchesSearchFilter(image, searchTerm)) return false;
    if (onlyCanonical && image.parentId) return false;
    if (!matchesHiddenFolderFilter(image, hiddenFolders)) return false;
    if (!matchesHiddenTagFilter(image, hiddenTags)) return false;
    return true;
  });
};
