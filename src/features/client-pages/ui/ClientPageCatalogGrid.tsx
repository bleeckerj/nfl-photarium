'use client';

import { getCloudflareImageUrl } from '@/utils/imageUtils';
import type { CloudflareImage } from '@/components/gallery/types';

export type ClientPagePickerGridDensity = 'small' | 'medium' | 'large';

interface ClientPageCatalogGridProps {
  images: CloudflareImage[];
  selectedImageIds: Set<string>;
  busy: boolean;
  gridDensity: ClientPagePickerGridDensity;
  respectNaturalAspectRatio: boolean;
  onToggleImage: (imageId: string) => void;
}

const resolveThumbnailUrl = (image: CloudflareImage) => {
  if (image.assetType === 'video') {
    return image.videoThumbnailUrl || image.videoPreviewUrl || image.variants[0] || '';
  }
  try {
    return getCloudflareImageUrl(image.id, 'thumbnail');
  } catch {
    return image.variants[0] ?? '';
  }
};

export function ClientPageCatalogGrid({
  images,
  selectedImageIds,
  busy,
  gridDensity,
  respectNaturalAspectRatio,
  onToggleImage,
}: ClientPageCatalogGridProps) {
  if (images.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-500">
        No assets match the current filters.
      </div>
    );
  }

  const gridClassName =
    gridDensity === 'small'
      ? 'grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5'
      : gridDensity === 'large'
        ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3'
        : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

  const previewClassName = respectNaturalAspectRatio
    ? 'overflow-hidden bg-stone-100'
    : 'aspect-[4/3] overflow-hidden bg-stone-100';

  const imageClassName = respectNaturalAspectRatio
    ? 'block h-auto w-full object-contain'
    : 'h-full w-full object-cover';

  const cardPaddingClassName = gridDensity === 'small' ? 'space-y-2 p-2' : 'space-y-2 p-3';
  const titleClassName = gridDensity === 'small' ? 'truncate text-xs font-medium text-stone-900' : 'truncate text-sm font-medium text-stone-900';
  const metaClassName = 'truncate text-[11px] font-mono text-stone-500';
  const tagClassName = gridDensity === 'small' ? 'line-clamp-1 text-[10px] text-stone-500' : 'line-clamp-2 text-[11px] text-stone-500';

  return (
    <div className={gridClassName}>
      {images.map((image) => {
        const isSelected = selectedImageIds.has(image.id);
        return (
          <article
            key={image.id}
            className={`overflow-hidden rounded-md border bg-white ${
              isSelected ? 'border-stone-900 shadow-[0_0_0_1px_rgba(24,24,27,0.2)]' : 'border-stone-200'
            }`}
          >
            <div className={previewClassName}>
              {resolveThumbnailUrl(image) ? (
                <img
                  src={resolveThumbnailUrl(image)}
                  alt={image.displayName ?? image.filename}
                  className={imageClassName}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-mono text-stone-400">
                  No preview
                </div>
              )}
            </div>
            <div className={cardPaddingClassName}>
              <div className="space-y-1">
                <p className={titleClassName}>
                  {image.displayName || image.filename}
                </p>
                <p className={metaClassName}>
                  {[
                    image.assetType === 'video' ? 'video' : 'image',
                    image.namespace || '[none]',
                    image.folder || 'no-folder',
                  ].join(' / ')}
                </p>
                <p className={tagClassName}>
                  {image.tags?.slice(0, 6).join(', ') || 'No tags'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggleImage(image.id)}
                disabled={busy}
                className={`w-full rounded-md border px-3 py-2 text-xs font-mono ${
                  isSelected
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                } disabled:opacity-60`}
              >
                {isSelected ? 'Remove from client page' : 'Add to client page'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
