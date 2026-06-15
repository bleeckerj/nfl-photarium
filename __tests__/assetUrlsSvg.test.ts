import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAssetPreviewUrl } from '@/utils/assetUrls';
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
