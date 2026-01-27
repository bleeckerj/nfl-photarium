/**
 * Gallery Module Index
 * 
 * Central export for all gallery components, hooks, types, and utilities.
 * Import from '@/components/gallery' for clean, modular access.
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Storage utilities
export * from './storage';

// Utility functions
export * from './utils';

// Hooks
export * from './hooks';

// Icons
export * from './icons';

// UI Components
export { AspectRatioDisplay } from './AspectRatioDisplay';
export { ImageCard } from './ImageCard';
export { ImageListItem } from './ImageListItem';
export { GalleryToolbar } from './GalleryToolbar';
export { GalleryFilters } from './GalleryFilters';
export { GalleryEmptyState } from './GalleryEmptyState';

// Modals
export * from './modals';

// Main component
export { default as ImageGallery, ImageGallery as ImageGalleryComponent } from './ImageGallery';
export type { ImageGalleryRef } from './types';
