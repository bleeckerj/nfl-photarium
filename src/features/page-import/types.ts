'use client';

import type { SmallAssetReview } from '@/features/page-import/utils/smallAssetPolicy';

export type ImportMetadataStatus = 'pending' | 'partial' | 'resolved' | 'failed';

export type ImportDimensions = {
  width: number;
  height: number;
};

export type ImportCandidateMetadata = {
  dimensions?: ImportDimensions;
  fileSizeBytes?: number;
  contentType?: string;
  status: ImportMetadataStatus;
  sources?: {
    dimensions?: 'browser' | 'probe' | 'temp';
    fileSize?: 'head' | 'network' | 'probe' | 'temp';
  };
};

export type ImportCandidate = {
  id: string;
  kind: 'image' | 'video';
  url: string;
  filename: string;
  previewUrl?: string;
  posterUrl?: string;
  isBlobSource: boolean;
  metadata: ImportCandidateMetadata;
  tempAssetKey?: string;
  contentLength?: number;
  contentType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  isBlob?: boolean;
  smallAssetReview?: SmallAssetReview;
};

export type ImportSessionState = {
  sessionId: string | null;
  status: 'idle' | 'creating' | 'ready' | 'error';
  error?: string;
};

export type UploaderQueueItem = {
  id: string;
  assetType?: 'image' | 'video';
  file?: File;
  filename: string;
  remoteUrl?: string;
  previewUrl?: string;
  posterUrl?: string;
  previewFrameUrls?: string[];
  isBlobSource?: boolean;
  sizeBytes?: number;
  contentType?: string;
  selected?: boolean;
  originalUrl?: string;
  sourceUrl?: string;
  sourcePath?: string;
  folder?: string;
  tags?: string;
  description?: string;
  captureDate?: string;
  groupId?: string;
  groupIndex?: number;
  processingNote?: string;
  /**
   * How to present `processingNote`. Failures from a pre-upload stage (AI naming,
   * size reduction) used to render in the same green as progress notes, so an
   * upstream vendor error read as though the upload itself had been rejected.
   */
  processingNoteTone?: 'info' | 'error';
  metadata?: ImportCandidateMetadata;
  tempAssetKey?: string;
  importSessionId?: string;
  smallAssetReview?: SmallAssetReview;
  duplicateAction?: 'reject' | 'family' | 'override';
};

export type ImportProgressState = {
  message: string;
  scrollCount: number;
  imageCount: number;
  pageNum?: number;
} | null;
