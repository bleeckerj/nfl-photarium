import { NextRequest, NextResponse } from 'next/server';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES, uploadImageBuffer } from '@/server/uploadService';
import type { UploadFailure, UploadSuccess } from '@/server/uploadService';

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

const MIN_IMAGE_BYTES = 8 * 1024;

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
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

const getFilenameFromContentDisposition = (value: string | null) => {
  if (!value) return undefined;
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^\";]+)"?/i.exec(value);
  const encoded = match?.[1] || match?.[2];
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

type UploadItem = {
  clientId: string;
  url: string;
  folder?: string;
  tags?: string;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
};

export async function POST(request: NextRequest) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const items = Array.isArray(body?.items) ? (body.items as UploadItem[]) : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'No URLs provided' }, { status: 400 });
    }

    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || undefined;

    const results: Array<UploadSuccess & { clientId: string }> = [];
    const failures: Array<UploadFailure & { clientId: string }> = [];

    for (const item of items) {
      const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : undefined;
      const originalUrl = typeof item.originalUrl === 'string' ? item.originalUrl.trim() : undefined;
      const cleanFolder = typeof item.folder === 'string' && item.folder.trim() ? item.folder.trim() : undefined;
      const cleanTags = typeof item.tags === 'string'
        ? item.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
      const cleanDescription = typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : undefined;
      const rawNamespace = typeof item.namespace === 'string' ? item.namespace.trim() : '';
      const cleanNamespace =
        rawNamespace && rawNamespace !== 'undefined' && rawNamespace !== '__all__' && rawNamespace !== '__none__'
          ? rawNamespace
          : undefined;
      const effectiveNamespace = cleanNamespace || defaultNamespace;
      const parentIdValue = typeof item.parentId === 'string' ? item.parentId.trim() : '';
      const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

      if (!item.url || !isValidUrl(item.url)) {
        failures.push({
          clientId: item.clientId,
          filename: item.url || 'unknown',
          error: 'Invalid image URL',
          reason: 'invalid-type'
        });
        continue;
      }

      const parsed = new URL(item.url);
      if (isPrivateHost(parsed.hostname)) {
        failures.push({
          clientId: item.clientId,
          filename: parsed.pathname.split('/').pop() || item.url,
          error: 'Private or localhost URLs are not allowed',
          reason: 'invalid-type'
        });
        continue;
      }

      try {
        const response = await fetch(item.url);
        if (!response.ok) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: 'Failed to download image',
            reason: 'upload'
          });
          continue;
        }

        const rawContentType = response.headers.get('content-type') ?? '';
        const normalizedType = rawContentType.split(';')[0].trim().toLowerCase();
        const inferredContentType =
          (normalizedType && normalizedType.startsWith('image/')
            ? normalizedType
            : undefined) ?? getMimeFromExtension(item.url);
        if (!inferredContentType || !SUPPORTED_IMAGE_TYPES.has(inferredContentType)) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: 'URL must point to a supported image',
            reason: 'invalid-type'
          });
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: 'Remote image exceeds 10MB limit',
            reason: 'too-large'
          });
          continue;
        }
        if (buffer.byteLength < MIN_IMAGE_BYTES) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: 'Image smaller than 8KB',
            reason: 'unsupported'
          });
          continue;
        }

        const contentDisposition = response.headers.get('content-disposition');
        const dispositionName = getFilenameFromContentDisposition(contentDisposition);
        const filename = dispositionName || getFilenameFromUrl(item.url, inferredContentType);

        const outcome = await uploadImageBuffer({
          buffer,
          originalBuffer: buffer,
          fileName: filename,
          fileType: inferredContentType,
          fileSize: buffer.byteLength,
          context: {
            accountId,
            apiToken,
            folder: cleanFolder,
            tags: cleanTags,
            description: cleanDescription,
            originalUrl: originalUrl || item.url,
            sourceUrl: sourceUrl,
            namespace: effectiveNamespace,
            parentId: cleanParentId
          }
        });

        if (outcome.ok) {
          results.push({ ...outcome.data, clientId: item.clientId });
        } else {
          failures.push({
            clientId: item.clientId,
            filename,
            error: outcome.error,
            reason: outcome.reason,
            duplicates: outcome.duplicates ? outcome.duplicates.map(toDuplicateSummary) : undefined
          });
        }
      } catch (error) {
        console.error('Remote upload failed', error);
        failures.push({
          clientId: item.clientId,
          filename: item.url,
          error: 'Failed to upload image',
          reason: 'upload'
        });
      }
    }

    return NextResponse.json({
      results,
      failures,
      successCount: results.length,
      failureCount: failures.length
    });
  } catch (error) {
    console.error('Page import upload error:', error);
    return NextResponse.json({ error: 'Failed to upload page images' }, { status: 500 });
  }
}
