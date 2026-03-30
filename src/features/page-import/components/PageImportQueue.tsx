'use client';

import { PageImportQueueItem } from '@/features/page-import/components/PageImportQueueItem';
import type { UploaderQueueItem } from '@/features/page-import/types';

type PageImportQueueProps = {
  queuedFiles: UploaderQueueItem[];
  visibleQueuedFiles: UploaderQueueItem[];
  selectedQueuedCount: number;
  isUploading: boolean;
  uploadBlockedByNamespace: boolean;
  aiRefiningNames: boolean;
  queueRenameValue: string;
  setQueueRenameValue: (value: string) => void;
  showAllQueuedItems: boolean;
  setShowAllQueuedItems: (value: boolean) => void;
  previewFailures: Record<string, boolean>;
  reducingQueueItems: Record<string, boolean>;
  expandedQueueMetadata: Record<string, boolean>;
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
  onClearQueue: () => void;
  onUnselectAll: () => void;
  onAiRefineSelectedNames: () => void;
  onManualUpload: () => void;
  onApplyQueueNameToAll: () => void;
};

const QUEUE_RENDER_LIMIT = 250;

export function PageImportQueue(props: PageImportQueueProps) {
  const {
    queuedFiles,
    visibleQueuedFiles,
    selectedQueuedCount,
    isUploading,
    uploadBlockedByNamespace,
    aiRefiningNames,
    queueRenameValue,
    setQueueRenameValue,
    showAllQueuedItems,
    setShowAllQueuedItems,
    previewFailures,
    reducingQueueItems,
    expandedQueueMetadata,
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
    onClearQueue,
    onUnselectAll,
    onAiRefineSelectedNames,
    onManualUpload,
    onApplyQueueNameToAll,
  } = props;

  if (queuedFiles.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-mono font-medium text-gray-900">Queued Files ({queuedFiles.length})</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAiRefineSelectedNames}
            disabled={isUploading || aiRefiningNames || selectedQueuedCount === 0}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {aiRefiningNames ? 'Refining...' : 'AI shortname selected'}
          </button>
          <button
            type="button"
            onClick={onManualUpload}
            disabled={isUploading || selectedQueuedCount === 0 || uploadBlockedByNamespace}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Upload {selectedQueuedCount} File{selectedQueuedCount !== 1 ? 's' : ''}
          </button>
          <button
            type="button"
            onClick={onUnselectAll}
            disabled={isUploading || selectedQueuedCount === 0}
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Unselect all
          </button>
          <button
            type="button"
            onClick={onClearQueue}
            disabled={isUploading}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Clear queue
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={queueRenameValue}
          onChange={(e) => setQueueRenameValue(e.target.value)}
          placeholder="Rename selected queue items"
          className="flex-1 rounded-md border border-blue-200 px-3 py-2 text-xs"
        />
        <button
          type="button"
          onClick={onApplyQueueNameToAll}
          disabled={isUploading || queuedFiles.length === 0 || queueRenameValue.trim().length === 0}
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          Apply queue name
        </button>
      </div>

      {uploadBlockedByNamespace && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Select a specific namespace before uploading queued items.
        </div>
      )}

      {queuedFiles.length > QUEUE_RENDER_LIMIT && !showAllQueuedItems && (
        <p className="mt-2 text-[11px] text-gray-600">
          Showing the first {QUEUE_RENDER_LIMIT} queue items.
          <button
            type="button"
            onClick={() => setShowAllQueuedItems(true)}
            className="ml-2 text-blue-600 hover:text-blue-800"
          >
            Show all
          </button>
        </p>
      )}
      {queuedFiles.length > QUEUE_RENDER_LIMIT && showAllQueuedItems && (
        <p className="mt-2 text-[11px] text-gray-600">
          Showing all {queuedFiles.length} queue items.
          <button
            type="button"
            onClick={() => setShowAllQueuedItems(false)}
            className="ml-2 text-blue-600 hover:text-blue-800"
          >
            Show fewer
          </button>
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3">
        {visibleQueuedFiles.map((item) => (
          <PageImportQueueItem
            key={item.id}
            item={item}
            isUploading={isUploading}
            previewFailed={Boolean(previewFailures[item.id])}
            reducing={Boolean(reducingQueueItems[item.id])}
            metadataExpanded={Boolean(expandedQueueMetadata[item.id])}
            selectedFolder={selectedFolder}
            newFolder={newFolder}
            tags={tags}
            description={description}
            originalUrl={originalUrl}
            sourceUrl={sourceUrl}
            updateQueuedFile={updateQueuedFile}
            resolveTagInput={resolveTagInput}
            buildMetadataEstimate={buildMetadataEstimate}
            onPreviewLoadError={onPreviewLoadError}
            onReduceSize={onReduceSize}
            onRemove={onRemove}
            onToggleMetadata={onToggleMetadata}
          />
        ))}
      </div>
    </div>
  );
}
