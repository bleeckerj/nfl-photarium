import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getUploadDownloadInfo } from '@/server/cloudflareUploadsService';
import { uploadImageBuffer } from '@/server/uploadService';

const normalizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9-_\.]/g, '_');

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

    const frames: Buffer[] = [];
    for (const id of ids) {
      const { url } = await getUploadDownloadInfo(id);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        return NextResponse.json({ error: `Failed to download image ${id}` }, { status: 502 });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      frames.push(buffer);
    }

    const metas = await Promise.all(frames.map((frame) => sharp(frame).metadata()));
    const widths = metas.map((meta) => meta.width || 0).filter(Boolean);
    const heights = metas.map((meta) => meta.height || 0).filter(Boolean);
    const maxWidth = Math.max(...widths, 1);
    const maxHeight = Math.max(...heights, 1);

    const preparedFrames = await Promise.all(
      frames.map(async (frame) =>
        sharp(frame)
          .resize(maxWidth, maxHeight, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .ensureAlpha()
          .raw()
          .toBuffer()
      )
    );

    const stacked = Buffer.concat(preparedFrames);
    const animatedBuffer = await sharp(stacked, {
      raw: {
        width: maxWidth,
        height: maxHeight * preparedFrames.length,
        channels: 4,
        pageHeight: maxHeight
      }
    })
      .webp({ loop: loop ? 0 : 1, delay: Array(preparedFrames.length).fill(delayMs) })
      .toBuffer();

    const outputName = filenameRaw
      ? normalizeFilename(filenameRaw.replace(/\.webp$/i, '')) + '.webp'
      : `animated-${Date.now()}.webp`;

    const outcome = await uploadImageBuffer({
      buffer: animatedBuffer,
      originalBuffer: animatedBuffer,
      fileName: outputName,
      fileType: 'image/webp',
      fileSize: animatedBuffer.byteLength,
      context: {
        accountId,
        apiToken,
        tags: [],
        namespace: namespace && namespace !== '__all__' ? namespace : undefined
      }
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (error) {
    console.error('Animate selection error:', error);
    return NextResponse.json({ error: 'Failed to create animation' }, { status: 500 });
  }
}
