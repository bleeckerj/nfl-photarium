import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import MonoSelect from '@/components/MonoSelect';
import type { AdoptVariationScope } from '@/components/image-detail/adoptVariationSearch';
import { getAssetDetailPath, getAssetPreviewUrl, isVideoAsset } from '@/utils/assetUrls';
import type { VariantAssignmentCandidate } from '@/utils/variantAssignmentCandidates';

export interface ImageCandidateLike {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  folder?: string;
  description?: string;
  altTag?: string;
  altText?: string;
  uploaded: string;
  namespace?: string;
  parentId?: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  variants?: string[];
}

export type ImageAssignmentCandidateLike = VariantAssignmentCandidate<ImageCandidateLike>;

export interface SelectOption {
  value: string;
  label: string;
}

export interface AdoptVariationSectionProps {
  adoptSearch: string;
  setAdoptSearch: (value: string) => void;

  adoptFolderFilter: string;
  setAdoptFolderFilter: (value: string) => void;
  adoptFolderOptions: SelectOption[];
  adoptScope: AdoptVariationScope;
  setAdoptScope: (value: AdoptVariationScope) => void;
  adoptScopeOptions: SelectOption[];
  adoptAssetTypeFilter: '' | 'image' | 'video';
  setAdoptAssetTypeFilter: (value: '' | 'image' | 'video') => void;
  adoptAssetTypeOptions: SelectOption[];

  filteredAssignmentCandidates: ImageAssignmentCandidateLike[];
  pagedAssignmentCandidates: ImageAssignmentCandidateLike[];

  adoptPage: number;
  setAdoptPage: React.Dispatch<React.SetStateAction<number>>;
  totalAdoptPages: number;
  adoptPageSize: number;
  adoptPageStart: number;
  adoptPageEnd: number;
  assignmentCandidatesLoading?: boolean;
  /**
   * When set, the empty state offers a "Browse all assets" button that loads
   * the full candidate pool on demand (it is no longer prefetched).
   */
  onLoadAllCandidates?: () => void;

  onHandleThumbMouseMove: (url: string, label: string, evt: React.MouseEvent) => void;
  onHandleThumbLeave: () => void;
  onHandleImageDragStart: (evt: React.DragEvent, image: ImageCandidateLike) => void;

  onAssignExistingAsChild: (candidateId: string) => void | Promise<void>;
  onAssignExistingAsChildren: (candidateIds: string[]) => void | Promise<void>;
  assigningId: string | null;
  assigningBulk: boolean;
}

const getCandidateLabel = (candidate: ImageCandidateLike) =>
  (candidate.displayName || '').trim() || candidate.filename || candidate.id;

const getUnavailableMessage = (candidate: ImageAssignmentCandidateLike, parentLabel: string) => {
  if (candidate.unavailableReason === 'has-variants') {
    return 'Already a parent with variants';
  }
  return `Already a variant of ${parentLabel}`;
};

export function AdoptVariationSection(props: AdoptVariationSectionProps) {
  const {
    adoptSearch,
    setAdoptSearch,
    adoptFolderFilter,
    setAdoptFolderFilter,
    adoptFolderOptions,
    adoptScope,
    setAdoptScope,
    adoptScopeOptions,
    adoptAssetTypeFilter,
    setAdoptAssetTypeFilter,
    adoptAssetTypeOptions,
    filteredAssignmentCandidates,
    pagedAssignmentCandidates,
    adoptPage,
    setAdoptPage,
    totalAdoptPages,
    adoptPageSize,
    adoptPageStart,
    adoptPageEnd,
    assignmentCandidatesLoading = false,
    onLoadAllCandidates,
    onHandleThumbMouseMove,
    onHandleThumbLeave,
    onHandleImageDragStart,
    onAssignExistingAsChild,
    onAssignExistingAsChildren,
    assigningId,
    assigningBulk,
  } = props;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const availableCandidates = useMemo(
    () => filteredAssignmentCandidates.filter((candidate) => candidate.availability === 'available'),
    [filteredAssignmentCandidates]
  );
  const availableIds = useMemo(
    () => new Set(availableCandidates.map((candidate) => candidate.asset.id)),
    [availableCandidates]
  );
  const selectedAvailableIds = selectedIds.filter((id) => availableIds.has(id));
  const selectedCount = selectedAvailableIds.length;
  const availableCount = availableCandidates.length;
  const isBusy = assigningBulk || Boolean(assigningId);
  const hasMultiplePages = filteredAssignmentCandidates.length > adoptPageSize;

  const toggleSelection = (candidateId: string) => {
    if (!availableIds.has(candidateId)) return;
    setSelectedIds((prev) => {
      if (prev.includes(candidateId)) {
        return prev.filter((id) => id !== candidateId);
      }
      return [...prev, candidateId];
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const selectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pagedAssignmentCandidates.forEach((candidate) => {
        if (candidate.availability === 'available') {
          next.add(candidate.asset.id);
        }
      });
      return Array.from(next);
    });
  };

  const assignSelected = async () => {
    if (selectedAvailableIds.length === 0) return;
    await onAssignExistingAsChildren(selectedAvailableIds);
    clearSelection();
  };

  const pageControls = hasMultiplePages ? (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
      <span className="font-mono">Page {adoptPage} of {totalAdoptPages}</span>
      <span className="font-mono">
        Showing {adoptPageStart}-{adoptPageEnd} of {filteredAssignmentCandidates.length} matches
      </span>
      <button
        type="button"
        onClick={() => setAdoptPage((p) => Math.max(1, p - 1))}
        disabled={adoptPage === 1}
        className="px-2 py-1 border rounded disabled:opacity-50 bg-white hover:bg-gray-100"
      >
        Prev
      </button>
      <button
        type="button"
        onClick={() => setAdoptPage((p) => Math.min(totalAdoptPages, p + 1))}
        disabled={adoptPage === totalAdoptPages}
        className="px-2 py-1 border rounded disabled:opacity-50 bg-white hover:bg-gray-100"
      >
        Next
      </button>
    </div>
  ) : null;

  return (
    <div id="adopt-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-gray-50">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="adopt-search" className="text-xs font-medium text-gray-700">
          Assign existing assets as variations
        </label>
        <input
          id="adopt-search"
          type="text"
          value={adoptSearch}
          onChange={(e) => setAdoptSearch(e.target.value)}
          placeholder="Search by ID, display name, filename, folder, tag, description, alt text, or parent"
          className="w-full sm:w-64 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <label htmlFor="adopt-folder" className="text-xs font-medium text-gray-700">
          Filter by folder
        </label>
        <MonoSelect
          id="adopt-folder"
          value={adoptFolderFilter}
          onChange={setAdoptFolderFilter}
          options={adoptFolderOptions}
          className="w-full sm:w-48"
          placeholder="All folders"
        />
        <label htmlFor="adopt-scope" className="text-xs font-medium text-gray-700 sm:ml-2">
          Scope
        </label>
        <MonoSelect
          id="adopt-scope"
          value={adoptScope}
          onChange={(value) => setAdoptScope((value || 'current') as AdoptVariationScope)}
          options={adoptScopeOptions}
          className="w-full sm:w-56"
          placeholder="Current namespace"
        />
        <label htmlFor="adopt-type" className="text-xs font-medium text-gray-700 sm:ml-2">
          Type
        </label>
        <MonoSelect
          id="adopt-type"
          value={adoptAssetTypeFilter}
          onChange={(value) => setAdoptAssetTypeFilter((value || '') as '' | 'image' | 'video')}
          options={adoptAssetTypeOptions}
          className="w-full sm:w-40"
          placeholder="All types"
        />
        <div className="sm:ml-auto flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="font-mono">selected={selectedCount}</span>
          <span className="font-mono">available={availableCount}</span>
          <button
            type="button"
            onClick={selectAllOnPage}
            disabled={isBusy || pagedAssignmentCandidates.every((candidate) => candidate.availability !== 'available')}
            className="px-2 py-1 border rounded disabled:opacity-50 bg-white hover:bg-gray-100"
            title="Select all available candidates visible on this page"
          >
            Select page
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selectedCount === 0}
            className="px-2 py-1 border rounded disabled:opacity-50 bg-white hover:bg-gray-100"
            title="Clear selected candidates"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void assignSelected()}
            disabled={selectedCount === 0 || isBusy}
            className="px-2 py-1 border rounded disabled:opacity-50 bg-green-600 text-white hover:bg-green-700"
            title="Assign all selected available assets as variations"
          >
            {assigningBulk ? 'Assigning...' : `Assign selected (${selectedCount})`}
          </button>
        </div>
      </div>

      {(assignmentCandidatesLoading || pageControls) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {assignmentCandidatesLoading ? (
            <p className="text-xs text-gray-500">Loading full assignment candidate set...</p>
          ) : (
            <span />
          )}
          {pageControls}
        </div>
      )}

      {filteredAssignmentCandidates.length === 0 && !assignmentCandidatesLoading ? (
        onLoadAllCandidates ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-gray-500">
              Search or filter above to find assets, or load the full list.
            </p>
            <button
              type="button"
              onClick={onLoadAllCandidates}
              className="px-3 py-1 text-xs border rounded-md bg-white hover:bg-gray-100 text-gray-700"
            >
              Browse all assets
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No assignment candidates found.</p>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {pagedAssignmentCandidates.map((candidateRow) => {
            const candidate = candidateRow.asset;
            const primaryLabel = getCandidateLabel(candidate);
            const showFilename = candidate.filename && candidate.filename !== primaryLabel;
            const isSelected = selectedSet.has(candidate.id) && availableIds.has(candidate.id);
            const thumbUrl = getAssetPreviewUrl(candidate, { imageVariant: 'w=300' });
            const hoverUrl = getAssetPreviewUrl(candidate, { imageVariant: 'w=600' }) || thumbUrl;
            const isVideo = isVideoAsset(candidate);
            const isUnavailable = candidateRow.availability === 'unavailable';
            const parentLabel = candidateRow.parentAsset
              ? getCandidateLabel(candidateRow.parentAsset)
              : candidate.parentId || 'another parent';
            const unavailableMessage = getUnavailableMessage(candidateRow, parentLabel);
            const isAssigningThisRow =
              assigningId === candidate.id || (assigningBulk && selectedSet.has(candidate.id));

            return (
              <div
                key={candidate.id}
                className={`flex items-center gap-3 p-2 border rounded-md ${
                  isUnavailable ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white'
                }`}
                onMouseLeave={onHandleThumbLeave}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelection(candidate.id)}
                  disabled={isBusy || isUnavailable}
                  className="h-4 w-4"
                  title={isUnavailable ? unavailableMessage : isSelected ? 'Deselect' : 'Select for bulk assign'}
                />
                <Link
                  href={getAssetDetailPath(candidate)}
                  prefetch={false}
                  className="w-14 h-14 relative rounded overflow-hidden bg-gray-100 block shrink-0"
                  onMouseMove={(e) => {
                    if (!hoverUrl) return;
                    onHandleThumbMouseMove(
                      hoverUrl,
                      primaryLabel || (isVideo ? 'Video' : 'Image'),
                      e
                    );
                  }}
                >
                  {thumbUrl ? (
                    <Image
                      draggable={!isUnavailable}
                      onDragStart={(e) => {
                        if (isUnavailable) {
                          e.preventDefault();
                          return;
                        }
                        onHandleImageDragStart(e, candidate);
                      }}
                      src={thumbUrl}
                      alt={primaryLabel || (isVideo ? 'Video' : 'Image')}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-gray-500">
                      No preview
                    </div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-mono font-medium truncate ${isUnavailable ? 'text-gray-600' : 'text-gray-900'}`} title={primaryLabel}>
                    {primaryLabel}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{candidate.id}</p>
                  {isUnavailable && (
                    <p className="text-[11px] text-amber-700 truncate">
                      {unavailableMessage}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-500 truncate">
                    <span className={`inline-block rounded px-1.5 py-0.5 mr-1 font-mono ${isVideo ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isVideo ? 'video' : 'image'}
                    </span>
                    <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 mr-1 font-mono text-gray-700">
                      {candidate.namespace?.trim() || '[no namespace]'}
                    </span>
                    {candidate.folder || '[no folder]'}
                    {showFilename ? ` - ${candidate.filename}` : ''}
                  </p>
                  {isUnavailable && (
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                      {candidateRow.parentAsset && (
                        <Link
                          href={getAssetDetailPath(candidateRow.parentAsset)}
                          prefetch={false}
                          className="text-blue-700 underline decoration-dotted hover:text-blue-900"
                        >
                          View parent
                        </Link>
                      )}
                      <Link
                        href={getAssetDetailPath(candidate)}
                        prefetch={false}
                        className="text-blue-700 underline decoration-dotted hover:text-blue-900"
                      >
                        View asset
                      </Link>
                    </div>
                  )}
                </div>
                {isUnavailable ? (
                  <span className="px-3 py-1 text-xs border rounded-md text-gray-500 bg-white whitespace-nowrap">
                    Unavailable
                  </span>
                ) : (
                  <button
                    onClick={() => void onAssignExistingAsChild(candidate.id)}
                    disabled={isBusy || isAssigningThisRow}
                    className="px-3 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Assign this one asset as a variation"
                  >
                    {isAssigningThisRow ? 'Assigning...' : 'Assign'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMultiplePages && (
        <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
          <div>
            Page {adoptPage} of {totalAdoptPages} · Showing {adoptPageStart}-{adoptPageEnd} of {filteredAssignmentCandidates.length} matches
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAdoptPage((p) => Math.max(1, p - 1))}
              disabled={adoptPage === 1}
              className="px-2 py-1 border rounded disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setAdoptPage((p) => Math.min(totalAdoptPages, p + 1))}
              disabled={adoptPage === totalAdoptPages}
              className="px-2 py-1 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
