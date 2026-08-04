import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getAssetPreviewUrl,
  getSvgOriginalDownloadUrl,
  resolveSvgOriginalAssetId,
} from '@/utils/assetUrls';
import { getCloudflareSvgOriginalUrl } from '@/utils/imageUtils';

const HASH = 'testhash';
let priorHash: string | undefined;

beforeAll(() => {
  priorHash = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
  process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH = HASH;
});

afterAll(() => {
  if (priorHash === undefined) delete process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
  else process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH = priorHash;
});

describe('SVG URL resolution', () => {
  it('getCloudflareSvgOriginalUrl never appends format=webp', () => {
    const url = getCloudflareSvgOriginalUrl('svg-id');
    expect(url).toBe(`https://imagedelivery.net/${HASH}/svg-id/public`);
    expect(url).not.toContain('format=webp');
  });

  it('routes an SVG with a linked WebP variant to the variant id', () => {
    const url = getAssetPreviewUrl({ id: 'svg-id', filename: 'logo.svg', linkedAssetId: 'webp-id' });
    expect(url).toContain('/webp-id/');
    expect(url).not.toContain('/svg-id/');
  });

  it('falls back to the raw SVG original (no format=webp) when no variant exists', () => {
    const url = getAssetPreviewUrl({ id: 'svg-id', filename: 'logo.svg' });
    expect(url).toBe(`https://imagedelivery.net/${HASH}/svg-id/public`);
    expect(url).not.toContain('format=webp');
  });

  it('leaves raster assets on their own id with format negotiation intact', () => {
    const url = getAssetPreviewUrl({ id: 'png-id', filename: 'photo.png' });
    expect(url).toContain('/png-id/');
    expect(url).toContain('format=webp');
  });
});

describe('vector original retrieval', () => {
  it('resolves the SVG id from the SVG half of a pair', () => {
    expect(
      resolveSvgOriginalAssetId({ id: 'svg-id', filename: 'logo.svg', linkedAssetId: 'webp-id' })
    ).toBe('svg-id');
  });

  it('resolves the SVG id from the rasterized companion', () => {
    // linkedAssetId is written only for the SVG pairing, so the partner is the vector.
    expect(
      resolveSvgOriginalAssetId({ id: 'webp-id', filename: 'logo.webp', linkedAssetId: 'svg-id' })
    ).toBe('svg-id');
  });

  it('returns undefined for an ordinary raster asset', () => {
    expect(resolveSvgOriginalAssetId({ id: 'png-id', filename: 'photo.png' })).toBeUndefined();
    expect(getSvgOriginalDownloadUrl({ id: 'png-id', filename: 'photo.png' })).toBeUndefined();
  });

  it('builds a download URL for the stored original bytes, not a delivery variant', () => {
    const url = getSvgOriginalDownloadUrl({
      id: 'webp-id',
      filename: 'logo.webp',
      linkedAssetId: 'svg-id',
    });
    expect(url).toBe('/api/images/svg-id/download?variant=original');
    expect(url).not.toContain('imagedelivery.net');
  });
});
