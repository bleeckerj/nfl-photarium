/** Literal phrase matching with Unicode word boundaries; punctuation separates words. */
export function createWholeWordMatcher(query: string, caseSensitive = false): (value: string) => boolean {
  const normalize = (value: string) => caseSensitive ? value : value.toLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return () => true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Include combining marks so an unaccented query cannot match part of an accented word.
  // Underscores and hyphens delimit words in filenames and metadata.
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'u');
  return (value) => pattern.test(normalize(value));
}
