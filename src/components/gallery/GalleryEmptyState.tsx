/**
 * GalleryEmptyState Component
 * 
 * Displayed when the gallery has no images to show.
 */

'use client';

import React from 'react';

interface GalleryEmptyStateProps {
  hasFilters: boolean;
  onClearFilters?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const GalleryEmptyState: React.FC<GalleryEmptyStateProps> = ({
  hasFilters,
  onClearFilters,
  isLoading = false,
  error = null,
}) => {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <div className="animate-spin text-4xl mb-4">⟳</div>
        <div className="text-[0.8em] font-mono">Loading images...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <div className="text-[0.8em] font-mono text-red-600 mb-2">Error loading images</div>
        <div className="text-[0.7em] font-mono text-gray-500 max-w-md text-center">
          {error}
        </div>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <div className="text-4xl mb-4">🔍</div>
        <div className="text-[0.8em] font-mono mb-2">No images match your filters</div>
        <div className="text-[0.7em] font-mono text-gray-400 mb-4">
          Try adjusting your search criteria or clearing filters
        </div>
        {onClearFilters && (
          <button
            onClick={onClearFilters}
            className="px-4 py-2 text-[0.7em] font-mono bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
          >
            Clear All Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <div className="text-4xl mb-4">📷</div>
      <div className="text-[0.8em] font-mono mb-2">No images in gallery</div>
      <div className="text-[0.7em] font-mono text-gray-400">
        Upload some images to get started
      </div>
    </div>
  );
};
