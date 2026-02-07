import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';

import MonoSelect from '@/components/MonoSelect';

export interface ImageLike {
  id: string;
  filename: string;
  uploaded: string;
  folder?: string;
  altTag?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface VariationsSectionProps {
  isChildImage: boolean;
  variationCount: number;

  listVariant: string;
  setListVariant: (value: string) => void;
  listVariantOptions: SelectOption[];
  onCopyList: () => void | Promise<void>;

  variationCandidatesLength: number;
  variationOrderSaving: boolean;
  onResetVariationOrder: () => void | Promise<void>;
  onReverseVariationOrder: () => void | Promise<void>;
  onSortVariationOrder: () => void | Promise<void>;

  onDeleteParent: () => void | Promise<void>;
  onDeleteFamily: () => void | Promise<void>;

  selectedVariationCount: number;
  onSelectAllOnPage: () => void;
  onClearSelection: () => void;
  onGenerateAltForSelected: () => void | Promise<void>;
  variationAltBusy: boolean;
  onDeleteSelectedVariations: () => void | Promise<void>;
  deletingSelectedVariations: boolean;

  pagedVariations: ImageLike[];
  displayedVariations: ImageLike[];
  variationOrderIndex: Map<string, number>;

  selectedVariationIds: Set<string>;
  toggleVariationSelection: (variationId: string) => void;

  dragOverVariationId: string | null;
  setDraggingVariationId: (value: string | null) => void;
  setDragOverVariationId: (value: string | null) => void;
  onDropVariation: (targetId: string) => Promise<void>;
  onMoveVariation: (childId: string, direction: -1 | 1) => void | Promise<void>;

  getCloudflareImageUrl: (imageId: string, variant: string) => string;
  onHandleThumbMouseMove: (url: string, label: string, evt: React.MouseEvent) => void;
  onHandleThumbLeave: () => void;
  onHandleImageDragStart: (evt: React.DragEvent, image: ImageLike) => void;
  onHandleCopyUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string,
    successMessage?: string
  ) => Promise<void>;

  onOpenVariantSizes: (target: ImageLike) => void;

  childDetachingId: string | null;
  onDetachChild: (childId: string) => void | Promise<void>;
  onDeleteChild: (childId: string) => void | Promise<void>;
  swappingParentId: string | null;
  onSwapParent: (childId: string) => void | Promise<void>;

  AspectRatioDisplay: React.ComponentType<{ imageId: string; className?: string }>;

  variationPage: number;
  setVariationPage: React.Dispatch<React.SetStateAction<number>>;
  totalVariationPages: number;
  variationPageSize: number;
}

export function VariationsSection(props: VariationsSectionProps) {
  const {
    isChildImage,
    variationCount,
    listVariant,
    setListVariant,
    listVariantOptions,
    onCopyList,
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
    getCloudflareImageUrl,
    onHandleThumbMouseMove,
    onHandleThumbLeave,
    onHandleImageDragStart,
    onHandleCopyUrl,
    onOpenVariantSizes,
    childDetachingId,
    onDetachChild,
    onDeleteChild,
    swappingParentId,
    onSwapParent,
    AspectRatioDisplay,
    variationPage,
    setVariationPage,
    totalVariationPages,
    variationPageSize
  } = props;

  return (
    <div id="variations-section" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono font-medum text-gray-700">
          {isChildImage ? 'Other vars from this parent' : 'Vars'}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500">
            {variationCount}{' '}
            {isChildImage ? 'other var' : 'var'}
            {variationCount !== 1 ? 's' : ''}
          </p>
          {!isChildImage && (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="copy-list-variant" className="text-[11px] text-gray-500">
                  List size
                </label>
                <MonoSelect
                  id="copy-list-variant"
                  value={listVariant}
                  onChange={setListVariant}
                  options={listVariantOptions}
                  className="w-32 text-[11px]"
                />
              </div>
              <button
                onClick={() => void onCopyList()}
                className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-blue-600 hover:bg-blue-50"
              >
                Copy list
              </button>
              <button
                onClick={() => void onResetVariationOrder()}
                disabled={variationOrderSaving || !variationCandidatesLength}
                className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Reset order
              </button>
              <button
                onClick={() => void onReverseVariationOrder()}
                disabled={variationOrderSaving || !variationCandidatesLength}
                className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Reverse order
              </button>
              <button
                onClick={() => void onSortVariationOrder()}
                disabled={variationOrderSaving || !variationCandidatesLength}
                className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Sort A→Z
              </button>
              <button
                onClick={() => void onDeleteParent()}
                className="px-2 py-1 text-[11px] border border-red-300 rounded-md text-red-600 hover:bg-red-50"
              >
                Delete image
              </button>
              <button
                onClick={() => void onDeleteFamily()}
                className="px-2 py-1 text-[11px] border border-red-500 rounded-md text-red-700 bg-red-50 hover:bg-red-100"
                title="Delete this image and all variations"
              >
                Delete family
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

          {pagedVariations.map((child) => (
            <div
              key={child.id}
              className={`flex items-center gap-4 border border-gray-200 rounded-lg p-3 relative ${dragOverVariationId === child.id ? 'bg-blue-50 border-blue-200' : ''}`}
              onMouseLeave={onHandleThumbLeave}
              draggable={!isChildImage}
              onDragStart={(event) => {
                if (isChildImage) return;
                setDraggingVariationId(child.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', child.id);
              }}
              onDragEnd={() => {
                setDraggingVariationId(null);
                setDragOverVariationId(null);
              }}
              onDragOver={(event) => {
                if (isChildImage) return;
                event.preventDefault();
                setDragOverVariationId(child.id);
              }}
              onDrop={async (event) => {
                if (isChildImage) return;
                event.preventDefault();
                await onDropVariation(child.id);
                setDraggingVariationId(null);
                setDragOverVariationId(null);
              }}
            >
              {(() => {
                if (isChildImage) {
                  return null;
                }
                const orderIndex = variationOrderIndex.get(child.id) ?? -1;
                const canMoveUp = orderIndex > 0;
                const canMoveDown = orderIndex >= 0 && orderIndex < displayedVariations.length - 1;
                return (
                  <div className="flex flex-col gap-1">
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
                    <div className="mt-1 flex items-center justify-center text-gray-400">
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
                href={`/images/${child.id}`}
                className="w-32 h-24 relative rounded overflow-hidden bg-gray-100 block"
                onMouseMove={(e) =>
                  onHandleThumbMouseMove(
                    getCloudflareImageUrl(child.id, 'w=600'),
                    child.filename || 'Variation',
                    e
                  )
                }
              >
                <Image
                  draggable
                  onDragStart={(e) => onHandleImageDragStart(e, child)}
                  src={getCloudflareImageUrl(child.id, 'w=300')}
                  alt={child.filename || 'Variation'}
                  fill
                  className="object-cover"
                  sizes="64px"
                  unoptimized
                />
              </Link>

              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-mono font-medum text-gray-900 truncate">{child.filename}</p>
                <p className="text-xs text-gray-500">Uploaded {new Date(child.uploaded).toLocaleDateString()}</p>
                <AspectRatioDisplay imageId={child.id} />
                <div className="text-[11px] text-gray-500 break-words">ALT: {child.altTag || '—'}</div>
                <button
                  onClick={() => onOpenVariantSizes(child)}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 underline"
                >
                  View sizes
                </button>
              </div>

              <div className="flex flex-col gap-2 items-end">
                <button
                  onClick={async (event) =>
                    await onHandleCopyUrl(
                      event,
                      getCloudflareImageUrl(child.id, 'original'),
                      'Variation',
                      child.altTag
                    )
                  }
                  className="text-xs text-blue-600 hover:underline"
                >
                  Copy URL
                </button>
                {!isChildImage && (
                  <button
                    onClick={() => void onSwapParent(child.id)}
                    disabled={Boolean(swappingParentId)}
                    className="px-3 py-1 text-xs bg-amber-100 text-amber-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Make this variation the parent image"
                  >
                    {swappingParentId === child.id ? 'Swapping…' : 'Make parent'}
                  </button>
                )}
                {!isChildImage && (
                  <button
                    onClick={() => void onDetachChild(child.id)}
                    disabled={childDetachingId === child.id}
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
          ))}

          {variationCount > variationPageSize && (
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
          )}
        </div>
      )}
    </div>
  );
}
