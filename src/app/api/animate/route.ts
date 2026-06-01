import { NextRequest, NextResponse } from 'next/server';
import { uploadImageBuffer } from '@/server/uploadService';
import { validateParentForNewChild } from '@/server/parentValidation';
import { buildAnimatedWebpFromFrames } from '@/server/animatedWebpService';

type AnimationItem =
  | { kind: 'file'; fileIndex: number }
  | { kind: 'url'; url: string };

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

const getFilenameFromUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'remote-frame';
  } catch {
    return 'remote-frame';
  }
};

const resolveLoopValue = (value: string | null) => {
  if (value === null) return true;
  if (value === 'false') return false;
  if (value === '0') return false;
  return true;
};

const normalizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9-_\.]/g, '_');

const getHostFromUrl = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};

const buildFrameFetchError = (sourceUrl: string, response: Response) => {
  const host = getHostFromUrl(sourceUrl);
  const statusText = response.statusText || 'Unknown';
  return `Failed to fetch frame from ${host} (HTTP ${response.status} ${statusText})`;
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

    const formData = await request.formData();
    const itemsRaw = formData.get('items');
    if (!itemsRaw || typeof itemsRaw !== 'string') {
      return NextResponse.json({ error: 'No frames provided' }, { status: 400 });
    }

    let items: AnimationItem[] = [];
    try {
      items = JSON.parse(itemsRaw) as AnimationItem[];
    } catch {
      return NextResponse.json({ error: 'Invalid frame payload' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length < 2) {
      return NextResponse.json({ error: 'Select at least two images' }, { status: 400 });
    }

    const fpsRaw = formData.get('fps');
    const fps = fpsRaw ? Number(fpsRaw) : 1;
    if (!Number.isFinite(fps) || fps <= 0) {
      return NextResponse.json({ error: 'FPS must be greater than 0' }, { status: 400 });
    }

    const loop = resolveLoopValue(formData.get('loop') as string | null);

    const folder = (formData.get('folder') as string) || undefined;
    const tagsRaw = (formData.get('tags') as string) || '';
    const description = (formData.get('description') as string) || undefined;
    const originalUrl = (formData.get('originalUrl') as string) || undefined;
    const sourceUrl = (formData.get('sourceUrl') as string) || undefined;
    const namespace = (formData.get('namespace') as string) || undefined;
    const parentId = (formData.get('parentId') as string) || undefined;
    const filenameRaw = (formData.get('filename') as string) || '';
    const cleanParentId = parentId && parentId.trim() ? parentId.trim() : undefined;

    const parentValidation = await validateParentForNewChild(cleanParentId);
    if (!parentValidation.ok) {
      return NextResponse.json(
        { error: parentValidation.error },
        { status: parentValidation.status }
      );
    }
    const resolvedParentId = parentValidation.canonicalParentId;

    const cleanTags = tagsRaw
      ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

    const fileList = formData.getAll('files') as File[];
    const frames: { buffer: Buffer; filename: string }[] = [];
    const errors: string[] = [];
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    for (const item of items) {
      if (item.kind === 'file') {
        const file = fileList[item.fileIndex];
        if (!file) {
          errors.push('Missing file frame');
          continue;
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        frames.push({ buffer, filename: file.name });
      } else if (item.kind === 'url') {
        if (!isValidUrl(item.url)) {
          errors.push('Invalid frame URL');
          continue;
        }
        const parsed = new URL(item.url);
        if (isPrivateHost(parsed.hostname)) {
          errors.push('Private or localhost frame URL');
          continue;
        }
        try {
          let response = await fetch(item.url, { headers: requestHeaders });
          if (!response.ok) {
            const fallbackResponse = await fetch(item.url);
            if (fallbackResponse.ok) {
              response = fallbackResponse;
            } else {
              errors.push(buildFrameFetchError(item.url, fallbackResponse));
              continue;
            }
          }
          if (!response.ok) {
            errors.push(buildFrameFetchError(item.url, response));
            continue;
          }
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (contentType && !contentType.startsWith('image/')) {
            errors.push(`Frame URL did not return an image: ${getHostFromUrl(item.url)} (${contentType})`);
            continue;
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          if (!buffer.byteLength) {
            errors.push(`Frame URL returned empty content: ${getHostFromUrl(item.url)}`);
            continue;
          }
          frames.push({ buffer, filename: getFilenameFromUrl(item.url) });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Network error';
          errors.push(`Failed to fetch frame from ${getHostFromUrl(item.url)} (${message})`);
        }
      }
    }

    if (errors.length) {
      return NextResponse.json(
        {
          error: 'Failed to build animation from one or more frames',
          details: errors,
          totalRequested: items.length,
          validFrames: frames.length,
        },
        { status: 400 }
      );
    }

    if (frames.length < 2) {
      return NextResponse.json({ error: 'Select at least two valid images' }, { status: 400 });
    }

    const delayMs = Math.max(1, Math.round(1000 / fps));

    const animated = await buildAnimatedWebpFromFrames(frames, { fps, loop, delayMs });

    const outputName = filenameRaw
      ? normalizeFilename(filenameRaw.replace(/\.webp$/i, '')) + '.webp'
      : `animated-${Date.now()}.webp`;

    const outcome = await uploadImageBuffer({
      buffer: animated.buffer,
      originalBuffer: animated.buffer,
      fileName: outputName,
      fileType: 'image/webp',
      fileSize: animated.bytes,
      context: {
        accountId,
        apiToken,
        folder: folder && folder.trim() ? folder.trim() : undefined,
        tags: Array.from(new Set([...cleanTags, 'animated-webp'])),
        description: description && description.trim() ? description.trim() : undefined,
        originalUrl: originalUrl && originalUrl.trim() ? originalUrl.trim() : undefined,
        sourceUrl: sourceUrl && sourceUrl.trim() ? sourceUrl.trim() : undefined,
        namespace: namespace && namespace.trim() ? namespace.trim() : undefined,
        parentId: resolvedParentId
      }
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (error) {
    console.error('Animate upload error:', error);
    return NextResponse.json({ error: 'Failed to create animation' }, { status: 500 });
  }
}
