/**
 * GalleryGridView Component
 * 
 * Grid view rendering for the gallery.
 */

'use client';

import React from 'react';
import { ImageCard } from './ImageCard';
import type { CloudflareImage, GalleryViewFilters } from './types';

interface GalleryGridViewProps {
  filters: GalleryViewFilters;
  onToggleSelection: (imageId: string) => void;
  onBeforeNavigate: () => void;
  onCopyNamespace: (namespace: string) => void;
  onToggleCopyMenu: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onMouseEnter: (imageId: string, event: React.MouseEvent) => void;
  onMouseMove: (imageId: string, event: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

export const GalleryGridView: React.FC<GalleryGridViewProps> = ({
  filters,
  onToggleSelection,
  onBeforeNavigate,
  onCopyNamespace,
  onToggleCopyMenu,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}) => {
  const {
    images,
    selectedVariant,
    respectAspectRatio,
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
    <div id="gallery-results-grid" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {images.map((image) => (
        <ImageCard
          key={image.id}
          image={image}
          selectedVariant={selectedVariant}
          respectAspectRatio={respectAspectRatio}
          isSelected={selectedImageIds.has(image.id)}
          bulkSelectionMode={bulkSelectionMode}
          isDuplicate={duplicateIds.has(image.id)}
          variationChildren={childrenMap[image.id]}
          colorMetadata={colorMetadataMap[image.id]}
          embeddingPending={embeddingPendingMap[image.id]}
          altLoading={Boolean(altLoadingMap[image.id])}
          onToggleSelection={onToggleSelection}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onGenerateAlt={onGenerateAlt}
          onCopyUrl={onToggleCopyMenu}
          onCopyNamespace={onCopyNamespace}
          onBeforeNavigate={onBeforeNavigate}
          galleryReturnHrefSuffix={galleryReturnHrefSuffix}
          onMouseEnter={onMouseEnter}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
      ))}
    </div>
  );
};
