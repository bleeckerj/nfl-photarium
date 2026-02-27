/**
 * GalleryGridView Component
 * 
 * Grid view rendering for the gallery.
 */

'use client';

import React from 'react';
import { ImageCard } from './ImageCard';
import { getGridClassName } from './gridSizing';
import type { CloudflareImage, GalleryViewFilters, GridSize } from './types';

interface GalleryGridViewProps {
  gridSize: GridSize;
  filters: GalleryViewFilters;
  onToggleSelection: (imageId: string) => void;
  onBeforeNavigate: (imageId: string) => void;
  onCopyNamespace: (namespace: string) => void;
  onToggleCopyMenu: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onGenerateDisplayName: (imageId: string) => void;
  onMouseEnter: (imageId: string, event: React.MouseEvent) => void;
  onMouseMove: (imageId: string, event: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

export const GalleryGridView: React.FC<GalleryGridViewProps> = ({
  gridSize,
  filters,
  onToggleSelection,
  onBeforeNavigate,
  onCopyNamespace,
  onToggleCopyMenu,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onGenerateDisplayName,
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
    displayNameLoadingMap,
    galleryReturnHrefSuffix,
  } = filters;

  return (
    <div id="gallery-results-grid" className={getGridClassName(gridSize)}>
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
          displayNameLoading={Boolean(displayNameLoadingMap[image.id])}
          onToggleSelection={onToggleSelection}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onGenerateAlt={onGenerateAlt}
          onGenerateDisplayName={onGenerateDisplayName}
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
