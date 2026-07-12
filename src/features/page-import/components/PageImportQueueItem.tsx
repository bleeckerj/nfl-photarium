'use client';

import { useEffect, useState } from 'react';
import { sanitizeFilename, needsSanitization, MAX_FILENAME_LENGTH } from '@/utils/filename';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';
import type { UploaderQueueItem } from '@/features/page-import/types';
import {
  describeImportMetadataStatus,
  formatImportBytes,
  formatImportDimensions,
  resolveQueueItemDimensions,
  resolveQueueItemFileSize,
} from '@/features/page-import/utils/formatters';
import {
  MIN_SMALL_ASSET_DIMENSION,
  formatSmallAssetThresholdMb,
} from '@/features/page-import/utils/smallAssetPolicy';

type PageImportQueueItemProps = {
  item: UploaderQueueItem;
  isUploading: boolean;
  previewFailed: boolean;
  reducing: boolean;
  metadataExpanded: boolean;
  selectedFolder: string;
  newFolder: string;
  tags: string;
  description: string;
  originalUrl: string;
  sourceUrl: string;
  updateQueuedFile: (id: string, updates: Partial<UploaderQueueItem>) => void;
  resolveTagInput: (globalTags: string, itemTags?: string) => string;
  buildMetadataEstimate: (
    item: UploaderQueueItem,
    overrides: { folder?: string; tags?: string; description?: string; originalUrl?: string; sourceUrl?: string }
  ) => number;
  onPreviewLoadError: (item: UploaderQueueItem) => void;
  onReduceSize: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleMetadata: (id: string) => void;
};

export function PageImportQueueItem(props: PageImportQueueItemProps) {
  const {
    item,
    isUploading,
    previewFailed,
    reducing,
    metadataExpanded,
    selectedFolder,
    newFolder,
    tags,
    description,
    originalUrl,
    sourceUrl,
    updateQueuedFile,
    resolveTagInput,
    buildMetadataEstimate,
    onPreviewLoadError,
    onReduceSize,
    onRemove,
    onToggleMetadata,
  } = props;

  const hasCustomFolder = item.folder !== undefined;
  const hasCustomTags = item.tags !== undefined;
  const hasCustomDescription = item.description !== undefined;
  const hasCustomOriginalUrl = item.originalUrl !== undefined;
  const hasCustomSourceUrl = item.sourceUrl !== undefined;
  const previewUrl = item.previewUrl || item.remoteUrl;
  const effectiveAssetType =
    item.assetType ?? (item.file ? (item.file.type.startsWith('video/') ? 'video' : 'image') : inferAssetTypeFromUrl(item.remoteUrl));
  const displaySizeBytes = resolveQueueItemFileSize(item);
  const displayDimensions = resolveQueueItemDimensions(item);
  const overMaxBytes = typeof displaySizeBytes === 'number' && displaySizeBytes > 10 * 1024 * 1024;
  const previewFolder = selectedFolder.trim()
    ? selectedFolder.trim()
    : newFolder.trim()
      ? newFolder.trim().toLowerCase().replace(/\s+/g, '-')
      : '';
  const effectiveFolder = hasCustomFolder ? item.folder || '' : previewFolder;
  const effectiveTags = resolveTagInput(tags, hasCustomTags ? item.tags : undefined);
  const effectiveDescription = hasCustomDescription ? item.description || '' : description;
  const effectiveOriginalUrl = hasCustomOriginalUrl ? item.originalUrl || '' : originalUrl;
  const effectiveSourceUrl = hasCustomSourceUrl ? item.sourceUrl || '' : sourceUrl;
  const metadataBytes = buildMetadataEstimate(item, {
    folder: effectiveFolder,
    tags: effectiveTags,
    description: effectiveDescription,
    originalUrl: effectiveOriginalUrl,
    sourceUrl: effectiveSourceUrl,
  });
  const metadataOverLimit = metadataBytes >= 1024;
  const isSelected = item.selected !== false;
  const isSmallAssetPendingReview = Boolean(item.smallAssetReview) && !isSelected;
  const smallAssetReviewLabel = item.smallAssetReview
    ? item.smallAssetReview.reason === 'file-size'
      ? `Below ${formatSmallAssetThresholdMb(item.smallAssetReview.thresholdBytes)} MB threshold`
      : `Below ${MIN_SMALL_ASSET_DIMENSION} px dimension threshold`
    : null;

  const previewFrameUrls = item.previewFrameUrls ?? [];
  const canCycleFrames = previewFrameUrls.length > 1;
  const [hoveringPreview, setHoveringPreview] = useState(false);
  const [frameIndex, setFrameIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!hoveringPreview || !canCycleFrames) {
      setFrameIndex(null);
      return;
    }
    setFrameIndex(0);
    const timer = setInterval(() => {
      setFrameIndex((index) => ((index ?? 0) + 1) % previewFrameUrls.length);
    }, 450);
    return () => clearInterval(timer);
  }, [hoveringPreview, canCycleFrames, previewFrameUrls.length]);

  const cyclingFrameUrl = frameIndex !== null ? previewFrameUrls[frameIndex] : undefined;

  return (
    <div
      className={`w-full rounded-lg border p-3 transition-colors ${
        isSmallAssetPendingReview
          ? 'border-amber-200 bg-amber-50/70'
          : 'border-blue-200 bg-blue-50'
      }`}
    >
      <div className="flex items-start gap-3">
        {(previewUrl || item.posterUrl) && !previewFailed ? (
          effectiveAssetType === 'video' ? (
            <div
              className={`relative h-28 w-28 overflow-hidden rounded border border-blue-200 bg-black transition-opacity ${
                isSmallAssetPendingReview ? 'opacity-60' : 'opacity-100'
              }`}
              onMouseEnter={() => setHoveringPreview(true)}
              onMouseLeave={() => setHoveringPreview(false)}
              title={canCycleFrames ? 'Hover to preview' : undefined}
            >
              {(item.posterUrl || (!item.file ? previewUrl : undefined)) ? (
                <img
                  src={cyclingFrameUrl || item.posterUrl || previewUrl}
                  alt={item.filename}
                  className="h-full w-full object-cover"
                  onError={() => {
                    if (cyclingFrameUrl) {
                      setFrameIndex(null);
                      return;
                    }
                    onPreviewLoadError(item);
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">VIDEO</div>
              )}
              <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                VIDEO{frameIndex !== null ? ` · ${frameIndex + 1}/${previewFrameUrls.length}` : ''}
              </div>
            </div>
          ) : (
            <img
              src={previewUrl}
              alt={item.filename}
              className={`h-28 w-28 rounded border border-blue-200 bg-white object-cover transition-opacity ${
                isSmallAssetPendingReview ? 'opacity-60' : 'opacity-100'
              }`}
              onError={() => onPreviewLoadError(item)}
              referrerPolicy="no-referrer"
            />
          )
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded border border-blue-200 bg-white text-[10px] text-gray-400">
            {item.file
              ? effectiveAssetType === 'video' && item.metadata?.status !== 'failed'
                ? 'Generating preview'
                : 'Local file'
              : 'No preview (source blocked?)'}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={item.filename}
              onChange={(e) => updateQueuedFile(item.id, { filename: e.target.value })}
              className="min-w-0 flex-1 truncate border-b border-transparent bg-transparent text-xs font-medium text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none"
              title="Click to edit filename"
              disabled={isUploading}
            />
            {needsSanitization(item.filename) && (
              <button
                type="button"
                onClick={() => updateQueuedFile(item.id, { filename: sanitizeFilename(item.filename) })}
                className="whitespace-nowrap rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-200"
                title="Clean up and truncate filename"
                disabled={isUploading}
              >
                Sanitize
              </button>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{formatImportBytes(displaySizeBytes)}</span>
            <span>{formatImportDimensions(displayDimensions)}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">{effectiveAssetType}</span>
            {isSmallAssetPendingReview && smallAssetReviewLabel && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                {smallAssetReviewLabel}
              </span>
            )}
          </div>

          <p className="mt-1 text-[11px] text-gray-600">{describeImportMetadataStatus(item.metadata)}</p>

          {item.filename.length > MAX_FILENAME_LENGTH && (
            <p className="mt-1 text-[11px] text-amber-600">Long filename ({item.filename.length} chars)</p>
          )}
          {item.processingNote && <p className="mt-1 text-[11px] text-emerald-700">{item.processingNote}</p>}
          {overMaxBytes && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-amber-700">
                File exceeds 10MB. Suggest converting to JPEG/WebP, then reducing dimensions.
              </p>
              <button
                type="button"
                onClick={() => onReduceSize(item.id)}
                disabled={reducing || isUploading}
                className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] text-amber-800 disabled:opacity-50"
              >
                {reducing ? 'Reducing...' : 'Reduce size'}
              </button>
            </div>
          )}
          {effectiveOriginalUrl && (
            <p className="mt-1 truncate text-[11px] text-gray-600" title={effectiveOriginalUrl}>
              {effectiveOriginalUrl}
            </p>
          )}
        </div>

        <label className="flex items-center gap-1 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => updateQueuedFile(item.id, { selected: e.target.checked })}
            className="h-3 w-3"
            disabled={isUploading}
          />
          Include
        </label>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleMetadata(item.id)}
          className="text-[11px] text-blue-600 hover:text-blue-800"
        >
          {metadataExpanded ? 'Hide metadata' : 'Show metadata'}
        </button>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="text-xs text-red-600 hover:text-red-800"
          disabled={isUploading}
        >
          Remove
        </button>
      </div>

      {metadataExpanded && (
        <div className="mt-2 space-y-2 border-t border-blue-200 pt-2">
          <div className="space-y-1">
            <p className="truncate text-[11px] text-gray-600" title={effectiveFolder || '-'}>
              Folder: {effectiveFolder || '-'}
            </p>
            <p className="truncate text-[11px] text-gray-600" title={effectiveTags || '-'}>
              Tags: {effectiveTags || '-'}
            </p>
            <p className="truncate text-[11px] text-gray-600" title={effectiveDescription || '-'}>
              Description: {effectiveDescription || '-'}
            </p>
            <p className="truncate text-[11px] text-gray-600" title={effectiveOriginalUrl || '-'}>
              Original URL: {effectiveOriginalUrl || '-'}
            </p>
            <p className="truncate text-[11px] text-gray-600" title={effectiveSourceUrl || '-'}>
              Source URL: {effectiveSourceUrl || '-'}
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-gray-700">
              Folder override
              <input
                type="text"
                value={item.folder ?? ''}
                onChange={(e) => updateQueuedFile(item.id, { folder: e.target.value })}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-700">
              Tags override
              <input
                type="text"
                value={item.tags ?? ''}
                onChange={(e) => updateQueuedFile(item.id, { tags: e.target.value })}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-700">
              Description override
              <input
                type="text"
                value={item.description ?? ''}
                onChange={(e) => updateQueuedFile(item.id, { description: e.target.value })}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-700">
              Original URL override
              <input
                type="text"
                value={item.originalUrl ?? ''}
                onChange={(e) => updateQueuedFile(item.id, { originalUrl: e.target.value })}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-700 md:col-span-2">
              Source URL override
              <input
                type="text"
                value={item.sourceUrl ?? ''}
                onChange={(e) => updateQueuedFile(item.id, { sourceUrl: e.target.value })}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
          </div>

          <p className={`text-[11px] ${metadataOverLimit ? 'text-amber-700' : 'text-gray-500'}`}>
            Estimated Cloudflare metadata payload: {metadataBytes} bytes
          </p>
        </div>
      )}
    </div>
  );
}
