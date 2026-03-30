import { NextRequest, NextResponse } from 'next/server';
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
import { resolveUploadSource } from '@/server/import-metadata/uploadSourceResolver';
import { isPrivateHost, isValidRemoteUrl } from '@/server/import-metadata/http';

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
  duplicateAction?: string;
  cookieHeader?: string;
  sessionId?: string;
  tempAssetKey?: string;
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

      if (!item.url || !isValidRemoteUrl(item.url)) {
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

        const resolvedSource = await resolveUploadSource({
          url: item.url,
          sessionId: typeof item.sessionId === 'string' ? item.sessionId.trim() || undefined : undefined,
          tempAssetKey:
            typeof item.tempAssetKey === 'string' ? item.tempAssetKey.trim() || undefined : undefined,
          allowInsecure,
          cookieHeader: itemCookieHeader,
        });

        if ('response' in resolvedSource && resolvedSource.response) {
          const archiveDiagnostics = await readArchiveResponseDiagnostics(
            item.url,
            resolvedSource.response
          );
          logArchiveDiagnostics('import/page/upload', archiveDiagnostics, {
            clientId: item.clientId,
            phase: 'download',
          });
          if (!resolvedSource.response.ok) {
            failures.push({
              clientId: item.clientId,
              filename: item.url,
              error: archiveDiagnostics?.challengeDetected
                ? buildArchiveChallengeMessage(archiveDiagnostics.host)
                : `Failed to download image (HTTP ${resolvedSource.response.status})`,
              reason: 'upload'
            });
            continue;
          }
        }

        const inferredContentType =
          (resolvedSource.contentType && resolvedSource.contentType.startsWith('image/')
            ? resolvedSource.contentType
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

        const buffer = resolvedSource.buffer;
        if (buffer.byteLength < minImageBytes) {
          failures.push({
            clientId: item.clientId,
            filename: item.url,
            error: includeSmallAssets ? 'Image smaller than 1KB' : 'Image smaller than 4KB',
            reason: 'unsupported'
          });
          continue;
        }

        const filename = resolvedSource.filename
          ? sanitizeFilename(resolvedSource.filename)
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
            parentId: resolvedParentId,
            duplicateAction: typeof item.duplicateAction === 'string' ? item.duplicateAction : undefined,
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
