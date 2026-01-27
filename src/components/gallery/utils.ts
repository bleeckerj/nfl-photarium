/**
 * Gallery Utilities
 * 
 * Pure utility functions for gallery operations.
 * No side effects, easily testable.
 */

import { EXCLUDE_CLIP_TAG, EXCLUDE_COLOR_TAG, EXCLUDE_ALL_SEARCH_TAG } from '@/utils/searchExclusion';
import type { CloudflareImage, DuplicateGroup, DuplicateReason, SelectOption } from './types';

/**
 * Check if an image has any search exclusion tags
 */
export const hasSearchExclusionTag = (tags?: string[]): boolean => {
  if (!tags || tags.length === 0) return false;
  return tags.some(tag =>
    tag === EXCLUDE_CLIP_TAG ||
    tag === EXCLUDE_COLOR_TAG ||
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
};

/**
 * Get tooltip text describing which searches are excluded
 */
export const getExclusionTooltip = (tags?: string[]): string => {
  if (!tags || tags.length === 0) return '';
  const excluded: string[] = [];
  if (tags.includes(EXCLUDE_ALL_SEARCH_TAG)) {
    return 'Excluded from all vector searches';
  }
  if (tags.includes(EXCLUDE_CLIP_TAG)) excluded.push('semantic');
  if (tags.includes(EXCLUDE_COLOR_TAG)) excluded.push('color');
  return `Excluded from ${excluded.join(' & ')} search`;
};

/**
 * Normalize a URL for duplicate detection
 */
export const normalizeUrlKey = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }
    const origin = `${parsed.protocol}//${parsed.host}`;
    return `${origin}${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return undefined;
  }
};

/**
 * Normalize a content hash for duplicate detection
 */
export const normalizeHashKey = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
};

/**
 * Truncate a string in the middle
 */
export const truncateMiddle = (value: string, max = 64): string => {
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
};

/**
 * Check if an image is an SVG
 */
export const isSvgImage = (img: CloudflareImage): boolean => {
  return img.filename?.toLowerCase().endsWith('.svg') ?? false;
};

/**
 * Compute duplicate groups from a list of images
 */
export const computeDuplicateGroups = (images: CloudflareImage[]): DuplicateGroup[] => {
  const byKey = new Map<string, { items: CloudflareImage[]; reason: DuplicateReason }>();

  images.forEach((image) => {
    const keyFromUrl = normalizeUrlKey(image.originalUrlNormalized);
    const keyFromHash = normalizeHashKey(image.contentHash);

    // Only consider duplicates when BOTH URL and content hash are present and match
    if (!keyFromUrl || !keyFromHash) return;

    const reason: DuplicateReason = 'originalUrl+contentHash';
    const mapKey = `${keyFromUrl}|${keyFromHash}`;
    const existing = byKey.get(mapKey);
    if (existing) {
      existing.items.push(image);
    } else {
      byKey.set(mapKey, { items: [image], reason });
    }
  });

  return Array.from(byKey.entries())
    .filter(([, group]) => group.items.length > 1)
    .map(([key, group]) => ({
      key,
      reason: group.reason,
      label: 'Original URL + content hash',
      items: group.items,
    }));
};

/**
 * Build children map (images with parentId)
 */
export const buildChildrenMap = (images: CloudflareImage[]): Record<string, CloudflareImage[]> => {
  const map: Record<string, CloudflareImage[]> = {};
  images.forEach(image => {
    if (image.parentId) {
      map[image.parentId] = [...(map[image.parentId] || []), image];
    }
  });
  return map;
};

/**
 * Get unique folders from images
 */
export const getUniqueFolders = (images: CloudflareImage[]): string[] => {
  const folderNames = images
    .map(img => img.folder?.trim())
    .filter((folder): folder is string => Boolean(folder));
  return Array.from(new Set(folderNames)).sort((a, b) => a.localeCompare(b));
};

/**
 * Get unique tags from images
 */
export const getUniqueTags = (images: CloudflareImage[]): string[] => {
  const tags = Array.from(
    new Set(images.flatMap(img =>
      Array.isArray(img.tags) ? img.tags.filter(tag => tag && tag.trim()) : []
    ))
  );
  return tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/**
 * Build folder filter options
 */
export const buildFolderFilterOptions = (visibleFolders: string[]): SelectOption[] => [
  { value: 'all', label: 'All folders' },
  { value: 'no-folder', label: 'No folder' },
  ...visibleFolders.map(folder => ({ value: folder, label: folder })),
];

/**
 * Build folder edit options (with create new option)
 */
export const buildFolderEditOptions = (uniqueFolders: string[]): SelectOption[] => [
  { value: '', label: '[none]' },
  ...uniqueFolders.map(folder => ({ value: folder, label: folder })),
  { value: '__create__', label: 'Create new folder...' },
];

/**
 * Build namespace options
 */
export const buildNamespaceOptions = (
  images: CloudflareImage[],
  currentNamespace: string | undefined,
  registryNamespaces: string[]
): SelectOption[] => {
  const rawSeen = new Set(images.map(image => image.namespace).filter(Boolean));
  const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';

  // Explicitly known items
  const defaults = new Set<string>();
  if (envDefault) defaults.add(envDefault);

  // Configured known items
  const known = new Set<string>();
  knownRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    if (!defaults.has(s)) known.add(s);
  });

  const registry = new Set<string>();
  registryNamespaces.map(entry => entry.trim()).filter(Boolean).forEach(entry => {
    if (!defaults.has(entry) && !known.has(entry)) {
      registry.add(entry);
    }
  });

  // Discovered from current image set
  const discovered = new Set<string>();
  rawSeen.forEach(s => {
    if (s && !defaults.has(s) && !known.has(s) && !registry.has(s)) {
      discovered.add(s);
    }
  });

  const options: SelectOption[] = [
    { value: '__all__', label: 'All namespaces' },
    { value: '', label: '(no namespace)' },
  ];

  if (defaults.size > 0) {
    defaults.forEach(val => options.push({ value: val, label: `${val} (default)` }));
  }

  if (known.size > 0) {
    const sorted = Array.from(known).sort();
    sorted.forEach(val => options.push({ value: val, label: val }));
  }

  if (registry.size > 0) {
    const sorted = Array.from(registry).sort();
    sorted.forEach(val => options.push({ value: val, label: `${val} (registry)` }));
  }

  if (discovered.size > 0) {
    const sorted = Array.from(discovered).sort();
    sorted.forEach(val => options.push({ value: val, label: `${val} (discovered)` }));
  }

  options.push({ value: '__custom__', label: 'Enter manually...' });

  // Ensure the currently selected one is present
  if (currentNamespace && !options.some(opt => opt.value === currentNamespace) && currentNamespace !== '__custom__') {
    options.splice(options.length - 1, 0, { value: currentNamespace, label: currentNamespace });
  }

  return options;
};

/**
 * Format a date range label from a list of images
 */
export const formatDateRangeLabel = (items: CloudflareImage[]): string | null => {
  if (!items.length) return null;

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const newestLabel = formatDate(items[0].uploaded);
  const oldestLabel = formatDate(items[items.length - 1].uploaded);

  return newestLabel === oldestLabel ? newestLabel : `${newestLabel} - ${oldestLabel}`;
};

/**
 * Get variant width label
 */
export const getVariantWidthLabel = (variant: string, variantDimensions: Map<string, number | undefined>): string | null => {
  const width = variantDimensions.get(variant);
  if (!width) return null;
  return `${width}px`;
};

/**
 * Alias for buildNamespaceOptions for cleaner API
 */
export const getNamespaceOptions = (
  images: CloudflareImage[],
  registryNamespaces: string[],
  currentNamespace?: string
): SelectOption[] => buildNamespaceOptions(images, currentNamespace, registryNamespaces);
