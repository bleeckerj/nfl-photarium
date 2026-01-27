/**
 * Gallery Constants
 * 
 * Configuration values and static data for the ImageGallery module.
 */

import { IMAGE_VARIANTS } from '@/utils/imageUtils';

// Pagination
export const DEFAULT_PAGE_SIZE = 30;
export const PAGE_SIZE_OPTIONS = [12, 24, 30, 48, 60, 90, 120];

// Local storage keys
export const STORAGE_KEYS = {
  PREFERENCES: 'galleryPreferences',
  HIDDEN_FOLDERS: 'galleryHiddenFolders',
  HIDDEN_TAGS: 'galleryHiddenTags',
  BROKEN_AUDIT: 'galleryBrokenAudit',
} as const;

// Audit
export const AUDIT_LOG_LIMIT = 200;

// Variant dimensions map
export const VARIANT_DIMENSIONS = new Map(
  IMAGE_VARIANTS.map(variant => [variant.name, variant.width])
);

// Variant presets for copy modal
export const VARIANT_PRESETS = ['small', 'medium', 'large', 'xlarge', 'full', 'thumbnail'];

// Utility button classes (for floating toolbar)
export const UTILITY_BUTTON_CLASSES = 
  'text-[0.65rem] font-mono px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition';

// Select options
export const VARIANT_OPTIONS = [
  { value: 'full', label: 'Full (No Resize)' },
  { value: 'w=300', label: 'Small (300px)' },
  { value: 'w=600', label: 'Medium (600px)' },
  { value: 'w=900', label: 'Large (900px)' },
  { value: 'w=1200', label: 'X-Large (1200px)' },
  { value: 'w=150', label: 'Thumbnail-ish (150px)' },
];

// Default preferences
export const DEFAULT_PREFERENCES = {
  variant: 'full',
  onlyCanonical: false,
  respectAspectRatio: false,
  onlyWithVariants: false,
  selectedFolder: 'all',
  selectedTag: '',
  searchTerm: '',
  viewMode: 'grid' as const,
  filtersCollapsed: false,
  bulkFolderInput: '',
  bulkFolderMode: 'existing' as const,
  showDuplicatesOnly: false,
  showBrokenOnly: false,
  pageSize: DEFAULT_PAGE_SIZE,
  dateFilter: null,
  currentPage: 1,
};
