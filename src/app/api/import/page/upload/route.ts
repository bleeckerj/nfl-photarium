import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import { sanitizeFilename, SUPPORTED_IMAGE_TYPES, uploadImageBuffer } from '@/server/uploadService';
import { validateParentForNewChild } from '@/server/parentValidation';
import {
  buildArchiveChallengeMessage,
  logArchiveDiagnostics,
  readArchiveResponseDiagnostics,
} from '@/server/archiveDiagnostics';
import { extractFilenameFromUrl } from '@/utils/filename';
import { normalizeCookieHeader } from '@/server/pageImportCookies';
import type { UploadFailure, UploadSuccess } from '@/server/uploadService';

// Use a browser-like User-Agent to avoid sites (e.g. Google Drive) redirecting to login pages
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

const MIN_IMAGE_BYTES = 4 * 1024;
const SMALL_ASSET_MIN_IMAGE_BYTES = 1024;

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const isCertError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
  return code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
};

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent };

const fetchWithCertFallback = async (url: string, allowInsecure: boolean, init?: RequestInit) => {
  const baseHeaders = { 'User-Agent': BROWSER_USER_AGENT, ...(init?.headers || {}) };
  const firstInit: FetchInitWithDispatcher = allowInsecure
    ? { ...init, headers: baseHeaders, dispatcher: insecureAgent }
    : { ...init, headers: baseHeaders };
  try {
    return await fetch(url, firstInit as RequestInit);
  } catch (error) {
    if (!allowInsecure) throw error;
    if (isCertError(error)) {
      if (!firstInit.dispatcher) {
        const retryInit: FetchInitWithDispatcher = { ...init, headers: baseHeaders, dispatcher: insecureAgent };
        return await fetch(url, retryInit as RequestInit);
      }
    }
    throw error;
  }
};

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
  displayName?: string;
  folder?: string;
  tags?: string;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  cookieHeader?: string;
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
    const includeSmallAssets = Boolean(body?.includeSmallAssets);
    const minImageBytes = includeSmallAssets ? SMALL_ASSET_MIN_IMAGE_BYTES : MIN_IMAGE_BYTES;
    let requestCookieHeader: string | null = null;
    try {
      requestCookieHeader = normalizeCookieHeader(body?.cookieHeader);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cookie header' }, { status: 400 });
    }
    const allowInsecureEnv = process.env.IMPORT_ALLOW_INSECURE_TLS === 'true';
    const allowInsecure = allowInsecureEnv && Boolean(body?.allowInsecure);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[import/page/upload] allowInsecureEnv:', allowInsecureEnv, 'allowInsecureReq:', Boolean(body?.allowInsecure), 'effective:', allowInsecure);
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'No URLs provided' }, { status: 400 });
    }

    const results: Array<UploadSuccess & { clientId: string }> = [];
    const failures: Array<UploadFailure & { clientId: string }> = [];

    for (const item of items) {
      const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : undefined;
      const originalUrl = typeof item.originalUrl === 'string' ? item.originalUrl.trim() : undefined;
      const cleanDisplayName =
        typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName.trim()
          : undefined;
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
      if (!cleanNamespace) {
        failures.push({
          clientId: item.clientId,
          filename: item.url || 'unknown',
          error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
          reason: 'upload'
        });
        continue;
      }
      const effectiveNamespace = cleanNamespace;
      const parentIdValue = typeof item.parentId === 'string' ? item.parentId.trim() : '';
      const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

      const parentValidation = await validateParentForNewChild(cleanParentId);
      if (!parentValidation.ok) {
        failures.push({
          clientId: item.clientId,
          filename: item.url || 'unknown',
          error: parentValidation.error,
          reason: 'upload'
        });
        continue;
      }
      const resolvedParentId = parentValidation.canonicalParentId;

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
        let itemCookieHeader: string | null = requestCookieHeader;
        try {
          itemCookieHeader = normalizeCookieHeader(item.cookieHeader) ?? requestCookieHeader;
        } catch (error) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: error instanceof Error ? error.message : 'Invalid cookie header',
            reason: 'invalid-type'
          });
          continue;
        }

        const response = await fetchWithCertFallback(
          item.url,
          allowInsecure,
          itemCookieHeader ? { headers: { Cookie: itemCookieHeader } } : undefined
        );
        const archiveDiagnostics = await readArchiveResponseDiagnostics(item.url, response);
        logArchiveDiagnostics('import/page/upload', archiveDiagnostics, {
          clientId: item.clientId,
          phase: 'download',
        });
        if (!response.ok) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: archiveDiagnostics?.challengeDetected
              ? buildArchiveChallengeMessage(archiveDiagnostics.host)
              : `Failed to download image (HTTP ${response.status})`,
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
          const contentTypeHint = archiveDiagnostics?.contentType
            ? ` (${archiveDiagnostics.contentType})`
            : '';
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: archiveDiagnostics
              ? archiveDiagnostics.challengeDetected
                ? buildArchiveChallengeMessage(archiveDiagnostics.host)
                : `${archiveDiagnostics.host} returned HTML or a non-image response instead of a supported image${contentTypeHint}`
              : 'URL must point to a supported image',
            reason: 'invalid-type'
          });
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.byteLength < minImageBytes) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: includeSmallAssets ? 'Image smaller than 1KB' : 'Image smaller than 4KB',
            reason: 'unsupported'
          });
          continue;
        }

        const contentDisposition = response.headers.get('content-disposition');
        const dispositionName = getFilenameFromContentDisposition(contentDisposition);
        const filename = dispositionName
          ? sanitizeFilename(dispositionName)
          : extractFilenameFromUrl(item.url, inferredContentType);

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
            displayName: cleanDisplayName,
            description: cleanDescription,
            originalUrl: originalUrl || item.url,
            sourceUrl: sourceUrl,
            namespace: effectiveNamespace,
            parentId: resolvedParentId
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
