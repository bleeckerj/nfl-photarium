/**
 * Filename sanitization utilities.
 * 
 * These functions are isomorphic (work in both browser and Node.js)
 * to support pre-upload filename cleaning in the uploader UI.
 */

export const MAX_FILENAME_LENGTH = 64; // Max bytes for filename to save metadata space

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
  const extension = hasExtension ? name.slice(lastDot) : '';
  const baseName = hasExtension ? name.slice(0, lastDot) : name;
  
  // Clean the base name: replace problematic chars, collapse whitespace
  let cleanBase = baseName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Replace invalid filesystem chars
    .replace(/\s+/g, '_')                      // Replace whitespace with underscore
    .replace(/_+/g, '_')                       // Collapse multiple underscores
    .replace(/^_+|_+$/g, '');                  // Trim leading/trailing underscores
  
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
