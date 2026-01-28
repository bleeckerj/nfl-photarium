import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import MonoSelect from '@/components/MonoSelect';

type ParentOption = { value: string; label: string };

type ParentInfoImage = {
  id: string;
  filename?: string;
};

export function ParentInfoSection({
  parentImage,
  parentActionLoading,
  reassignParentId,
  setReassignParentId,
  reassignParentOptions,
  currentParentId,
  onDetach,
  onUpdateParent,
  getCloudflareImageUrl,
  onThumbMouseMove,
  onThumbMouseLeave,
}: {
  parentImage: ParentInfoImage;
  parentActionLoading: boolean;
  reassignParentId: string;
  setReassignParentId: (value: string) => void;
  reassignParentOptions: ParentOption[];
  currentParentId: string;
  onDetach: () => void;
  onUpdateParent: () => void;
  getCloudflareImageUrl: (id: string, variant: string) => string;
  onThumbMouseMove: (url: string, label: string, event: React.MouseEvent) => void;
  onThumbMouseLeave: () => void;
}) {
  return (
    <div id="parent-info-section" className="border border-yellow-200 bg-yellow-50 rounded-lg p-4 space-y-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <p className="text-xs text-yellow-700">This image is stored as a variation.</p>
        </div>

        <Link
          href={`/images/${parentImage.id}`}
          className="flex items-center gap-3 text-left group"
          onMouseMove={(event) =>
            onThumbMouseMove(
              getCloudflareImageUrl(parentImage.id, 'w=800'),
              parentImage.filename || 'Parent image',
              event
            )
          }
          onMouseLeave={onThumbMouseLeave}
          prefetch={false}
        >
          <div className="relative w-40 h-28 sm:w-48 sm:h-32 rounded-xl overflow-hidden border-2 border-yellow-300 bg-white shadow-sm">
            <Image
              src={getCloudflareImageUrl(parentImage.id, 'w=600')}
              alt={parentImage.filename || 'Parent image'}
              fill
              className="object-cover transition-transform duration-200 group-hover:scale-105"
              sizes="192px"
              unoptimized
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-yellow-700">Parent image</p>
            <p className="text-xs font-semibold text-blue-700 underline decoration-dotted group-hover:text-blue-800">
              View parent details →
            </p>
            <p className="text-xs text-gray-600 truncate max-w-[12rem]">{parentImage.filename || parentImage.id}</p>
          </div>
        </Link>

        <button
          onClick={onDetach}
          disabled={parentActionLoading}
          className="px-3 py-1 text-xs border border-yellow-500 text-yellow-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parentActionLoading ? 'Detaching…' : 'Detach'}
        </button>
      </div>

      <div className="space-y-2">
        <label htmlFor="reassign-parent" className="text-xs font-medium text-gray-700">
          Parent
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <MonoSelect
            id="reassign-parent"
            value={reassignParentId}
            onChange={setReassignParentId}
            options={reassignParentOptions}
            className="flex-1"
            placeholder="Select parent"
          />
          <button
            onClick={onUpdateParent}
            disabled={parentActionLoading || reassignParentId === currentParentId}
            className="px-3 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {parentActionLoading ? 'Updating…' : 'Update parent'}
          </button>
        </div>
      </div>
    </div>
  );
}
