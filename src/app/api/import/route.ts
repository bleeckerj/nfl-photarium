import { NextRequest, NextResponse } from 'next/server';
import { extractSnagx } from '@/utils/snagx';
import { MAX_IMAGE_BYTES, prepareImageForUpload, sanitizeFilename } from '@/server/uploadService';
import path from 'path';

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
  tiff: 'image/tiff',
  tif: 'image/tiff',
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

const buildDownloadFailureMessage = (sourceUrl: string, response: Response) => {
  let host = sourceUrl;
  try {
    host = new URL(sourceUrl).host;
  } catch {
    // Keep original sourceUrl fallback.
  }
  const status = response.status;
  const statusText = response.statusText || 'Unknown';
  return `Failed to download image from ${host} (HTTP ${status} ${statusText}). The source may block automated downloads or require login.`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sourceUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!sourceUrl || !isValidUrl(sourceUrl)) {
      return NextResponse.json({ error: 'A valid image URL is required' }, { status: 400 });
    }

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // Some hosts reject browser-like headers or bot-like patterns.
    // Retry without custom headers if the primary request fails.
    let response: Response;
    try {
      response = await fetch(sourceUrl, {
        headers: requestHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      return NextResponse.json(
        { error: `Failed to download image: ${message}` },
        { status: 400 }
      );
    }

    if (!response.ok) {
      try {
        const fallbackResponse = await fetch(sourceUrl);
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        } else {
          console.warn('[import] Remote download failed', {
            sourceUrl,
            status: fallbackResponse.status,
            statusText: fallbackResponse.statusText,
            finalUrl: fallbackResponse.url,
          });
          return NextResponse.json(
            {
              error: buildDownloadFailureMessage(sourceUrl, fallbackResponse),
              details: {
                upstreamStatus: fallbackResponse.status,
                upstreamStatusText: fallbackResponse.statusText,
                finalUrl: fallbackResponse.url,
              },
            },
            { status: 400 }
          );
        }
      } catch {
        console.warn('[import] Remote download failed', {
          sourceUrl,
          status: response.status,
          statusText: response.statusText,
          finalUrl: response.url,
        });
        return NextResponse.json(
          {
            error: buildDownloadFailureMessage(sourceUrl, response),
            details: {
              upstreamStatus: response.status,
              upstreamStatusText: response.statusText,
              finalUrl: response.url,
            },
          },
          { status: 400 }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: buildDownloadFailureMessage(sourceUrl, response),
          details: {
            upstreamStatus: response.status,
            upstreamStatusText: response.statusText,
            finalUrl: response.url,
          },
        },
        { status: 400 }
      );
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
    let finalBuffer: Buffer = buffer;
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

    const prepared = await prepareImageForUpload({
      buffer: finalBuffer,
      fileType: finalType,
      fileName: filename,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }
    finalBuffer = prepared.data.buffer;
    finalType = prepared.data.fileType;
    filename = prepared.data.fileName;

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
