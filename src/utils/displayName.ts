const NON_ALPHANUMERIC = /[^a-zA-Z0-9]+/g;

const toWords = (value: string): string[] =>
  value
    .replace(NON_ALPHANUMERIC, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

export function toCamelCaseDisplayName(value: string, maxLength = 64): string {
  const words = toWords(value);
  if (words.length === 0) return 'Image';

  const merged = words
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');

  const clipped = merged.slice(0, maxLength) || 'Image';
  return /^\d/.test(clipped) ? `Image${clipped}` : clipped;
}

export function fallbackDisplayNameFromFilename(filename?: string, maxLength = 64): string {
  if (!filename) return 'Image';
  const basename = filename.split(/[\\/]/).pop() || filename;
  const withoutExt = basename.replace(/\.[^.]+$/, '');
  return toCamelCaseDisplayName(withoutExt, maxLength);
}

export function sanitizeSuggestedDisplayName(value?: string, maxLength = 64): string {
  if (!value) return 'Image';
  const firstLine = value
    .replace(/```/g, ' ')
    .replace(/["'`]/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return toCamelCaseDisplayName(firstLine || value, maxLength);
}
