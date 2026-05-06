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
  onSelectColor: (hex: string) => void;
  onToggleCopyMenu: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onGenerateDisplayName: (imageId: string) => void;
  onToggleFavorite: (imageId: string) => void;
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
  onSelectColor,
  onToggleCopyMenu,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onGenerateDisplayName,
  onToggleFavorite,
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
    familySummaryMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    favoriteLoadingMap,
    galleryReturnHrefSuffix,
    focusedGalleryAssetId,
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
          familySummary={familySummaryMap[image.id]}
          colorMetadata={colorMetadataMap[image.id]}
          embeddingPending={embeddingPendingMap[image.id]}
          altLoading={Boolean(altLoadingMap[image.id])}
          displayNameLoading={Boolean(displayNameLoadingMap[image.id])}
          favoriteLoading={Boolean(favoriteLoadingMap[image.id])}
          isFocusedInGallery={focusedGalleryAssetId === image.id}
          onToggleSelection={onToggleSelection}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onGenerateAlt={onGenerateAlt}
          onGenerateDisplayName={onGenerateDisplayName}
          onToggleFavorite={onToggleFavorite}
          onCopyUrl={onToggleCopyMenu}
          onCopyNamespace={onCopyNamespace}
          onSelectColor={onSelectColor}
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
