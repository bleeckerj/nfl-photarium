import { NextRequest, NextResponse } from 'next/server';
import { extractSnagx } from '@/utils/snagx';
import { sanitizeFilename } from '@/server/uploadService';
import path from 'path';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB to match uploader

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

const getMimeFromExtension = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('.');
    if (segments.length > 1) {
      const ext = segments.pop()?.toLowerCase();
      if (ext && IMAGE_EXTENSION_MIME_MAP[ext]) {
        return IMAGE_EXTENSION_MIME_MAP[ext];
      }
    }
  } catch {
    // ignore
  }
  return undefined;
};

const getFilenameFromUrl = (url: string, mimeType?: string | null) => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      return lastSegment;
    }
  } catch {
    // ignore
  }
  const extension = mimeType?.split('/')[1] || 'jpg';
  return `remote-image-${Date.now()}.${extension}`;
};

const buildSnagxDescription = (
  captureDate?: string,
  metadata?: Record<string, unknown>
) => {
  const details: string[] = [];
  if (captureDate) {
    details.push(`CaptureDate: ${captureDate}`);
  }
  if (metadata) {
    const { CaptureDate, ...rest } = metadata;
    if (Object.keys(rest).length > 0) {
      details.push(`Snagx metadata: ${JSON.stringify(rest)}`);
    }
  }
  return details.join(' | ');
};

const hasSnagxExtension = (value: string) => {
  try {
    const parsed = new URL(value);
    return path.extname(parsed.pathname).toLowerCase() === '.snagx';
  } catch {
    return value.toLowerCase().includes('.snagx');
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sourceUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!sourceUrl || !isValidUrl(sourceUrl)) {
      return NextResponse.json({ error: 'A valid image URL is required' }, { status: 400 });
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to download the image' }, { status: 400 });
    }

    const rawContentType = response.headers.get('content-type') ?? '';
    const normalizedType = rawContentType.split(';')[0].trim().toLowerCase();
    const isSnagx = hasSnagxExtension(sourceUrl) || normalizedType === 'application/octet-stream' || normalizedType === 'application/zip';

    const inferredContentType =
      (normalizedType && normalizedType.startsWith('image/')
        ? normalizedType
        : undefined) ?? getMimeFromExtension(sourceUrl);
    if (!inferredContentType && !isSnagx) {
      return NextResponse.json({ error: 'URL must point to an image' }, { status: 400 });
    }

    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);
    let finalBuffer = buffer;
    let finalType = inferredContentType || 'image/png';
    // Sanitize filename: truncate, clean, and handle Google Photos blobs
    let filename = sanitizeFilename(getFilenameFromUrl(sourceUrl, inferredContentType));
    let captureDate: string | undefined;
    let snagxMetadata: Record<string, unknown> | undefined;
    let snagxDescription: string | undefined;

    if (isSnagx) {
      try {
        const extracted = extractSnagx(buffer, filename);
        finalBuffer = extracted.buffer;
        finalType = 'image/png';
        // Sanitize the extracted filename too
        filename = sanitizeFilename(extracted.filename);
        captureDate = extracted.captureDate;
        snagxMetadata = extracted.metadata;
        snagxDescription = buildSnagxDescription(captureDate, snagxMetadata);
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to extract image from .snagx file' },
          { status: 400 }
        );
      }
    }

    if (finalBuffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: 'Remote image exceeds 10MB limit' }, { status: 400 });
    }

    const base64 = finalBuffer.toString('base64');

    return NextResponse.json({
      name: filename,
      type: finalType,
      size: finalBuffer.length,
      data: base64,
      originalUrl: sourceUrl,
      captureDate,
      snagxMetadata,
      snagxDescription
    });
  } catch (error) {
    console.error('Import image error:', error);
    return NextResponse.json({ error: 'Failed to import image' }, { status: 500 });
  }
}
