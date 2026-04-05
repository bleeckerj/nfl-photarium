'use client';

import { getCloudflareImageUrl } from '@/utils/imageUtils';
import type { CloudflareImage } from '@/components/gallery/types';

interface ClientPageCatalogGridProps {
  images: CloudflareImage[];
  selectedImageIds: Set<string>;
  busy: boolean;
  onToggleImage: (imageId: string) => void;
}

const resolveThumbnailUrl = (image: CloudflareImage) => {
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
  onToggleImage,
}: ClientPageCatalogGridProps) {
  if (images.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-500">
        No images match the current filters.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {images.map((image) => {
        const isSelected = selectedImageIds.has(image.id);
        return (
          <article
            key={image.id}
            className={`overflow-hidden rounded-md border bg-white ${
              isSelected ? 'border-stone-900 shadow-[0_0_0_1px_rgba(24,24,27,0.2)]' : 'border-stone-200'
            }`}
          >
            <div className="aspect-[4/3] overflow-hidden bg-stone-100">
              {resolveThumbnailUrl(image) ? (
                <img
                  src={resolveThumbnailUrl(image)}
                  alt={image.displayName ?? image.filename}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-mono text-stone-400">
                  No preview
                </div>
              )}
            </div>
            <div className="space-y-2 p-3">
              <div className="space-y-1">
                <p className="truncate text-sm font-medium text-stone-900">
                  {image.displayName || image.filename}
                </p>
                <p className="truncate text-[11px] font-mono text-stone-500">
                  {[image.namespace || '[none]', image.folder || 'no-folder'].join(' / ')}
                </p>
                <p className="line-clamp-2 text-[11px] text-stone-500">
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
