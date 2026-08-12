import {
  cleanUploadFilename,
  extensionFromFilename,
} from '../upload/filenames.js';

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

export function buildDemarkedFilename(sourceFilename: string): string {
  const cleaned = cleanUploadFilename(sourceFilename);
  const extension = extensionFromFilename(cleaned);
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported source format for demarking: ${sourceFilename}. Supported formats are PNG and JPEG.`,
    );
  }

  const stem = cleaned.slice(0, -extension.length).replace(/-demarked$/i, '') || 'Image';
  return `${stem}-demarked${extension}`;
}

export function buildDemarkedDisplayName(sourceDisplayName: string | undefined, sourceFilename: string): string {
  const fallbackStem = sourceFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Image';
  const base = (sourceDisplayName?.trim() || fallbackStem).replace(/\s*[—-]\s*Demarked$/i, '').trim();
  return `${base} — Demarked`;
}

export function mergeDemarkedTags(sourceTags: string[] | undefined): string[] {
  const tags = Array.isArray(sourceTags) ? sourceTags : [];
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...tags, 'demarked']) {
    const clean = typeof tag === 'string' ? tag.trim() : '';
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }
  return merged;
}
