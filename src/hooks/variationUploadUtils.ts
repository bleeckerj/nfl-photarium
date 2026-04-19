export type VariationUploadFailureItem = {
  filename?: string;
  error?: string;
  duplicates?: Array<{ id?: string; filename?: string; folder?: string }>;
};

export const formatFailureNames = (failures: VariationUploadFailureItem[]) => {
  const names = failures.map((failure) => failure.filename || 'unknown');
  const preview = names.slice(0, 3).join(', ');
  if (names.length <= 3) {
    return preview;
  }
  return `${preview} +${names.length - 3} more`;
};

const formatFailureLabel = (failure: VariationUploadFailureItem) => {
  const filename = failure.filename || 'unknown';
  const error = typeof failure.error === 'string' ? failure.error.trim() : '';
  return error ? `${filename} (${error})` : filename;
};

export const formatFailureSummary = (failures: VariationUploadFailureItem[]) => {
  const preview = failures.slice(0, 2).map(formatFailureLabel).join(', ');
  if (failures.length <= 2) {
    return preview;
  }
  return `${preview} +${failures.length - 2} more`;
};

export const formatDuplicateMessage = (failure: VariationUploadFailureItem, fallback?: string) => {
  const duplicates = Array.isArray(failure.duplicates) ? failure.duplicates : [];
  if (!duplicates.length) return undefined;
  const summary = duplicates
    .map((dup) => {
      const label = dup.filename || 'Untitled';
      const location = dup.folder ? `${label} (${dup.folder})` : label;
      return dup.id ? `${location} [${dup.id}]` : location;
    })
    .slice(0, 3)
    .join(', ');
  const extra = duplicates.length > 3 ? '…' : '';
  return `${fallback || failure.error || 'Duplicate detected.'} Existing: ${summary}${extra}`;
};

const extractFilenameExtension = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  } catch {
    return trimmed.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  }
};

export const resolveUploadFilename = (value: string, fallback: string) => {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  const fallbackExtension = extractFilenameExtension(fallback);
  return fallbackExtension ? `${trimmed}${fallbackExtension}` : trimmed;
};
