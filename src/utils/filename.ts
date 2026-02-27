/**
 * Filename sanitization utilities.
 * 
 * These functions are isomorphic (work in both browser and Node.js)
 * to support pre-upload filename cleaning in the uploader UI.
 */

export const MAX_FILENAME_LENGTH = 64; // Max bytes for filename to save metadata space

const QUERY_FILENAME_KEYS = [
  'view_filename',
  'filename',
  'file',
  'name',
  'image',
  'download',
];

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/tiff': '.tiff',
};

const decodeSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const extractFilenameFromSearchParams = (params: URLSearchParams): string | undefined => {
  for (const key of QUERY_FILENAME_KEYS) {
    const value = params.get(key);
    if (typeof value === 'string' && value.trim()) {
      return decodeSafe(value.trim());
    }
  }
  return undefined;
};

const extractFilenameFromQueryBlob = (value: string): string | undefined => {
  const text = value.trim().replace(/^\?/, '');
  if (!text || !text.includes('=')) {
    return undefined;
  }

  const params = new URLSearchParams(text);
  return extractFilenameFromSearchParams(params);
};

const extensionFromMimeType = (mimeType?: string | null): string | undefined => {
  if (!mimeType) return undefined;
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  return MIME_EXTENSION_MAP[normalized];
};

const isGenericRemoteStem = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return lowered === 'remote-image' || lowered === 'uploaded-image' || lowered === 'image' || lowered === 'view';
};

const ensureExtension = (filename: string, preferredExt?: string): string => {
  if (!preferredExt) return filename;
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  return `${filename}${preferredExt}`;
};

/**
 * Sanitize a filename to be safe and not consume too much metadata.
 * - Strips path components
 * - Removes/replaces problematic characters
 * - Truncates to MAX_FILENAME_LENGTH while preserving extension
 * - Detects Google Photos blob filenames and replaces with timestamp
 */
export function sanitizeFilename(filename: string): string {
  // Strip path components
  let name = filename.split(/[\\/]/).pop() || filename;

  // Handle query/blob-style pseudo names like
  // "view_filename=foo.png&type=output&subfolder=..."
  const queryBlobFilename = extractFilenameFromQueryBlob(name);
  if (queryBlobFilename) {
    name = queryBlobFilename;
  }

  // Remove fragment/query leftovers if present
  name = name.split('#')[0] || name;
  name = name.split('?')[0] || name;
  
  // Detect Google Photos blob filenames (base64-like strings with = signs)
  // These look like: ADKq_Na6MuRqznOhZB0miv7fBb8...=s0-d-e1-ft
  const isGooglePhotosBlob = /^[A-Za-z0-9_-]{50,}[=]/.test(name) || 
                              name.includes('=s0-d-e1-ft') ||
                              (name.length > 100 && /^[A-Za-z0-9_-]+$/.test(name.replace(/\.[^.]+$/, '')));
  
  if (isGooglePhotosBlob) {
    // Extract extension if present
    const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    // Generate a readable timestamp-based name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    name = `image-${timestamp}.${ext}`;
  }
  
  // Get the extension
  const lastDot = name.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < name.length - 1;
  const extension = hasExtension ? name.slice(lastDot).replace(/[^a-zA-Z0-9.]/g, '') : '';
  const baseName = hasExtension ? name.slice(0, lastDot) : name;
  
  // Clean the base name: keep only URL/file-safe tokens.
  let cleanBase = baseName
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  
  // If base is empty after cleaning, use a default
  if (!cleanBase) {
    cleanBase = 'image';
  }
  
  // Truncate if necessary (preserve extension)
  const maxBaseLength = MAX_FILENAME_LENGTH - extension.length;
  if (cleanBase.length > maxBaseLength) {
    cleanBase = cleanBase.slice(0, maxBaseLength);
    // Don't end with underscore after truncation
    cleanBase = cleanBase.replace(/_+$/, '');
  }
  
  return cleanBase + extension;
}

/**
 * Check if a filename looks like a Google Photos blob (long base64-like string)
 */
export function isGooglePhotosBlob(filename: string): boolean {
  const name = filename.split(/[\\/]/).pop() || filename;
  return /^[A-Za-z0-9_-]{50,}[=]/.test(name) || 
         name.includes('=s0-d-e1-ft') ||
         (name.length > 100 && /^[A-Za-z0-9_-]+$/.test(name.replace(/\.[^.]+$/, '')));
}

/**
 * Check if a filename needs sanitization (too long, has problematic chars, etc.)
 */
export function needsSanitization(filename: string): boolean {
  // Too long
  if (filename.length > MAX_FILENAME_LENGTH) return true;
  // Google Photos blob
  if (isGooglePhotosBlob(filename)) return true;
  // Invalid filesystem characters
  if (/[<>:"/\\|?*\x00-\x1f]/.test(filename)) return true;
  // Contains spaces or multiple underscores (messy)
  if (/\s/.test(filename)) return true;
  if (/_{2,}/.test(filename)) return true;
  // Starts or ends with underscore/dot (after extension)
  const baseName = filename.replace(/\.[^.]+$/, '');
  if (/^[_.]|[_.]$/.test(baseName)) return true;
  return false;
}

export function extractFilenameFromUrl(url: string, mimeType?: string | null): string {
  const preferredExt = extensionFromMimeType(mimeType) || '.jpg';

  try {
    const parsed = new URL(url);

    const fromQuery = extractFilenameFromSearchParams(parsed.searchParams);
    if (fromQuery) {
      const sanitized = sanitizeFilename(fromQuery);
      const stem = sanitized.replace(/\.[^.]+$/, '');
      return ensureExtension(isGenericRemoteStem(stem) ? 'UploadedImage' : sanitized, preferredExt);
    }

    const rawSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decodedSegment = decodeSafe(rawSegment);

    // Handle nested URLs encoded in path segments.
    try {
      const nested = new URL(decodedSegment);
      const nestedFromQuery = extractFilenameFromSearchParams(nested.searchParams);
      if (nestedFromQuery) {
        const sanitized = sanitizeFilename(nestedFromQuery);
        const stem = sanitized.replace(/\.[^.]+$/, '');
        return ensureExtension(isGenericRemoteStem(stem) ? 'UploadedImage' : sanitized, preferredExt);
      }
      const nestedName = nested.pathname.split('/').filter(Boolean).pop();
      if (nestedName) {
        const sanitized = sanitizeFilename(nestedName);
        const stem = sanitized.replace(/\.[^.]+$/, '');
        return ensureExtension(isGenericRemoteStem(stem) ? 'UploadedImage' : sanitized, preferredExt);
      }
    } catch {
      // Not a nested URL.
    }

    const fromBlob = extractFilenameFromQueryBlob(decodedSegment);
    if (fromBlob) {
      const sanitized = sanitizeFilename(fromBlob);
      const stem = sanitized.replace(/\.[^.]+$/, '');
      return ensureExtension(isGenericRemoteStem(stem) ? 'UploadedImage' : sanitized, preferredExt);
    }

    if (decodedSegment) {
      const sanitized = sanitizeFilename(decodedSegment);
      const stem = sanitized.replace(/\.[^.]+$/, '');
      return ensureExtension(isGenericRemoteStem(stem) ? 'UploadedImage' : sanitized, preferredExt);
    }
  } catch {
    // Ignore invalid URLs and use fallback.
  }

  return ensureExtension('UploadedImage', preferredExt);
}
