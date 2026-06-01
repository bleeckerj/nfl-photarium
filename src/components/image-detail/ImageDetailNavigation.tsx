import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CloudflareImage } from './types';

export const ImageDetailNavigation = ({
  image,
  familyLoaded,
  familyVariantSequenceLength,
  familyVariantIndex,
  prevFamilyVariantId,
  nextFamilyVariantId,
  galleryResultIdsLength,
  galleryResultIndex,
  prevGalleryImageId,
  nextGalleryImageId,
  onBackToGallery,
  onShowInGalleryOrder,
  onShowInNamespace,
  onNavigateAsset,
}: {
  image: CloudflareImage;
  familyLoaded: boolean;
  familyVariantSequenceLength: number;
  familyVariantIndex: number;
  prevFamilyVariantId: string | null;
  nextFamilyVariantId: string | null;
  galleryResultIdsLength: number;
  galleryResultIndex: number;
  prevGalleryImageId: string | null;
  nextGalleryImageId: string | null;
  onBackToGallery: () => void;
  onShowInGalleryOrder: () => void;
  onShowInNamespace: () => void;
  onNavigateAsset: (targetId: string | null) => void;
}) => (
  <div id="detail-navigation" className="flex items-center justify-between gap-3 mb-4">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={onBackToGallery} className="text-xs text-blue-600 underline">
        Back to gallery
      </button>
      <button
        type="button"
        onClick={onShowInGalleryOrder}
        className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-mono text-blue-700 hover:border-blue-300"
      >
        Show in gallery
      </button>
      <button
        type="button"
        onClick={onShowInNamespace}
        disabled={!image.namespace}
        className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-mono text-blue-700 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
        title={image.namespace ? `Show in ${image.namespace}` : 'Image has no namespace'}
      >
        Show in namespace
      </button>
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {Boolean(image.parentId) && familyLoaded && familyVariantSequenceLength > 0 && (
        <div className="flex items-center gap-2">
          {familyVariantIndex >= 0 && (
            <span className="text-[11px] font-mono text-gray-500">
              Variant {familyVariantIndex + 1} / {familyVariantSequenceLength}
            </span>
          )}
          <button
            type="button"
            onClick={() => onNavigateAsset(prevFamilyVariantId)}
            disabled={!prevFamilyVariantId}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-amber-200 text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous variant in this parent family"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev var
          </button>
          <button
            type="button"
            onClick={() => onNavigateAsset(nextFamilyVariantId)}
            disabled={!nextFamilyVariantId}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-amber-200 text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next variant in this parent family"
          >
            Next var
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {galleryResultIdsLength > 0 && (
        <div className="flex items-center gap-2">
          {galleryResultIndex >= 0 && (
            <span className="text-[11px] font-mono text-gray-500">
              {galleryResultIndex + 1} / {galleryResultIdsLength}
            </span>
          )}
          <button
            type="button"
            onClick={() => onNavigateAsset(prevGalleryImageId)}
            disabled={!prevGalleryImageId}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => onNavigateAsset(nextGalleryImageId)}
            disabled={!nextGalleryImageId}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  </div>
);
