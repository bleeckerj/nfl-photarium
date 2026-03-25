'use client';

import type { ImportDimensions, ImportCandidateMetadata, UploaderQueueItem } from '@/features/page-import/types';

export const formatImportBytes = (bytes?: number) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return 'File size unknown';
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export const formatImportDimensions = (dimensions?: ImportDimensions) => {
  if (!dimensions?.width || !dimensions?.height) {
    return 'Dimensions unknown';
  }
  return `${dimensions.width} x ${dimensions.height}`;
};

export const resolveQueueItemFileSize = (item: UploaderQueueItem) =>
  item.file?.size ?? item.metadata?.fileSizeBytes ?? item.sizeBytes;

export const resolveQueueItemDimensions = (item: UploaderQueueItem) =>
  item.metadata?.dimensions;

export const describeImportMetadataStatus = (metadata?: ImportCandidateMetadata) => {
  const status = metadata?.status ?? 'pending';
  if (status === 'resolved') return 'Metadata resolved';
  if (status === 'partial') return 'Metadata partially resolved';
  if (status === 'failed') return 'Metadata probe failed';
  return 'Resolving metadata';
};
