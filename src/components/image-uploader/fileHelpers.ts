import JSZip from "jszip";

export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;
const KEYNOTE_IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg'];
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

export const base64ToFile = (base64: string, filename: string, mimeType: string) => {
  const byteString = atob(base64);
  const len = byteString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
};

export const isZipFile = (file: File) => (
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  file.name.toLowerCase().endsWith('.zip')
);

export const isKeynoteFile = (file: File) => file.name.toLowerCase().endsWith('.key');
export const isArchiveFile = (file: File) => isZipFile(file) || isKeynoteFile(file);
export const isImageFile = (file: File) => file.type.startsWith('image/');
export const isVideoFile = (file: File) => file.type.startsWith('video/');
export const inferAssetTypeFromFile = (file: File): "image" | "video" => (isVideoFile(file) ? 'video' : 'image');

export const getFileSourcePath = (file: File) => {
  const relative = 'webkitRelativePath' in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : undefined;
  return relative && relative.trim() ? relative : undefined;
};

export const formatBytesMB = (bytes?: number) => {
  if (typeof bytes !== 'number') return 'Size unknown';
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export const parseTagInput = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

export const mergeTagInputs = (baseTags?: string, extraTags?: string): string => {
  const merged = new Map<string, string>();
  parseTagInput(baseTags).forEach((tag) => merged.set(tag.toLowerCase(), tag));
  parseTagInput(extraTags).forEach((tag) => merged.set(tag.toLowerCase(), tag));
  return Array.from(merged.values()).join(', ');
};

export const resolveTagInput = (globalTags: string, itemTags?: string): string => {
  if (itemTags === undefined) {
    return globalTags;
  }
  if (!itemTags.trim()) {
    return '';
  }
  return mergeTagInputs(globalTags, itemTags);
};

export const buildUploaderGallerySummaryUrl = (namespace?: string) => {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '500',
  });
  if (namespace === '') {
    params.set('namespace', process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default');
  } else if (namespace === '__all__') {
    params.set('namespace', '__all__');
  } else if (namespace && namespace !== '__all__') {
    params.set('namespace', namespace);
  }
  return `/api/images?${params.toString()}`;
};

const isSupportedImageName = (name: string) => {
  const lower = name.toLowerCase();
  return KEYNOTE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const normalizeEntryName = (entryName: string) => {
  const parts = entryName.split(/[\\/]/);
  return parts[parts.length - 1] || entryName;
};

const getMimeTypeFromFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const renderBitmapToBlob = (bitmap: ImageBitmap, width: number, height: number, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

export const reduceImageFileToLimit = async (file: File, maxBytes: number) => {
  const bitmap = await createImageBitmap(file);
  const startWidth = bitmap.width;
  const startHeight = bitmap.height;
  const candidates = ['image/webp', 'image/jpeg'];
  const qualityByType: Record<string, number> = { 'image/webp': 0.85, 'image/jpeg': 0.85 };
  let bestBlob: Blob | null = null;
  let bestType = 'image/jpeg';

  for (const type of candidates) {
    const blob = await renderBitmapToBlob(bitmap, startWidth, startHeight, type, qualityByType[type]);
    if (!blob) continue;
    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
      bestType = type;
    }
    if (blob.size <= maxBytes) {
      bitmap.close();
      return {
        blob,
        type,
        width: startWidth,
        height: startHeight,
        note: `Converted to ${type === 'image/webp' ? 'WebP' : 'JPEG'}`
      };
    }
  }

  let width = startWidth;
  let height = startHeight;
  let resizedBlob = bestBlob;
  let attempts = 0;
  const minDimension = 320;
  const targetType = bestBlob ? bestType : 'image/jpeg';
  const targetQuality = targetType === 'image/webp' ? 0.82 : 0.8;

  while (
    resizedBlob &&
    resizedBlob.size > maxBytes &&
    attempts < 8 &&
    Math.max(width, height) > minDimension
  ) {
    width = Math.max(minDimension, Math.round(width * 0.85));
    height = Math.max(minDimension, Math.round(height * 0.85));
    resizedBlob = await renderBitmapToBlob(bitmap, width, height, targetType, targetQuality);
    attempts += 1;
  }

  bitmap.close();

  if (resizedBlob && resizedBlob.size <= maxBytes) {
    return {
      blob: resizedBlob,
      type: targetType,
      width,
      height,
      note: `Converted to ${targetType === 'image/webp' ? 'WebP' : 'JPEG'} and resized`
    };
  }

  return null;
};

export const extractKeynoteImages = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => {
      const normalized = entry.name.replace(/\\/g, '/').toLowerCase();
      return (normalized.startsWith('data/') || normalized.includes('/data/')) && isSupportedImageName(normalized);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const extracted: Array<{ filename: string; file: File }> = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const filename = normalizeEntryName(entry.name);
    const blobType = (blob as Blob).type || '';
    const fileType = blobType || getMimeTypeFromFilename(filename) || 'application/octet-stream';
    extracted.push({
      filename,
      file: new File([blob], filename, { type: fileType })
    });
  }

  return extracted;
};

export const extractZipImages = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => isSupportedImageName(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const extracted: Array<{ filename: string; file: File }> = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const filename = normalizeEntryName(entry.name);
    const blobType = (blob as Blob).type || '';
    const fileType = blobType || getMimeTypeFromFilename(filename) || 'application/octet-stream';
    extracted.push({
      filename,
      file: new File([blob], filename, { type: fileType })
    });
  }

  return extracted;
};
