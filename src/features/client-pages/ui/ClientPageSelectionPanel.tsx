'use client';

import { getCloudflareImageUrl } from '@/utils/imageUtils';
import type { CloudflareImage } from '@/components/gallery/types';

interface ClientPageSelectionPanelProps {
  selectedImages: CloudflareImage[];
  busy: boolean;
  onRemove: (imageId: string) => void;
  onMoveUp: (imageId: string) => void;
  onMoveDown: (imageId: string) => void;
}

const resolveImageUrl = (image: CloudflareImage) => {
  if (image.assetType === 'video') {
    return image.videoThumbnailUrl || image.videoPreviewUrl || image.variants[0] || '';
  }
  try {
    return getCloudflareImageUrl(image.id, 'thumbnail');
  } catch {
    return image.variants[0] ?? '';
  }
};

export function ClientPageSelectionPanel({
  selectedImages,
  busy,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ClientPageSelectionPanelProps) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Selected assets</p>
        <p className="mt-1 text-sm text-stone-600">{selectedImages.length} assets in this client page.</p>
      </div>

      {selectedImages.length === 0 ? (
        <p className="py-6 text-sm text-stone-500">No assets selected yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {selectedImages.map((image, index) => (
            <li key={image.id} className="rounded-md border border-stone-200 p-3">
              <div className="flex gap-3">
                <div className="h-16 w-16 flex-none overflow-hidden rounded-md bg-stone-100">
                  {resolveImageUrl(image) ? (
                    <img
                      src={resolveImageUrl(image)}
                      alt={image.displayName ?? image.filename}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-900">
                    {image.displayName || image.filename}
                  </p>
                  <p className="truncate text-[11px] font-mono text-stone-500">
                    Position {index + 1}
                  </p>
                  <p className="truncate text-[11px] font-mono text-stone-500">
                    {image.assetType === 'video' ? 'video' : 'image'}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-stone-500">
                    {image.tags?.slice(0, 5).join(', ') || 'No tags'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onMoveUp(image.id)}
                  disabled={busy || index === 0}
                  className="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => onMoveDown(image.id)}
                  disabled={busy || index === selectedImages.length - 1}
                  className="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                >
                  Move down
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(image.id)}
                  disabled={busy}
                  className="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
