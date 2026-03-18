import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import MonoSelect from '@/components/MonoSelect';
import { getAssetDetailPath, getAssetPreviewUrl, isVideoAsset } from '@/utils/assetUrls';

export interface ImageCandidateLike {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  folder?: string;
  uploaded: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  variants?: string[];
}

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
  adoptAssetTypeFilter: '' | 'image' | 'video';
  setAdoptAssetTypeFilter: (value: '' | 'image' | 'video') => void;
  adoptAssetTypeOptions: SelectOption[];

  filteredAdoptableImages: ImageCandidateLike[];
  pagedAdoptableImages: ImageCandidateLike[];

  adoptPage: number;
  setAdoptPage: React.Dispatch<React.SetStateAction<number>>;
  totalAdoptPages: number;
  adoptPageSize: number;

  onHandleThumbMouseMove: (url: string, label: string, evt: React.MouseEvent) => void;
  onHandleThumbLeave: () => void;
  onHandleImageDragStart: (evt: React.DragEvent, image: ImageCandidateLike) => void;

  onAssignExistingAsChild: (candidateId: string) => void | Promise<void>;
  onAssignExistingAsChildren: (candidateIds: string[]) => void | Promise<void>;
  assigningId: string | null;
  assigningBulk: boolean;
}

export function AdoptVariationSection(props: AdoptVariationSectionProps) {
  const {
    adoptSearch,
    setAdoptSearch,
    adoptFolderFilter,
    setAdoptFolderFilter,
    adoptFolderOptions,
    adoptAssetTypeFilter,
    setAdoptAssetTypeFilter,
    adoptAssetTypeOptions,
    filteredAdoptableImages,
    pagedAdoptableImages,
    adoptPage,
    setAdoptPage,
    totalAdoptPages,
    adoptPageSize,
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
  const selectedCount = selectedIds.length;

  const isBusy = assigningBulk || Boolean(assigningId);

  const toggleSelection = (candidateId: string) => {
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
      pagedAdoptableImages.forEach((candidate) => next.add(candidate.id));
      return Array.from(next);
    });
  };

  const assignSelected = async () => {
    if (selectedIds.length === 0) return;
    await onAssignExistingAsChildren(selectedIds);
    clearSelection();
  };

  return (
    <div id="adopt-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-gray-50">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="adopt-search" className="text-xs font-medium text-gray-700">
          Adopt existing asset as a variation
        </label>
        <input
          id="adopt-search"
          type="text"
          value={adoptSearch}
          onChange={(e) => setAdoptSearch(e.target.value)}
          placeholder="Search by ID, display name, filename, folder, or tag"
          className="w-full sm:w-64 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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
        <div className="sm:ml-auto flex items-center gap-2 text-xs text-gray-600">
          <span className="font-mono">selected={selectedCount}</span>
          <button
            type="button"
            onClick={selectAllOnPage}
            disabled={pagedAdoptableImages.length === 0}
            className="px-2 py-1 border rounded disabled:opacity-50 bg-white hover:bg-gray-100"
            title="Select all candidates visible on this page"
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
            title="Assign all selected assets as variations"
          >
            {assigningBulk ? 'Assigning…' : `Assign selected (${selectedCount})`}
          </button>
        </div>
      </div>

      {filteredAdoptableImages.length === 0 ? (
        <p className="text-xs text-gray-500">No canonical assets found. Upload a base image first.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {pagedAdoptableImages.map((candidate) => {
            const primaryLabel = (candidate.displayName || '').trim() || candidate.filename || candidate.id;
            const showFilename = candidate.filename && candidate.filename !== primaryLabel;
            const isSelected = selectedSet.has(candidate.id);
            const thumbUrl = getAssetPreviewUrl(candidate, { imageVariant: 'w=300' });
            const hoverUrl = getAssetPreviewUrl(candidate, { imageVariant: 'w=600' }) || thumbUrl;
            const isVideo = isVideoAsset(candidate);
            const isAssigningThisRow =
              assigningId === candidate.id || (assigningBulk && selectedSet.has(candidate.id));

            return (
              <div
                key={candidate.id}
                className="flex items-center gap-3 p-2 border rounded-md bg-white"
                onMouseLeave={onHandleThumbLeave}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelection(candidate.id)}
                  disabled={isBusy}
                  className="h-4 w-4"
                  title={isSelected ? 'Deselect' : 'Select for bulk assign'}
                />
                <Link
                  href={getAssetDetailPath(candidate)}
                  prefetch={false}
                  className="w-14 h-14 relative rounded overflow-hidden bg-gray-100 block"
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
                      draggable
                      onDragStart={(e) => onHandleImageDragStart(e, candidate)}
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
                  <p className="text-xs font-mono font-medium text-gray-900 truncate" title={primaryLabel}>
                    {primaryLabel}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{candidate.id}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    <span className={`inline-block rounded px-1.5 py-0.5 mr-1 font-mono ${isVideo ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isVideo ? 'video' : 'image'}
                    </span>
                    {candidate.folder || '[no folder]'}
                    {showFilename ? ` • ${candidate.filename}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => void onAssignExistingAsChild(candidate.id)}
                  disabled={isBusy || isAssigningThisRow}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Assign this one image as a variation"
                >
                  {isAssigningThisRow ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {filteredAdoptableImages.length > adoptPageSize && (
        <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
          <div>Page {adoptPage} of {totalAdoptPages}</div>
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
