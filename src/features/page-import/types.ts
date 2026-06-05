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
  metadata?: ImportCandidateMetadata;
  tempAssetKey?: string;
  importSessionId?: string;
  smallAssetReview?: SmallAssetReview;
};

export type ImportProgressState = {
  message: string;
  scrollCount: number;
  imageCount: number;
  pageNum?: number;
} | null;
