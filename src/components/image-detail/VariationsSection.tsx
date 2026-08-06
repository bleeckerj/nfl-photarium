import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Crop, GripVertical } from 'lucide-react';

import MonoSelect from '@/components/MonoSelect';
import {
  getAssetCopyUrl,
  getAssetDetailPath,
  getAssetPreviewUrl,
  isVideoAsset,
} from '@/utils/assetUrls';
import { formatBytes } from '@/utils/formatBytes';
import type { ImageLike, VariationsSectionProps } from '@/components/image-detail/variationsSectionTypes';

export type { ImageLike, SelectOption, VariationsSectionProps } from '@/components/image-detail/variationsSectionTypes';


export function VariationsSection(props: VariationsSectionProps) {
  const {
    isChildImage,
    variationCount,
    variationLayout,
    setVariationLayout,
    variationTrueAspect,
    setVariationTrueAspect,
    listVariant,
    setListVariant,
    listVariantOptions,
    onCopyList,
    onCreateCropVariant,
    variationCandidatesLength,
    variationOrderSaving,
    onResetVariationOrder,
    onReverseVariationOrder,
    onSortVariationOrder,
    onDeleteParent,
    onDeleteFamily,
    selectedVariationCount,
    onSelectAllOnPage,
    onClearSelection,
    onGenerateAltForSelected,
    variationAltBusy,
    onDeleteSelectedVariations,
    deletingSelectedVariations,
    pagedVariations,
    displayedVariations,
    variationOrderIndex,
    selectedVariationIds,
    toggleVariationSelection,
    dragOverVariationId,
    setDraggingVariationId,
    setDragOverVariationId,
    onDropVariation,
    onMoveVariation,
    onHandleThumbMouseMove,
    onHandleThumbLeave,
    onHandleImageDragStart,
    onHandleCopyUrl,
    onCopyVariationId,
    onOpenVariantSizes,
    childDetachingId,
    detachingAllChildren,
    onDetachChild,
    onDetachAllChildren,
    onDeleteChild,
    swappingParentId,
    swapParentAssetCount,
    onSwapParent,
    AspectRatioDisplay,
    variationPage,
    setVariationPage,
    totalVariationPages,
    variationPageSize
  } = props;

  const parseAspectRatio = (value?: string): number | null => {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.includes(':')) {
      const parts = normalized.split(':');
      if (parts.length !== 2) return null;
      const width = Number.parseFloat(parts[0]);
      const height = Number.parseFloat(parts[1]);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      return width / height;
    }
    const numeric = Number.parseFloat(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return numeric;
  };

  const getTrueAspectRatio = (image: ImageLike): number | null => {
    const width = image.dimensions?.width;
    const height = image.dimensions?.height;
    if (Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0) {
      return (width as number) / (height as number);
    }
    return parseAspectRatio(image.aspectRatio);
  };

  const getThumbAspectRatio = (image: ImageLike): number => {
    if (!variationTrueAspect) {
      return 4 / 3;
    }
    return getTrueAspectRatio(image) ?? 4 / 3;
  };

  const showPagination = variationCount > variationPageSize;
  const paginationControls = (
    <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
      <div>Page {variationPage} of {totalVariationPages}</div>
      <div className="flex gap-2">
        <button
          onClick={() => setVariationPage((p) => Math.max(1, p - 1))}
          disabled={variationPage === 1}
          className="px-2 py-1 border rounded disabled:opacity-50"
        >
          Prev
        </button>
        <button
          onClick={() => setVariationPage((p) => Math.min(totalVariationPages, p + 1))}
          disabled={variationPage === totalVariationPages}
          className="px-2 py-1 border rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );

  return (
    <div id="variations-section" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-mono font-medum text-gray-700">
          {/* There's no reason to say 'Vars' as that term is referred to with the count of vars, so just say 'Other vars from this parent' if it's a child image, otherwise no header is needed */}
          {isChildImage ? 'Other vars from this parent' : ''}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="text-[10px] whitespace-nowrap text-gray-500">
              {variationCount} {isChildImage ? 'other var' : 'var'}
              {variationCount !== 1 ? 's' : ''}
            </p>
          <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-0.5">
            <button
              onClick={() => setVariationLayout('list')}
              className={`px-2 py-1 text-[10px] rounded ${variationLayout === 'list' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              List
            </button>
            <button
              onClick={() => setVariationLayout('grid')}
              className={`px-2 py-1 text-[10px] rounded ${variationLayout === 'grid' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Grid
            </button>
          </div>
          <button
            onClick={() => setVariationTrueAspect(!variationTrueAspect)}
            className={`px-2 py-1 text-[10px] border rounded-md ${variationTrueAspect ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title="Show variation thumbnails in each image's true aspect ratio"
          >
            True aspect
          </button>
          {!isChildImage && (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="copy-list-variant" className="text-[10px] text-gray-500">
                  Copy variant
                </label>
                <MonoSelect
                  id="copy-list-variant"
                  value={listVariant}
                  onChange={setListVariant}
                  options={listVariantOptions}
                  className="w-32 text-[10px]"
                />
                <span className="text-[10px] text-gray-400">used for copy actions</span>
              </div>
              <button
                onClick={() => void onCopyList()}
                className="px-2 py-1 text-[10px] border border-gray-300 rounded-md text-blue-600 hover:bg-blue-50"
              >
                Copy list
              </button>
              {onCreateCropVariant && (
                <button
                  onClick={() => void onCreateCropVariant()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-blue-300 rounded-md text-blue-700 hover:bg-blue-50"
                >
                  <Crop className="h-3 w-3" aria-hidden="true" />
                  Crop / expand
                </button>
              )}
              <button
          onClick={() => void onResetVariationOrder()}
          disabled={variationOrderSaving || !variationCandidatesLength}
          className="px-2 py-1 text-[10px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
          Reset order
              </button>
              <button
          onClick={() => void onReverseVariationOrder()}
          disabled={variationOrderSaving || !variationCandidatesLength}
          className="px-2 py-1 text-[10px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
          Reverse order
              </button>
              <button
          onClick={() => void onSortVariationOrder()}
          disabled={variationOrderSaving || !variationCandidatesLength}
          className="px-2 py-1 text-[10px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
          Sort A→Z
              </button>
              <button
          onClick={() => void onDeleteParent()}
          className="px-2 py-1 text-[10px] border border-red-300 rounded-md text-red-600 hover:bg-red-50"
              >
          Delete image
              </button>
              <button
          onClick={() => void onDeleteFamily()}
          className="px-2 py-1 text-[10px] border border-red-500 rounded-md text-red-700 bg-red-50 hover:bg-red-100"
          title="Delete this image and all variations"
              >
          Delete family
              </button>
              <button
          onClick={() => void onDetachAllChildren()}
          disabled={detachingAllChildren || variationCount === 0}
          className="px-2 py-1 text-[10px] border border-red-500 rounded-md text-red-800 bg-red-100 hover:bg-red-200 disabled:opacity-50"
          title="Detach all variations from this parent"
              >
          {detachingAllChildren ? 'Detaching all…' : 'Detach all vars'}
              </button>
            </>
          )}
        </div>
      </div>

      {variationCount === 0 ? (
        <p className="text-xs text-gray-500">
          {isChildImage
            ? 'No other variations exist for this parent yet.'
            : 'No variations have been added yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
            <span>{selectedVariationCount} selected</span>
            <button
              onClick={onSelectAllOnPage}
              className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
            >
              Select page
            </button>
            <button
              onClick={onClearSelection}
              className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              onClick={() => void onGenerateAltForSelected()}
              disabled={variationAltBusy || selectedVariationCount === 0}
              className="px-2 py-1 border border-gray-300 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {variationAltBusy ? 'Generating ALT…' : 'Generate ALT'}
            </button>
            <button
              onClick={() => void onDeleteSelectedVariations()}
              disabled={deletingSelectedVariations || selectedVariationCount === 0}
              className="px-2 py-1 border border-red-300 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {deletingSelectedVariations ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>

          {showPagination && paginationControls}

          <div className={variationLayout === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2' : 'space-y-2'}>
            {pagedVariations.map((child) => {
              const thumbAspectRatio = getThumbAspectRatio(child);
              const displayName = child.displayName?.trim() || child.filename || child.id;
              const cloudName = child.filename || child.id;
              const fileSize = typeof child.fileSizeBytes === 'number' ? child.fileSizeBytes : child.size;
              const videoAsset = isVideoAsset(child);
              const thumbUrl = getAssetPreviewUrl(child, { imageVariant: 'w=300' });
              const hoverUrl = getAssetPreviewUrl(child, { imageVariant: 'w=600' }) || thumbUrl;
              const copyUrl = getAssetCopyUrl(child, { imageVariant: 'original' });
              return (
              <div
                key={child.id}
                className={`${variationLayout === 'grid' ? 'flex flex-col gap-2 p-2' : 'flex items-center gap-4 p-3'} border border-gray-200 rounded-lg relative ${dragOverVariationId === child.id ? 'bg-blue-50 border-blue-200' : ''}`}
                onMouseLeave={onHandleThumbLeave}
                draggable={!isChildImage && !videoAsset}
                onDragStart={(event) => {
                  if (isChildImage || videoAsset) return;
                  setDraggingVariationId(child.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', child.id);
                }}
                onDragEnd={() => {
                  setDraggingVariationId(null);
                  setDragOverVariationId(null);
                }}
                onDragOver={(event) => {
                  if (isChildImage || videoAsset) return;
                  event.preventDefault();
                  setDragOverVariationId(child.id);
                }}
                onDrop={async (event) => {
                  if (isChildImage || videoAsset) return;
                  event.preventDefault();
                  await onDropVariation(child.id);
                  setDraggingVariationId(null);
                  setDragOverVariationId(null);
                }}
              >
                {(() => {
                  if (isChildImage || videoAsset) {
                    return null;
                  }
                  const orderIndex = variationOrderIndex.get(child.id) ?? -1;
                  const canMoveUp = orderIndex > 0;
                  const canMoveDown = orderIndex >= 0 && orderIndex < displayedVariations.length - 1;
                  return (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void onMoveVariation(child.id, -1)}
                        disabled={variationOrderSaving || !canMoveUp}
                        className="p-1 border rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                        title="Move up"
                        aria-label="Move variation up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => void onMoveVariation(child.id, 1)}
                        disabled={variationOrderSaving || !canMoveDown}
                        className="p-1 border rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                        title="Move down"
                        aria-label="Move variation down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <div className="ml-1 flex items-center justify-center text-gray-400">
                        <GripVertical className="h-3 w-3" />
                      </div>
                    </div>
                  );
                })()}

                <label className="flex items-center gap-2 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={selectedVariationIds.has(child.id)}
                    onChange={() => toggleVariationSelection(child.id)}
                    className="h-3 w-3 text-blue-600 border-gray-300 rounded"
                  />
                  select
                </label>

                <Link
                  href={getAssetDetailPath(child)}
                  prefetch={false}
                  className={`${variationLayout === 'grid' ? 'w-full' : 'w-32 shrink-0'} relative rounded overflow-hidden bg-gray-100 block`}
                  style={{ aspectRatio: String(thumbAspectRatio) }}
                  onMouseMove={(e) => {
                    if (!hoverUrl) return;
                    onHandleThumbMouseMove(
                      hoverUrl,
                      child.filename || (videoAsset ? 'Video variation' : 'Variation'),
                      e
                    );
                  }}
                >
                  {thumbUrl ? (
                    <Image
                      draggable
                      onDragStart={(e) => onHandleImageDragStart(e, child)}
                      src={thumbUrl}
                      alt={child.filename || (videoAsset ? 'Video variation' : 'Variation')}
                      fill
                      className={variationTrueAspect ? 'object-contain' : 'object-cover'}
                      sizes={variationLayout === 'grid' ? '320px' : '64px'}
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-gray-500">
                      No preview
                    </div>
                  )}
                </Link>

                <div className={`${variationLayout === 'grid' ? 'w-full space-y-1' : 'flex-1 min-w-0 space-y-1'}`}>
                  <p className="text-xs font-mono font-medum text-gray-900 truncate">{displayName}</p>
                  {cloudName !== displayName && (
                    <p className="text-[11px] text-gray-500 truncate">File: {cloudName}</p>
                  )}
                  <p className="text-xs text-gray-500">Uploaded {new Date(child.uploaded).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-500">Size {formatBytes(fileSize)}</p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className="font-mono truncate" title={child.id}>ID {child.id}</span>
                    <button
                      onClick={() => void onCopyVariationId(child.id)}
                      className="text-[10px] text-blue-600 hover:text-blue-700 underline"
                      title="Copy asset ID"
                    >
                      Copy
                    </button>
                  </div>
                  <AspectRatioDisplay imageId={child.id} aspectRatio={child.aspectRatio} />
                  <div className="text-[11px] text-gray-500 break-words">ALT: {child.altTag || '—'}</div>
                  {!videoAsset && (
                    <button
                      onClick={() => onOpenVariantSizes(child)}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 underline"
                    >
                      View sizes
                    </button>
                  )}
                </div>

                <div className={`${variationLayout === 'grid' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2 items-end'}`}>
                  <button
                    onClick={async (event) =>
                      await onHandleCopyUrl(
                        event,
                        copyUrl,
                        videoAsset ? 'Video variation' : 'Variation',
                        child.altTag
                      )
                    }
                    disabled={!copyUrl}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Copy URL
                  </button>
                  {!isChildImage && !videoAsset && (
                    <button
                      onClick={() => void onSwapParent(child.id)}
                      disabled={Boolean(swappingParentId)}
                      className="px-3 py-1 text-xs bg-amber-100 text-amber-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Make this variation the parent image"
                    >
                      {swappingParentId === child.id
                        ? `Swapping ${swapParentAssetCount} assets…`
                        : 'Make parent'}
                    </button>
                  )}
                  {!isChildImage && (
                    <button
                      onClick={() => void onDetachChild(child.id)}
                      disabled={childDetachingId === child.id || detachingAllChildren}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {childDetachingId === child.id ? 'Detaching…' : 'Detach'}
                    </button>
                  )}
                  <button
                    onClick={() => void onDeleteChild(child.id)}
                    className="px-3 py-1 text-[11px] border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          {showPagination && paginationControls}
        </div>
      )}
    </div>
  );
}
