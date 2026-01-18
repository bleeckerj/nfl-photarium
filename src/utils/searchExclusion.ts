/**
 * Search exclusion tags
 * 
 * Images tagged with these will be excluded from certain searches.
 * 
 * Tags:
 *   - x-clip: Exclude from CLIP/semantic similarity search
 *   - x-color: Exclude from color similarity search
 *   - x-search: Exclude from ALL vector searches (both CLIP and color)
 */

// Exclusion tag constants
export const EXCLUDE_CLIP_TAG = 'x-clip';
export const EXCLUDE_COLOR_TAG = 'x-color';
export const EXCLUDE_ALL_SEARCH_TAG = 'x-search';

/**
 * Check if an image should be excluded from CLIP search
 */
export function shouldExcludeFromCLIP(tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some(tag => 
    tag === EXCLUDE_CLIP_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
}

/**
 * Check if an image should be excluded from color search
 */
export function shouldExcludeFromColor(tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some(tag => 
    tag === EXCLUDE_COLOR_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
}

/**
 * Check if an image should be excluded from any vector search
 */
export function shouldExcludeFromSearch(
  tags: string[] | undefined, 
  searchType: 'clip' | 'color'
): boolean {
  if (searchType === 'clip') {
    return shouldExcludeFromCLIP(tags);
  }
  return shouldExcludeFromColor(tags);
}
