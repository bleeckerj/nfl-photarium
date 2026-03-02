/**
 * Gallery Types
 * 
 * Centralized type definitions for the ImageGallery module.
 * Keeps type definitions separate from implementation for better maintainability.
 */

import type { EmbeddingPendingEntry } from '@/utils/embeddingPending';

export interface CloudflareImage {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  folder?: string;
  tags?: string[];
  description?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  parentId?: string;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  contentHash?: string;
  namespace?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
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

export interface ImageGalleryProps {
  refreshTrigger?: number;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

export interface ImageGalleryRef {
  refreshImages: () => void;
}

export type ViewMode = 'grid' | 'list';
export type GridSize = 'small' | 'medium' | 'large' | 'xlarge';
export type BulkFolderMode = 'existing' | 'new';
export type BulkTagsMode = 'replace' | 'append' | 'ai';
export type BulkDisplayNameMode = 'custom' | 'auto' | 'clear' | 'ai';
export type EmbeddingFilter = 'none' | 'missing-clip' | 'missing-color' | 'missing-any' | 'missing-both';
export type AspectRatioClass = 'horizontal' | 'vertical' | 'square';

export interface DateFilter {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface BrokenAudit {
  checkedAt?: string;
  ids: string[];
}

export interface AuditLogEntry {
  id: string;
  filename?: string;
  status?: number;
  reason?: string;
  url?: string;
}

export interface AuditProgress {
  checked: number;
  total: number;
}

export interface GalleryPreferences {
  variant: string;
  onlyCanonical: boolean;
  respectAspectRatio: boolean;
  onlyWithVariants: boolean;
  showComfyOnly: boolean;
  selectedFolder: string;
  selectedTag: string;
  searchTerm: string;
  viewMode: ViewMode;
  gridSize: GridSize;
  filtersCollapsed: boolean;
  bulkFolderInput: string;
  bulkFolderMode: BulkFolderMode;
  showDuplicatesOnly: boolean;
  showBrokenOnly: boolean;
  pageSize: number;
  dateFilter: DateFilter | null;
  currentPage: number;
}

export interface ColorMetadata {
  dominantColors?: string[];
  averageColor?: string;
}

export interface GalleryViewFilters {
  images: CloudflareImage[];
  selectedVariant: string;
  respectAspectRatio: boolean;
  bulkSelectionMode: boolean;
  selectedImageIds: Set<string>;
  duplicateIds: Set<string>;
  childrenMap: Record<string, CloudflareImage[]>;
  colorMetadataMap: Record<string, ColorMetadata>;
  embeddingPendingMap: Record<string, EmbeddingPendingEntry>;
  altLoadingMap: Record<string, boolean>;
  displayNameLoadingMap: Record<string, boolean>;
  galleryReturnHrefSuffix: string;
}

export type DuplicateReason = 'originalUrl+contentHash';

export interface DuplicateGroup {
  key: string;
  reason: DuplicateReason;
  label: string;
  items: CloudflareImage[];
}

export interface SelectOption {
  value: string;
  label: string;
}

// Bulk edit state
export interface BulkEditState {
  isOpen: boolean;
  folderInput: string;
  folderMode: BulkFolderMode;
  tagsInput: string;
  tagsMode: BulkTagsMode;
  applyFolder: boolean;
  applyTags: boolean;
  applyDisplayName: boolean;
  displayNameMode: BulkDisplayNameMode;
  displayNameInput: string;
  applyNamespace: boolean;
  namespaceInput: string;
  isUpdating: boolean;
  isDeleting: boolean;
  isEmbeddingGenerating: boolean;
  // Animation
  animateFps: string;
  animateTouched: boolean;
  animateLoop: boolean;
  animateFilename: string;
  animateLoading: boolean;
  animateError: string | null;
}

// Image card actions
export interface ImageCardActions {
  onDelete: (imageId: string) => Promise<void>;
  onGenerateAlt: (imageId: string) => Promise<void>;
  onGenerateDisplayName: (imageId: string) => Promise<void>;
  onStartEdit: (image: CloudflareImage) => void;
  onCopyUrl: (imageId: string) => void;
  onToggleSelection: (imageId: string) => void;
}

// Namespace info
export interface NamespaceInfo {
  id: string;
  label: string;
  enabled: boolean;
}

// Edit modal state
export interface EditModalState {
  isOpen: boolean;
  image: CloudflareImage | null;
  editedFilename: string;
  editedAltTag: string;
  editedTags: string;
  isGeneratingAlt: boolean;
}

// Copy modal state
export interface CopyModalState {
  isOpen: boolean;
  image: CloudflareImage | null;
}

// Delete confirm state
export interface DeleteConfirmState {
  isOpen: boolean;
  imageIds: string[];
  isDeleting: boolean;
}

// Namespace modal state
export interface NamespaceModalState {
  isOpen: boolean;
}
