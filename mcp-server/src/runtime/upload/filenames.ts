const UPLOAD_FILENAME_QUERY_KEYS = [
  'view_filename',
  'filename',
  'file',
  'name',
  'image',
  'download',
];

const UPLOAD_MIME_EXTENSION_MAP: Record<string, string> = {
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

export function decodeUrlComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractFilenameFromSearchParams(params: URLSearchParams): string | undefined {
  for (const key of UPLOAD_FILENAME_QUERY_KEYS) {
    const raw = params.get(key);
    if (raw && raw.trim()) {
      return decodeUrlComponentSafe(raw.trim());
    }
  }
  return undefined;
}

export function extractFilenameFromQueryBlob(value: string): string | undefined {
  const text = value.trim().replace(/^\?/, '');
  if (!text || !text.includes('=')) return undefined;
  const params = new URLSearchParams(text);
  return extractFilenameFromSearchParams(params);
}

export function cleanUploadFilename(value: string): string {
  let name = value.split(/[\\/]/).pop() || value;
  const fromBlob = extractFilenameFromQueryBlob(name);
  if (fromBlob) {
    name = fromBlob;
  }
  name = name.split('#')[0] || name;
  name = name.split('?')[0] || name;

  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const extension = hasExt ? name.slice(dot).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase() : '';
  const stem = hasExt ? name.slice(0, dot) : name;
  const cleanStem = stem
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const finalStem = cleanStem || 'UploadedImage';
  return `${finalStem}${extension}`;
}

export function camelizeUploadStem(value: string): string {
  const tokens = value
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return 'UploadedImage';
  const words = tokens.slice(0, 6).map((token) => {
    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  const merged = words.join('');
  if (!merged) return 'UploadedImage';
  return /^\d/.test(merged) ? `Image${merged}` : merged;
}

export function extensionFromMimeType(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  return UPLOAD_MIME_EXTENSION_MAP[normalized];
}

export function extensionFromFilename(value: string): string | undefined {
  const match = value.match(/\.[a-z0-9]{2,5}$/i);
  return match ? match[0].toLowerCase() : undefined;
}

export function withExtension(stem: string, extension?: string): string {
  if (!extension) return stem;
  if (stem.toLowerCase().endsWith(extension.toLowerCase())) return stem;
  return `${stem}${extension}`;
}

export function detectImageMimeFromBuffer(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 12) return undefined;

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  // TIFF
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return 'image/tiff';
  }

  // AVIF/HEIF family by ftyp box
  const ftyp = buffer.subarray(4, 12).toString('ascii');
  if (ftyp === 'ftypavif' || ftyp === 'ftypavis' || ftyp === 'ftypheic' || ftyp === 'ftypheif') {
    return 'image/avif';
  }

  // SVG (text-based)
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trim().toLowerCase();
  if (head.includes('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return undefined;
}

export function extractUploadFilenameFromUrl(url: string, mimeType?: string | null): string {
  const preferredExt = extensionFromMimeType(mimeType) || '.jpg';
  try {
    const parsed = new URL(url);
    const fromQuery = extractFilenameFromSearchParams(parsed.searchParams);
    if (fromQuery) {
      return withExtension(cleanUploadFilename(fromQuery), preferredExt);
    }

    const rawSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decodedSegment = decodeUrlComponentSafe(rawSegment);

    try {
      const nested = new URL(decodedSegment);
      const nestedQueryName = extractFilenameFromSearchParams(nested.searchParams);
      if (nestedQueryName) {
        return withExtension(cleanUploadFilename(nestedQueryName), preferredExt);
      }
      const nestedName = nested.pathname.split('/').filter(Boolean).pop();
      if (nestedName) {
        return withExtension(cleanUploadFilename(nestedName), preferredExt);
      }
    } catch {
      // Not a nested URL.
    }

    const queryBlobName = extractFilenameFromQueryBlob(decodedSegment);
    if (queryBlobName) {
      return withExtension(cleanUploadFilename(queryBlobName), preferredExt);
    }
    if (decodedSegment) {
      return withExtension(cleanUploadFilename(decodedSegment), preferredExt);
    }
  } catch {
    // Ignore malformed URLs and use fallback.
  }
  return withExtension('UploadedImage', preferredExt);
}

export function looksLikeTransportFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  const stem = lowered.replace(/\.[^.]+$/, '');
  if (stem.includes('view_filename=')) return true;
  if (stem.includes('filename=') && stem.includes('&')) return true;
  if (stem === 'view' || stem === 'image' || stem === 'uploaded-image' || stem === 'remote-image') return true;
  if (/^comfyui[_-]?\d+_?$/.test(stem)) return true;
  return /[=&]/.test(stem);
}

export function estimateBase64Bytes(value?: string): number | undefined {
  if (!value) return undefined;
  const payload = value.startsWith('data:') ? value.split(',', 2)[1] || '' : value;
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}
