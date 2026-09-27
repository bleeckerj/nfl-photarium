import JSZip from "jszip";
import { isDngFile } from '@/utils/dng';
import {
  CLOUDFLARE_MAX_IMAGE_AREA,
  CLOUDFLARE_MAX_IMAGE_DIMENSION,
  MAX_IMAGE_BYTES,
} from '@/utils/cloudflareImageLimits';

export const MAX_UPLOAD_IMAGE_BYTES = MAX_IMAGE_BYTES;
export const IMAGE_REDUCTION_QUALITY_STEPS = [1, 0.98, 0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6] as const;
const IMAGE_REDUCTION_SCALE_SEARCH_STEPS = 8;
const KEYNOTE_IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg', '.avif', '.dng'];
const MIME_BY_EXTENSION: Record<string, string> = {
  '.dng': 'image/x-adobe-dng',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
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
export const isImageFile = (file: File) => file.type.startsWith('image/') || isDngFile(file.name, file.type);
export const canPreviewImageFile = (file: File) => isImageFile(file) && !isDngFile(file.name, file.type);
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
  // The uploader only needs the folder facet list, which /api/images computes
  // over the full scope regardless of pagination — so request the smallest
  // possible page instead of shipping 500 records.
  const params = new URLSearchParams({
    page: '1',
    pageSize: '1',
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
    canvas.toBlob((blob) => resolve(blob?.type === type ? blob : null), type, quality);
  });

type ImageReductionCandidate = {
  blob: Blob;
  type: string;
  quality: number;
  width: number;
  height: number;
};

const resolveReductionFormats = (fileType: string) => {
  const normalizedType = fileType.toLowerCase();
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return ['image/jpeg', 'image/webp'];
  }
  // WebP preserves alpha. Keep PNG, WebP, and AVIF sources in that family
  // instead of risking a transparent source being flattened to JPEG.
  return ['image/webp'];
};

const resolveCloudflareScale = (width: number, height: number) => Math.min(
  1,
  CLOUDFLARE_MAX_IMAGE_DIMENSION / Math.max(width, height),
  Math.sqrt(CLOUDFLARE_MAX_IMAGE_AREA / (width * height)),
);

const resolveScaledDimensions = (width: number, height: number, scale: number) => ({
  width: Math.max(1, Math.round(width * scale)),
  height: Math.max(1, Math.round(height * scale)),
});

const selectLargestCandidate = (candidates: ImageReductionCandidate[]) =>
  candidates.sort((left, right) => right.blob.size - left.blob.size)[0];

const formatReductionNote = (candidate: ImageReductionCandidate, resized: boolean) => {
  const format = candidate.type === 'image/webp' ? 'WebP' : 'JPEG';
  const quality = Math.round(candidate.quality * 100);
  const size = `${(candidate.blob.size / 1024 / 1024).toFixed(2)} MB`;
  const action = resized ? 'reduced' : 'encoded';
  return `${action} to ${size} as ${format} q${quality} at ${candidate.width}x${candidate.height}`;
};

export const shouldDelegateImageReductionToServer = (file: File) =>
  isDngFile(file.name, file.type) || file.type === 'image/gif' || file.type === 'image/webp';

export const reduceImageFileToLimit = async (file: File, maxBytes: number) => {
  if (shouldDelegateImageReductionToServer(file)) {
    return null;
  }

  const bitmap = await createImageBitmap(file);
  const startWidth = bitmap.width;
  const startHeight = bitmap.height;
  const formats = resolveReductionFormats(file.type);
  const initialScale = resolveCloudflareScale(startWidth, startHeight);

  const encodeAtScale = async (scale: number, qualitySteps: readonly number[] = IMAGE_REDUCTION_QUALITY_STEPS) => {
    const dimensions = resolveScaledDimensions(startWidth, startHeight, scale);
    for (const quality of qualitySteps) {
      const passing: ImageReductionCandidate[] = [];
      for (const type of formats) {
        const blob = await renderBitmapToBlob(bitmap, dimensions.width, dimensions.height, type, quality);
        if (blob && blob.size <= maxBytes) {
          passing.push({ blob, type, quality, ...dimensions });
        }
      }
      if (passing.length > 0) {
        return selectLargestCandidate(passing);
      }
    }
    return null;
  };

  try {
    const fullSizeCandidate = await encodeAtScale(initialScale);
    if (fullSizeCandidate) {
      return {
        ...fullSizeCandidate,
        note: formatReductionNote(fullSizeCandidate, initialScale < 1),
      };
    }

    // The full-size quality ladder could not fit. Find the largest scale at
    // maximum quality, then select the best quality that fits at that scale.
    const minimumScale = 1 / Math.max(startWidth, startHeight);
    let lowerScale = minimumScale;
    let upperScale = initialScale;
    let largestPassingScale: number | undefined;
    for (let attempt = 0; attempt < IMAGE_REDUCTION_SCALE_SEARCH_STEPS; attempt += 1) {
      const candidateScale = (lowerScale + upperScale) / 2;
      const candidate = await encodeAtScale(candidateScale, [IMAGE_REDUCTION_QUALITY_STEPS[0]]);
      if (candidate) {
        largestPassingScale = candidateScale;
        lowerScale = candidateScale;
      } else {
        upperScale = candidateScale;
      }
    }

    const reducedCandidate = await encodeAtScale(largestPassingScale ?? minimumScale);
    if (!reducedCandidate) return null;
    return {
      ...reducedCandidate,
      note: formatReductionNote(reducedCandidate, true),
    };
  } finally {
    bitmap.close();
  }
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
