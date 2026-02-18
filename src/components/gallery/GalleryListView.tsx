/**
 * GalleryListView Component
 * 
 * List view rendering for the gallery.
 */

'use client';

import React from 'react';
import { ImageListItem } from './ImageListItem';
import type { CloudflareImage, ColorMetadata, GalleryViewFilters } from './types';

interface GalleryListViewProps {
  filters: GalleryViewFilters;
  onToggleSelection: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onCopyUrl: (imageId: string) => void;
  onCopyNamespace: (namespace: string) => void;
  onBeforeNavigate: (imageId: string) => void;
  onDragStart: (event: React.DragEvent, image: CloudflareImage) => void;
  onMouseEnter: (imageId: string, event: React.MouseEvent) => void;
  onMouseMove: (imageId: string, event: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

export const GalleryListView: React.FC<GalleryListViewProps> = ({
  filters,
  onToggleSelection,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onCopyUrl,
  onCopyNamespace,
  onBeforeNavigate,
  onDragStart,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}) => {
  const {
    images,
    selectedVariant,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    galleryReturnHrefSuffix,
  } = filters;

  return (
    <div className="space-y-3">
      {images.map((image) => {
        const variationChildren = childrenMap[image.id] || [];
        return (
          <ImageListItem
            key={image.id}
            image={image}
            selectedVariant={selectedVariant}
            isSelected={selectedImageIds.has(image.id)}
            bulkSelectionMode={bulkSelectionMode}
            isDuplicate={duplicateIds.has(image.id)}
            hrefSuffix={galleryReturnHrefSuffix}
            variationChildren={variationChildren}
            colorMetadata={colorMetadataMap[image.id] as ColorMetadata | undefined}
            embeddingPending={embeddingPendingMap[image.id]}
            altLoading={Boolean(altLoadingMap[image.id])}
            onToggleSelection={onToggleSelection}
            onStartEdit={onStartEdit}
            onDelete={onDelete}
            onGenerateAlt={onGenerateAlt}
            onCopyUrl={onCopyUrl}
            onCopyNamespace={onCopyNamespace}
            onBeforeNavigate={onBeforeNavigate}
            onDragStart={onDragStart}
            onMouseEnter={onMouseEnter}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
          />
        );
      })}
    </div>
  );
};
