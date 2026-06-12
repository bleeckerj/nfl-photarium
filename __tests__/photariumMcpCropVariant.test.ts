import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { computeWidthPreservingCrop } from '../mcp-server/src/runtime/upload/crop-variant.js';

const realFetch = global.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function imageDownloadResponse(buffer: Buffer, filename: string, contentType: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(buffer.byteLength),
      'content-disposition': `inline; filename="${filename}"`,
    },
  });
}

async function createStillFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 180,
      channels: 4,
      background: '#cc3366',
    },
  })
    .png()
    .toBuffer();
}

async function createAnimatedFixture(): Promise<Buffer> {
  const frameWidth = 8;
  const frameHeight = 12;
  const frames = await Promise.all(
    ['#ff0000', '#00ff00', '#0000ff'].map((background) =>
      sharp({
        create: {
          width: frameWidth,
          height: frameHeight,
          channels: 4,
          background,
        },
      })
        .raw()
        .toBuffer()
    )
  );

  return sharp(Buffer.concat(frames), {
    raw: {
      width: frameWidth,
      height: frameHeight * frames.length,
      channels: 4,
      pageHeight: frameHeight,
    },
  })
    .webp({ delay: [120, 240, 360], loop: 0, quality: 100, effort: 1 })
    .toBuffer();
}

async function invokeCropVariant(args: Record<string, unknown>) {
  process.env.PHOTARIUM_BASE_URL = 'http://photarium.test';
  vi.resetModules();
  const { handleRuntimeToolCall } = await import('../mcp-server/src/runtime/index.js');
  return handleRuntimeToolCall('photarium_crop_variant', args);
}

describe('photarium_crop_variant', () => {
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.PHOTARIUM_BASE_URL;
    vi.restoreAllMocks();
  });

  it('computes width-preserving crop geometry for supported anchors', () => {
    expect(computeWidthPreservingCrop({ sourceWidth: 100, sourceHeight: 180, aspectRatio: '4:5', anchor: 'bottom' })).toMatchObject({
      width: 100,
      height: 125,
      x: 0,
      y: 55,
    });
    expect(computeWidthPreservingCrop({ sourceWidth: 100, sourceHeight: 180, aspectRatio: '1:1', anchor: 'top' })).toMatchObject({
      width: 100,
      height: 100,
      y: 0,
    });
    expect(computeWidthPreservingCrop({ sourceWidth: 100, sourceHeight: 180, aspectRatio: '1:1', anchor: 'center' })).toMatchObject({
      width: 100,
      height: 100,
      y: 40,
    });
    expect(() =>
      computeWidthPreservingCrop({ sourceWidth: 100, sourceHeight: 80, aspectRatio: '4:5', anchor: 'bottom' })
    ).toThrow(/needs 125px height/i);
  });

  it('uploads a still WebP crop as a parented variant', async () => {
    const sourceBuffer = await createStillFixture();
    let uploadedFile: File | undefined;
    let uploadedParentId: FormDataEntryValue | null = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const requestUrl = new URL(url);
      if (requestUrl.pathname === '/api/images/source-still') {
        return jsonResponse({
          image: {
            id: 'source-still',
            filename: 'barn.png',
            url: 'https://cdn.test/source-still/public',
            meta: { namespace: 'farm', tags: ['cow'] },
            originalUrl: 'https://example.com/source.png',
          },
        });
      }
      if (requestUrl.pathname === '/api/images/source-still/download') {
        expect(requestUrl.searchParams.get('variant')).toBe('original');
        return imageDownloadResponse(sourceBuffer, 'barn.png', 'image/png');
      }
      if (requestUrl.pathname === '/api/upload' && init?.method === 'POST') {
        const form = init.body as FormData;
        uploadedFile = form.get('file') as File;
        uploadedParentId = form.get('parentId');
        return jsonResponse({
          id: 'crop-still',
          filename: uploadedFile.name,
          url: 'https://cdn.test/crop-still/public',
          variants: ['https://cdn.test/crop-still/public'],
          parentId: uploadedParentId,
          displayName: form.get('displayName'),
        });
      }
      return jsonResponse({ error: `Unhandled ${requestUrl.pathname}` }, 404);
    }) as typeof global.fetch;

    const result = await invokeCropVariant({ imageId: 'source-still', aspectRatio: '4:5', anchor: 'bottom' });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text || '{}') as {
      crop: { width: number; height: number; y: number };
      parentId: string;
      mimeType: string;
    };

    expect(payload.parentId).toBe('source-still');
    expect(payload.crop).toMatchObject({ width: 100, height: 125, y: 55 });
    expect(payload.mimeType).toBe('image/webp');
    expect(uploadedParentId).toBe('source-still');
    expect(uploadedFile?.type).toBe('image/webp');

    const uploadedMeta = await sharp(Buffer.from(await uploadedFile!.arrayBuffer())).metadata();
    expect(uploadedMeta.width).toBe(100);
    expect(uploadedMeta.height).toBe(125);
  });

  it('preserves animated frame count and delays when uploading an animated crop', async () => {
    const sourceBuffer = await createAnimatedFixture();
    let uploadedFile: File | undefined;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const requestUrl = new URL(url);
      if (requestUrl.pathname === '/api/images/source-animated') {
        return jsonResponse({
          image: {
            id: 'source-animated',
            filename: 'motion.webp',
            url: 'https://cdn.test/source-animated/public',
            meta: { namespace: 'farm', tags: ['animated-webp'] },
          },
        });
      }
      if (requestUrl.pathname === '/api/images/source-animated/download') {
        return imageDownloadResponse(sourceBuffer, 'motion.webp', 'image/webp');
      }
      if (requestUrl.pathname === '/api/upload' && init?.method === 'POST') {
        const form = init.body as FormData;
        uploadedFile = form.get('file') as File;
        return jsonResponse({
          id: 'crop-animated',
          filename: uploadedFile.name,
          url: 'https://cdn.test/crop-animated/public',
          variants: ['https://cdn.test/crop-animated/public'],
          parentId: form.get('parentId'),
        });
      }
      return jsonResponse({ error: `Unhandled ${requestUrl.pathname}` }, 404);
    }) as typeof global.fetch;

    const result = await invokeCropVariant({ imageId: 'source-animated', aspectRatio: '1:1', anchor: 'bottom' });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text || '{}') as {
      crop: { width: number; height: number; y: number };
      animated: { frameCount: number; delaysPreserved: boolean };
    };

    expect(payload.crop).toMatchObject({ width: 8, height: 8, y: 4 });
    expect(payload.animated).toEqual({ frameCount: 3, delaysPreserved: true });

    const uploadedBuffer = Buffer.from(await uploadedFile!.arrayBuffer());
    const metadata = await sharp(uploadedBuffer, { animated: true }).metadata();
    expect(metadata.width).toBe(8);
    expect(metadata.pageHeight).toBe(8);
    expect(metadata.pages).toBe(3);
    expect((metadata as sharp.Metadata & { delay?: number[] }).delay).toEqual([120, 240, 360]);
  });
});
