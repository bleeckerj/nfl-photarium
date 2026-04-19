import { NextRequest, NextResponse } from 'next/server';
import { cleanString } from '@/utils/cloudflareMetadata';
import { sanitizeFilename } from '@/utils/filename';
import { uploadVideoBuffer, uploadVideoFromRemoteUrl, type VideoUploadContext } from '@/server/videoUploadService';
import { validateParentForNewChild } from '@/server/parentValidation';
import { resolveUploadNamespace, SPECIFIC_NAMESPACE_REQUIRED_ERROR } from '@/server/uploadNamespace';

type UploadVideoRequestBody = {
  url?: string;
  filename?: string;
  displayName?: string;
  folder?: string;
  tags?: string;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  requireSignedUrls?: boolean;
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

const parseTags = (value?: string | null) =>
  (value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const extractFilenameExtension = (value?: string | null) => {
  const cleaned = cleanString(value);
  if (!cleaned) return '';

  try {
    const parsed = new URL(cleaned);
    return parsed.pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  } catch {
    return cleaned.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  }
};

const sanitizeOptionalFilename = (value?: string | null, fallback?: string | null) => {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;

  const sanitized = sanitizeFilename(cleaned);
  if (/\.[a-z0-9]{2,5}$/i.test(sanitized)) {
    return sanitized;
  }

  const fallbackExtension = extractFilenameExtension(fallback);
  return fallbackExtension ? `${sanitized}${fallbackExtension}` : sanitized;
};

const parseContext = (
  {
    folder,
    tags,
    description,
    originalUrl,
    sourceUrl,
    displayName,
    namespace,
    parentId,
    requireSignedUrls,
  }: {
    folder?: string | null;
    tags?: string | null;
    description?: string | null;
    originalUrl?: string | null;
    sourceUrl?: string | null;
    displayName?: string | null;
    namespace?: string | null;
    parentId?: string | null;
    requireSignedUrls?: boolean;
  }
): VideoUploadContext => ({
  folder: cleanString(folder),
  tags: parseTags(tags),
  description: cleanString(description),
  displayName: cleanString(displayName),
  originalUrl: cleanString(originalUrl),
  sourceUrl: cleanString(sourceUrl),
  namespace: cleanString(namespace),
  parentId: cleanString(parentId),
  requireSignedUrls,
});

const validateRemoteUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isPrivateHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = (await request.json()) as UploadVideoRequestBody;
      const sourceUrl = cleanString(body.url);
      if (!sourceUrl) {
        return NextResponse.json({ error: 'No video URL provided' }, { status: 400 });
      }
      const safeUrl = validateRemoteUrl(sourceUrl);
      if (!safeUrl) {
        return NextResponse.json(
          { error: 'Only public http(s) URLs are allowed for remote video import' },
          { status: 400 }
        );
      }
      const parentValidation = await validateParentForNewChild(body.parentId);
      if (!parentValidation.ok) {
        return NextResponse.json({ error: parentValidation.error }, { status: parentValidation.status });
      }
      const namespaceValue = resolveUploadNamespace(body.namespace, parentValidation);
      if (!namespaceValue) {
        return NextResponse.json(
          { error: SPECIFIC_NAMESPACE_REQUIRED_ERROR },
          { status: 400 }
        );
      }

      const outcome = await uploadVideoFromRemoteUrl({
        sourceUrl: safeUrl,
        fileName: sanitizeOptionalFilename(body.filename, safeUrl),
        context: parseContext({
          folder: body.folder,
          tags: body.tags,
          description: body.description,
          displayName: body.displayName,
          originalUrl: body.originalUrl,
          sourceUrl: body.sourceUrl ?? safeUrl,
          namespace: namespaceValue,
          parentId: parentValidation.canonicalParentId,
          requireSignedUrls: body.requireSignedUrls === true,
        }),
      });

      if (!outcome.ok) {
        return NextResponse.json({ error: outcome.error }, { status: outcome.status });
      }
      return NextResponse.json(outcome.data);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
    }

    const rawParentId = cleanString(formData.get('parentId') as string | null);
    const parentValidation = await validateParentForNewChild(rawParentId);
    if (!parentValidation.ok) {
      return NextResponse.json({ error: parentValidation.error }, { status: parentValidation.status });
    }
    const namespace = resolveUploadNamespace(formData.get('namespace') as string | null, parentValidation);
    if (!namespace) {
      return NextResponse.json(
        { error: SPECIFIC_NAMESPACE_REQUIRED_ERROR },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const explicitFilename = sanitizeOptionalFilename(formData.get('filename') as string | null, file.name);
    const outcome = await uploadVideoBuffer({
      buffer,
      fileName: explicitFilename || file.name,
      fileType: cleanString(file.type),
      fileSize: file.size,
      context: parseContext({
        folder: formData.get('folder') as string | null,
        tags: formData.get('tags') as string | null,
        description: formData.get('description') as string | null,
        displayName: formData.get('displayName') as string | null,
        originalUrl: formData.get('originalUrl') as string | null,
        sourceUrl: formData.get('sourceUrl') as string | null,
        namespace,
        parentId: parentValidation.canonicalParentId,
        requireSignedUrls:
          cleanString(formData.get('requireSignedUrls') as string | null) === 'true',
      }),
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (error) {
    console.error('[upload-video] upload error:', error);
    return NextResponse.json({ error: 'Failed to upload video' }, { status: 500 });
  }
}
