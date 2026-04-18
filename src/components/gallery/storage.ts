/**
 * Gallery Storage Utilities
 * 
 * Local storage persistence for gallery preferences and state.
 * Extracts storage logic from the main component for better testability.
 */

import {
  STORAGE_KEYS,
  DEFAULT_PREFERENCES,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_GRID_SIZE,
} from './constants';
import { normalizeGridSize } from './gridSizing';
import { normalizeDateFilterValue } from './dateFilter';
import type { GalleryPreferences, BrokenAudit } from './types';

/**
 * Check if we're running in a browser environment
 */
const isBrowser = () => typeof window !== 'undefined';

/**
 * Load hidden folders from localStorage
 */
export const loadHiddenFolders = (): string[] => {
  if (!isBrowser()) return [];
  
  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEYS.HIDDEN_FOLDERS);
    if (!storedValue) return [];
    
    const parsed = JSON.parse(storedValue);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.warn('Failed to parse hidden folders', error);
  }
  return [];
};

/**
 * Persist hidden folders to localStorage
 */
export const persistHiddenFolders = (folders: string[]): void => {
  if (!isBrowser()) return;
  
  try {
    window.localStorage.setItem(STORAGE_KEYS.HIDDEN_FOLDERS, JSON.stringify(folders));
  } catch (error) {
    console.warn('Failed to save hidden folders', error);
  }
};

/**
 * Load hidden tags from localStorage
 */
export const loadHiddenTags = (): string[] => {
  if (!isBrowser()) return [];
  
  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEYS.HIDDEN_TAGS);
    if (!storedValue) return [];
    
    const parsed = JSON.parse(storedValue);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.warn('Failed to parse hidden tags', error);
  }
  return [];
};

/**
 * Persist hidden tags to localStorage
 */
export const persistHiddenTags = (tags: string[]): void => {
  if (!isBrowser()) return;
  
  try {
    window.localStorage.setItem(STORAGE_KEYS.HIDDEN_TAGS, JSON.stringify(tags));
  } catch (error) {
    console.warn('Failed to save hidden tags', error);
  }
};

/**
 * Load broken audit state from localStorage
 */
export const loadBrokenAudit = (): BrokenAudit => {
  if (!isBrowser()) return { ids: [] };
  
  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEYS.BROKEN_AUDIT);
    if (!storedValue) return { ids: [] };
    
    const parsed = JSON.parse(storedValue) as BrokenAudit;
    if (parsed && Array.isArray(parsed.ids)) {
      return {
        checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
        ids: parsed.ids.filter((item): item is string => typeof item === 'string'),
      };
    }
  } catch (error) {
    console.warn('Failed to parse broken audit state', error);
  }
  return { ids: [] };
};

/**
 * Persist broken audit state to localStorage
 */
export const persistBrokenAudit = (audit: BrokenAudit): void => {
  if (!isBrowser()) return;
  
  try {
    window.localStorage.setItem(STORAGE_KEYS.BROKEN_AUDIT, JSON.stringify(audit));
  } catch (error) {
    console.warn('Failed to save broken audit state', error);
  }
};

/**
 * Load gallery preferences from localStorage
 */
export const loadPreferences = (): GalleryPreferences => {
  if (!isBrowser()) return DEFAULT_PREFERENCES;
  
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.PREFERENCES);
    if (!stored) return DEFAULT_PREFERENCES;
    
    const parsed = JSON.parse(stored);
    
    // Normalize page size
    const rawPageSize = typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE;
    const normalizedPageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize)
      ? rawPageSize
      : DEFAULT_PAGE_SIZE;
    
    // Normalize variant (legacy migration)
    const storedVariant = typeof parsed.variant === 'string' ? parsed.variant : 'full';
    const normalizedVariant = storedVariant === 'public' || storedVariant === 'original'
      ? 'full'
      : storedVariant;
    
    const normalizedDateFilter = normalizeDateFilterValue(parsed.dateFilter);
    
    // Normalize current page
    const normalizedCurrentPage = typeof parsed.currentPage === 'number' && parsed.currentPage > 0
      ? Math.floor(parsed.currentPage)
      : 1;
    const normalizedGridSize = normalizeGridSize(parsed.gridSize, DEFAULT_GRID_SIZE);
    
    return {
      variant: normalizedVariant,
      onlyCanonical: Boolean(parsed.onlyCanonical),
      respectAspectRatio: Boolean(parsed.respectAspectRatio),
      onlyWithVariants: Boolean(parsed.onlyWithVariants),
      showMotionAssetsOnly: Boolean(parsed.showMotionAssetsOnly),
      showComfyOnly: Boolean(parsed.showComfyOnly),
      selectedFolder: parsed.selectedFolder ?? 'all',
      selectedTag: parsed.selectedTag ?? '',
      searchTerm: parsed.searchTerm ?? '',
      viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
      gridSize: normalizedGridSize,
      filtersCollapsed: Boolean(parsed.filtersCollapsed),
      bulkFolderInput: typeof parsed.bulkFolderInput === 'string' ? parsed.bulkFolderInput : '',
      bulkFolderMode: parsed.bulkFolderMode === 'new' ? 'new' : 'existing',
      showDuplicatesOnly: Boolean(parsed.showDuplicatesOnly),
      showBrokenOnly: Boolean(parsed.showBrokenOnly),
      pageSize: normalizedPageSize,
      dateFilter: normalizedDateFilter,
      currentPage: normalizedCurrentPage,
    };
  } catch (error) {
    console.warn('Failed to parse gallery preferences', error);
    return DEFAULT_PREFERENCES;
  }
};

/**
 * Persist gallery preferences to localStorage
 */
export const persistPreferences = (prefs: Partial<GalleryPreferences>): void => {
  if (!isBrowser()) return;
  
  try {
    window.localStorage.setItem(STORAGE_KEYS.PREFERENCES, JSON.stringify(prefs));
  } catch (error) {
    console.warn('Failed to save gallery prefs', error);
  }
};
