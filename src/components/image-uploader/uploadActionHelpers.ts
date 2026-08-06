import type { SemanticTagJob } from '@/types/semanticTagging';
import type { Dispatch, SetStateAction } from 'react';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { NAMESPACE_REQUIRED_UPLOAD_ERROR } from './constants';
import { inferAssetTypeFromFile, resolveTagInput } from './fileHelpers';
import type { UploadedImage } from './types';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';

export const VIDEO_REMOTE_UPLOAD_CONCURRENCY = 2;
export const GALLERY_PROGRESSIVE_REFRESH_DELAY_MS = 600;
const SEMANTIC_TAG_POLL_INTERVAL_MS = 1500;
const SEMANTIC_TAG_MAX_POLLS = 80;

export type SemanticTagObservation = {
  job: SemanticTagJob;
  filename?: string;
};

export interface UploadResult {
  clientId: string;
  id?: string;
  filename?: string;
  url?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  semanticTagging?: SemanticTagJob;
}

export interface UploadFailure {
  clientId: string;
  error?: string;
  reason?: string;
  duplicates?: unknown[];
}

export const applyNamespaceUploadFailures = (
  items: UploaderQueueItem[],
  setUploadedImages: Dispatch<SetStateAction<UploadedImage[]>>
) => {
  const failures: UploadedImage[] = items.map((item) => ({
    id: item.id,
    assetType: item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl)),
    url: '',
    filename: item.filename,
    status: 'error',
    error: NAMESPACE_REQUIRED_UPLOAD_ERROR,
    file: item.file,
    remoteUrl: item.remoteUrl,
  }));
  setUploadedImages((previous) => {
    const ids = new Set(failures.map((entry) => entry.id));
    return [...previous.filter((entry) => !ids.has(entry.id)), ...failures];
  });
};

export const buildInitialUploadImages = (
  filesToUpload: UploaderQueueItem[],
  options: {
    omitOriginalUrl: boolean;
    originalUrl: string;
    sourceUrl: string;
    tags: string;
    description: string;
    folder: string;
    selectedParentId: string;
  }
): UploadedImage[] => filesToUpload.map((entry) => {
  const originalUrlToSend = options.omitOriginalUrl
    ? ''
    : entry.originalUrl !== undefined ? entry.originalUrl : options.originalUrl.trim() || '';
  const sourceUrlToSend = entry.sourceUrl !== undefined ? entry.sourceUrl : options.sourceUrl.trim() || '';
  const folderToSend = entry.folder !== undefined ? entry.folder : options.folder;
  const tagsToSend = resolveTagInput(options.tags, entry.tags);
  const descriptionToSend = entry.description !== undefined ? entry.description : options.description;

  return {
    id: entry.id,
    assetType: entry.assetType ?? (entry.file ? inferAssetTypeFromFile(entry.file) : 'image'),
    url: '',
    filename: entry.filename,
    status: 'uploading' as const,
    file: entry.file,
    folderInput: folderToSend,
    tagsInput: tagsToSend,
    descriptionInput: descriptionToSend,
    originalUrlInput: originalUrlToSend || undefined,
    sourceUrlInput: sourceUrlToSend || undefined,
    parentId: entry.groupId ? undefined : options.selectedParentId || undefined,
  };
});

export const observeSemanticTagJob = async (
  observation: SemanticTagObservation,
  onFailure: (message: string) => void
) => {
  const label = observation.filename || observation.job.imageId;
  let currentState = observation.job.state;

  if (currentState === 'failed') {
    onFailure(`Semantic tagging failed for ${label}; the upload completed.`);
    return;
  }
  if (currentState === 'succeeded' || currentState === 'disabled') return;

  for (let poll = 0; poll < SEMANTIC_TAG_MAX_POLLS; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, SEMANTIC_TAG_POLL_INTERVAL_MS));
    try {
      const response = await fetch(`/api/images/tag-enrichment/${observation.job.jobId}`);
      if (!response.ok) {
        onFailure(`Semantic tagging status was unavailable for ${label}; the upload completed.`);
        return;
      }
      const job = (await response.json()) as SemanticTagJob;
      currentState = job.state;
      if (currentState === 'succeeded' || currentState === 'disabled') return;
      if (currentState === 'failed') {
        onFailure(`Semantic tagging failed for ${label}; the upload completed.`);
        return;
      }
    } catch {
      onFailure(`Semantic tagging status was unavailable for ${label}; the upload completed.`);
      return;
    }
  }

  onFailure(`Semantic tagging did not finish for ${label}; the upload completed.`);
};

export const formatUploadErrorMessage = (response: Response, payload: unknown) => {
  if (response.status === 409 && payload && typeof payload === 'object' && 'duplicates' in payload) {
    const data = payload as { error?: string; duplicates?: Array<{ id?: string; filename?: string; folder?: string }> };
    if (Array.isArray(data.duplicates) && data.duplicates.length > 0) {
      const summary = data.duplicates
        .map((dup) => {
          const label = dup.filename || 'Untitled';
          const location = dup.folder ? `${label} (${dup.folder})` : label;
          return dup.id ? `${location} [${dup.id}]` : location;
        })
        .slice(0, 3)
        .join(', ');
      const extra = data.duplicates.length > 3 ? '…' : '';
      return `${data.error || 'Duplicate detected.'} Existing: ${summary}${extra}`;
    }
  }
  if (payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: string }).error === 'string') {
    return (payload as { error?: string }).error as string;
  }
  return 'Upload failed';
};

export const isDuplicateUploadFailure = (response: Response, payload: unknown) => {
  if (response.status === 409) return true;
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as { reason?: unknown; duplicates?: unknown };
  return data.reason === 'duplicate' || (Array.isArray(data.duplicates) && data.duplicates.length > 0);
};
