'use client';

import Image from 'next/image';
import Link from 'next/link';
import { getAssetDetailPath, getAssetPreviewUrl } from '@/utils/assetUrls';
import { setDragPayloadForImage } from '@/utils/imageDrag';
import { getGridClassName } from './gridSizing';
import { isSvgImage } from './utils';
import type { GalleryViewFilters, GridSize } from './types';

interface GalleryImageOnlyViewProps {
  gridSize: GridSize;
  filters: GalleryViewFilters;
  onToggleSelection: (imageId: string) => void;
  onBeforeNavigate: (imageId: string) => void;
}

export function GalleryImageOnlyView({
  gridSize,
  filters,
  onToggleSelection,
  onBeforeNavigate,
}: GalleryImageOnlyViewProps) {
  const { images, selectedVariant, bulkSelectionMode, selectedImageIds, galleryReturnHrefSuffix, focusedGalleryAssetId } = filters;

  return (
    <div id="gallery-results-images" className={getGridClassName(gridSize, true)}>
      {images.map((image) => {
        const isVideo = image.assetType === 'video';
        const previewUrl = getAssetPreviewUrl(image, {
          imageVariant: selectedVariant === 'public' ? 'original' : selectedVariant,
        });
        const label = image.altText || image.altTag || image.displayName || image.filename;
        const selected = selectedImageIds.has(image.id);
        const focused = focusedGalleryAssetId === image.id;
        const className = `relative block aspect-square w-full min-w-0 bg-white focus-visible:outline-2 focus-visible:outline-blue-500 ${
          selected ? 'outline-2 -outline-offset-2 outline-blue-500' : focused ? 'outline-2 -outline-offset-2 outline-amber-400' : ''
        }`;
        const thumbnail = previewUrl ? (
          <Image
            src={previewUrl}
            alt={label}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            unoptimized={isVideo || (isSvgImage(image) && !image.linkedAssetId)}
            draggable={!isVideo}
            onDragStart={isVideo ? undefined : (event) => setDragPayloadForImage(event, image)}
          />
        ) : null;
        // Stable asset markers let detail-return and focus navigation locate
        // the same tile in every gallery view without adding visible labels.
        const tileProps = {
          id: `gallery-asset-${image.id}`,
          'data-gallery-asset-id': image.id,
          className,
          style: focused ? { scrollMarginTop: '6rem' } : undefined,
        };

        return bulkSelectionMode ? (
          <button
            key={image.id}
            {...tileProps}
            type="button"
            aria-label={`Select ${label}`}
            aria-pressed={selected}
            onClick={() => onToggleSelection(image.id)}
          >
            {thumbnail}
          </button>
        ) : (
          <Link
            key={image.id}
            {...tileProps}
            href={`${getAssetDetailPath(image)}${galleryReturnHrefSuffix ?? ''}`}
            aria-label={`Open ${label}`}
            aria-current={focused ? 'true' : undefined}
            prefetch={false}
            onClick={() => onBeforeNavigate(image.id)}
          >
            {thumbnail}
          </Link>
        );
      })}
    </div>
  );
}
