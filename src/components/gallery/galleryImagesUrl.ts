import type { AspectRatioClass, DateFilter, EmbeddingFilter } from './types';

export type GalleryServerQueryState = {
  page: number;
  pageSize: number;
  search: string;
  folder: string;
  tag: string;
  onlyCanonical: boolean;
  onlyWithVariants: boolean;
  favorites: boolean;
  duplicates: boolean;
  comfy: boolean;
  embedding: EmbeddingFilter;
  aspectRatioFilters: AspectRatioClass[];
  dateFilter: DateFilter | null;
  dateTimeZone?: string;
  hiddenFolders: string[];
  hiddenTags: string[];
  showMotionAssetsOnly: boolean;
};

export const buildGalleryImagesUrl = ({
  forceRefresh = false,
  namespace,
  videoLimitOverride,
  includeExtrasForGallery = false,
  showMotionAssetsOnly = false,
  serverQuery,
  focusAssetId,
}: {
  forceRefresh?: boolean;
  namespace?: string;
  videoLimitOverride?: number | null;
  includeExtrasForGallery?: boolean;
  showMotionAssetsOnly?: boolean;
  serverQuery?: GalleryServerQueryState;
  focusAssetId?: string | null;
}) => {
  const params = new URLSearchParams();
  if (forceRefresh) {
    params.set('refresh', '1');
  }
  if (namespace === '') {
    params.set('namespace', process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default');
  } else if (namespace === '__all__') {
    params.set('namespace', '__all__');
  } else if (namespace && namespace !== '__all__') {
    params.set('namespace', namespace);
  }
  if (videoLimitOverride && videoLimitOverride > 0) {
    params.set('videoLimit', String(videoLimitOverride));
  }
  if (includeExtrasForGallery) {
    params.set('includeExtras', '1');
  }
  if (showMotionAssetsOnly) {
    params.set('mediaFilter', 'animated');
  }
  if (focusAssetId?.trim()) {
    params.set('focus', focusAssetId.trim());
  }
  if (serverQuery) {
    params.set('page', String(serverQuery.page));
    params.set('pageSize', String(serverQuery.pageSize));
    if (serverQuery.search.trim()) params.set('search', serverQuery.search.trim());
    if (serverQuery.folder && serverQuery.folder !== 'all') params.set('folder', serverQuery.folder);
    if (serverQuery.tag) params.set('tag', serverQuery.tag);
    if (serverQuery.onlyCanonical) params.set('onlyCanonical', '1');
    if (serverQuery.onlyWithVariants) params.set('onlyWithVariants', '1');
    if (serverQuery.favorites) params.set('favorites', '1');
    if (serverQuery.duplicates) params.set('duplicates', '1');
    if (serverQuery.comfy) params.set('comfy', '1');
    if (serverQuery.embedding !== 'none') params.set('embedding', serverQuery.embedding);
    if (serverQuery.aspectRatioFilters.length) params.set('aspectRatioClasses', serverQuery.aspectRatioFilters.join(','));
    if (serverQuery.dateFilter?.startDate) params.set('dateStart', serverQuery.dateFilter.startDate);
    if (serverQuery.dateFilter?.endDate) params.set('dateEnd', serverQuery.dateFilter.endDate);
    if (serverQuery.dateFilter && serverQuery.dateTimeZone) params.set('dateTimeZone', serverQuery.dateTimeZone);
    if (serverQuery.hiddenFolders.length) params.set('hiddenFolders', serverQuery.hiddenFolders.join(','));
    if (serverQuery.hiddenTags.length) params.set('hiddenTags', serverQuery.hiddenTags.join(','));
  }
  const queryString = params.toString();
  return queryString ? `/api/images?${queryString}` : '/api/images';
};
