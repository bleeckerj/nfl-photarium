import React from 'react';
import Image from 'next/image';
import Link from 'next/link';

import MonoSelect from '@/components/MonoSelect';

export interface ImageCandidateLike {
  id: string;
  filename: string;
  folder?: string;
  uploaded: string;
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

  filteredAdoptableImages: ImageCandidateLike[];
  pagedAdoptableImages: ImageCandidateLike[];

  adoptPage: number;
  setAdoptPage: React.Dispatch<React.SetStateAction<number>>;
  totalAdoptPages: number;
  adoptPageSize: number;

  getCloudflareImageUrl: (imageId: string, variant: string) => string;
  onHandleThumbMouseMove: (url: string, label: string, evt: React.MouseEvent) => void;
  onHandleThumbLeave: () => void;
  onHandleImageDragStart: (evt: React.DragEvent, image: ImageCandidateLike) => void;

  onAssignExistingAsChild: (candidateId: string) => void | Promise<void>;
  assigningId: string | null;
}

export function AdoptVariationSection(props: AdoptVariationSectionProps) {
  const {
    adoptSearch,
    setAdoptSearch,
    adoptFolderFilter,
    setAdoptFolderFilter,
    adoptFolderOptions,
    filteredAdoptableImages,
    pagedAdoptableImages,
    adoptPage,
    setAdoptPage,
    totalAdoptPages,
    adoptPageSize,
    getCloudflareImageUrl,
    onHandleThumbMouseMove,
    onHandleThumbLeave,
    onHandleImageDragStart,
    onAssignExistingAsChild,
    assigningId
  } = props;

  return (
    <div id="adopt-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-gray-50">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="adopt-search" className="text-xs font-medium text-gray-700">
          Adopt existing image as a variation
        </label>
        <input
          id="adopt-search"
          type="text"
          value={adoptSearch}
          onChange={(e) => setAdoptSearch(e.target.value)}
          placeholder="Search by ID, name, folder, or tag"
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
      </div>

      {filteredAdoptableImages.length === 0 ? (
        <p className="text-xs text-gray-500">No canonical images found. Upload a base image first.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {pagedAdoptableImages.map((candidate) => (
            <div
              key={candidate.id}
              className="flex items-center gap-3 p-2 border rounded-md bg-white"
              onMouseLeave={onHandleThumbLeave}
            >
              <Link
                href={`/images/${candidate.id}`}
                className="w-14 h-14 relative rounded overflow-hidden bg-gray-100 block"
                onMouseMove={(e) =>
                  onHandleThumbMouseMove(
                    getCloudflareImageUrl(candidate.id, 'w=600'),
                    candidate.filename || 'Image',
                    e
                  )
                }
              >
                <Image
                  draggable
                  onDragStart={(e) => onHandleImageDragStart(e, candidate)}
                  src={getCloudflareImageUrl(candidate.id, 'w=300')}
                  alt={candidate.filename || 'Image'}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-medum text-gray-900 truncate">{candidate.filename}</p>
                <p className="text-xs text-gray-500 truncate">{candidate.folder || '[no folder]'}</p>
              </div>
              <button
                onClick={() => void onAssignExistingAsChild(candidate.id)}
                disabled={assigningId === candidate.id}
                className="px-3 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {assigningId === candidate.id ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          ))}
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
