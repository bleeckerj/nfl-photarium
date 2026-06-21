import { NextRequest, NextResponse } from 'next/server';
import { getUploadDownloadInfo } from '@/server/cloudflareUploadsService';
import { uploadImageBuffer } from '@/server/uploadService';
import { buildAnimatedWebpFromFrames } from '@/server/animatedWebpService';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { normalizeSpecificNamespace } from '@/server/uploadNamespace';

const normalizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9-_\.]/g, '_');

const resolveSelectionNamespace = (
  requestedNamespace: string | undefined,
  sourceNamespaces: Array<string | undefined>
) => {
  const normalizedRequest = normalizeSpecificNamespace(requestedNamespace);
  if (normalizedRequest) return { ok: true as const, namespace: normalizedRequest };

  const namespaces = Array.from(new Set(sourceNamespaces.map(normalizeSpecificNamespace).filter(Boolean)));
  if (namespaces.length === 1) return { ok: true as const, namespace: namespaces[0] };
  if (namespaces.length > 1) {
    return {
      ok: false as const,
      error: 'Selected images span multiple namespaces. Select images from one namespace or switch to a specific namespace before creating an animation.',
    };
  }
  return {
    ok: false as const,
    error: 'Selected images are missing namespace metadata and cannot be used to create an animation from All namespaces.',
  };
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
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : [];
    if (ids.length < 2) {
      return NextResponse.json({ error: 'Select at least two images' }, { status: 400 });
    }

    const fps = Number(body?.fps);
    if (!Number.isFinite(fps) || fps <= 0) {
      return NextResponse.json({ error: 'FPS must be greater than 0' }, { status: 400 });
    }
    const delayMs = Math.max(1, Math.round(1000 / fps));
    const loop = body?.loop !== false;

    const filenameRaw = typeof body?.filename === 'string' ? body.filename.trim() : '';
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : undefined;
    const orderMode = body?.orderMode === 'reverse-gallery' ? 'reverse-gallery' : 'gallery';

    const downloadInfos: Array<{ id: string; url: string; filename: string; namespace?: string }> = [];
    for (const id of ids) {
      const { url, filename, namespace: sourceNamespace } = await getUploadDownloadInfo(id);
      downloadInfos.push({ id, url, filename, namespace: sourceNamespace });
    }

    const namespaceResolution = resolveSelectionNamespace(
      namespace,
      downloadInfos.map((info) => info.namespace)
    );
    if (!namespaceResolution.ok) {
      return NextResponse.json({ error: namespaceResolution.error }, { status: 400 });
    }

    const frames: { buffer: Buffer; filename: string }[] = [];
    for (const { id, url, filename } of downloadInfos) {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        return NextResponse.json({ error: `Failed to download image ${id}` }, { status: 502 });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      frames.push({ buffer, filename });
    }

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
        tags: ['animated-webp'],
        namespace: namespaceResolution.namespace
      }
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    await patchImageExtrasRecord(outcome.data.id, {
      animatedWebp: {
        sourceImageIds: ids,
        sourceFilenames: frames.map((frame) => frame.filename),
        orderMode,
        fps,
        loop,
        generatedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json(outcome.data);
  } catch (error) {
    console.error('Animate selection error:', error);
    return NextResponse.json({ error: 'Failed to create animation' }, { status: 500 });
  }
}
