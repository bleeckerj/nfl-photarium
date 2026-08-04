/**
 * SVG uploads land as a two-record family: a rasterized WebP companion and the
 * vector original. The WebP is the family head — it is natively raster, so search,
 * vision and Cloudflare transforms all work against it, and the pair collapses to a
 * single canonical gallery entry.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cloudflareImageCache from '@/server/cloudflareImageCache';
import * as duplicateDetector from '@/server/duplicateDetector';
import { uploadImageBuffer } from '@/server/uploadService';

const ORIGINAL_ENV = { ...process.env };

const SVG = (seed: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">` +
      `<title>${seed}</title><rect width="120" height="40" fill="#FF2D55"/></svg>`,
    'utf8'
  );

type Upload = { id: string; metadata: Record<string, unknown>; filename: string };

/**
 * Stand in for Cloudflare Images: records every upload and PATCH so the resulting
 * family shape can be asserted. Returns ids in upload order (svg first, webp second).
 */
const stubCloudflare = () => {
  const uploads: Upload[] = [];
  const patches: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  let counter = 0;

  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const href = String(url);

    if (href.endsWith('/images/v1') && init?.method === 'POST') {
      const body = init.body as FormData;
      const file = body.get('file') as File;
      const metadata = JSON.parse(String(body.get('metadata') ?? '{}'));
      counter += 1;
      const id = `cf-${counter}`;
      uploads.push({ id, metadata, filename: file?.name ?? '' });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              id,
              filename: file?.name ?? '',
              uploaded: '2026-08-02T00:00:00.000Z',
              variants: [`https://imagedelivery.net/hash/${id}/public`],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    if (init?.method === 'PATCH') {
      const id = href.split('/').pop() ?? '';
      const payload = JSON.parse(String(init.body ?? '{}'));
      patches.push({ id, metadata: payload.metadata ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ result: { images: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  return { uploads, patches };
};

const runUpload = async (seed: string, parentId?: string) => {
  const buffer = SVG(seed);
  return await uploadImageBuffer({
    buffer,
    originalBuffer: buffer,
    fileName: 'logo.svg',
    fileType: 'image/svg+xml',
    fileSize: buffer.byteLength,
    context: {
      accountId: 'acct',
      apiToken: 'token',
      tags: [],
      namespace: 'test-namespace',
      parentId,
    },
  });
};

describe('SVG upload family shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.AUTO_EMBED_ON_UPLOAD = '0';

    vi.spyOn(duplicateDetector, 'findDuplicatesByOriginalUrl').mockResolvedValue([]);
    vi.spyOn(duplicateDetector, 'findDuplicatesByContentHash').mockResolvedValue([]);
    vi.spyOn(cloudflareImageCache, 'getCachedImages').mockResolvedValue([]);
    vi.spyOn(cloudflareImageCache, 'upsertCachedImage').mockResolvedValue(undefined as never);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uploads the vector plus a rasterized WebP companion', async () => {
    const { uploads } = stubCloudflare();
    const outcome = await runUpload('pair');

    expect(outcome.ok).toBe(true);
    expect(uploads).toHaveLength(2);
    expect(uploads[0].filename).toBe('logo.svg');
    expect(uploads[1].filename).toBe('logo.webp');
  });

  it('describes the companion as a WebP rather than inheriting the SVG type and size', async () => {
    const { uploads } = stubCloudflare();
    await runUpload('metadata');

    const companion = uploads[1].metadata;
    expect(companion.type).toBe('image/webp');
    // Must be the WebP's own byte length, not the SVG's.
    expect(companion.size).not.toBe(uploads[0].metadata.size);
    expect(typeof companion.size).toBe('number');
  });

  it('parents the SVG to its companion when no parent was requested', async () => {
    const { uploads, patches } = stubCloudflare();
    const outcome = await runUpload('parenting');

    const svgId = uploads[0].id;
    const webpId = uploads[1].id;

    // The companion is the family root.
    expect(uploads[1].metadata.variationParentId).toBeUndefined();

    const svgPatch = patches.find((patch) => patch.id === svgId);
    expect(svgPatch?.metadata.variationParentId).toBe(webpId);
    expect(svgPatch?.metadata.linkedAssetId).toBe(webpId);

    if (outcome.ok) {
      expect(outcome.data.parentId).toBe(webpId);
      expect(outcome.data.linkedAssetId).toBe(webpId);
    }
  });

  it('keeps both records as siblings when uploading into an existing family', async () => {
    const existingParent = 'existing-root';
    // validateParentForNewChild resolves the canonical parent from the cache.
    vi.spyOn(cloudflareImageCache, 'getCachedImages').mockResolvedValue([
      {
        id: existingParent,
        filename: 'root.png',
        uploaded: '2026-08-01T00:00:00.000Z',
        variants: [`https://imagedelivery.net/hash/${existingParent}/public`],
        namespace: 'test-namespace',
      },
    ] as never);

    const { uploads, patches } = stubCloudflare();
    const outcome = await runUpload('sibling', existingParent);

    const svgId = uploads[0].id;
    const svgPatch = patches.find((patch) => patch.id === svgId);

    // Families are flat (imageFamily.ts) — chaining svg -> webp -> root is not representable.
    expect(uploads[1].metadata.variationParentId).toBe(existingParent);
    expect(svgPatch?.metadata.variationParentId).toBe(existingParent);
    if (outcome.ok) {
      expect(outcome.data.parentId).toBe(existingParent);
    }
  });

  it('does not queue embeddings for the vector half', async () => {
    stubCloudflare();
    process.env.AUTO_EMBED_ON_UPLOAD = '1';
    const outcome = await runUpload('embeddings');

    if (outcome.ok) {
      expect(outcome.data.autoEmbeddings?.queued).toBe(false);
      expect(outcome.data.autoEmbeddings?.reason).toBe('deferred-to-raster-companion');
    }
  });
});
