import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';

const enrichImageAssetMetadataMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/assetMetadataEnrichment', () => ({
  enrichImageAssetMetadata: enrichImageAssetMetadataMock,
}));

const makeImage = (id: string, metadata: Partial<CachedCloudflareImage> = {}): CachedCloudflareImage => ({
  id,
  filename: `${id}.jpg`,
  uploaded: '2026-07-21T00:00:00.000Z',
  variants: [`https://imagedelivery.net/hash/${id}/small`],
  tags: [],
  ...metadata,
});

describe('aspect metadata hydration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearAspectMetadataHydrationState } = await import('@/server/aspectMetadataHydration');
    clearAspectMetadataHydrationState();
  });

  it('hydrates missing records instead of treating partial side-index coverage as the corpus', async () => {
    const known = makeImage('known', {
      aspectRatio: '1:1',
      dimensions: { width: 1200, height: 1200 },
    });
    const missing = makeImage('missing');
    enrichImageAssetMetadataMock.mockResolvedValue({
      ...missing,
      aspectRatio: '16:9',
      dimensions: { width: 1600, height: 900 },
    });

    const { hydrateMissingAspectMetadata } = await import('@/server/aspectMetadataHydration');
    const result = await hydrateMissingAspectMetadata([known, missing]);

    expect(enrichImageAssetMetadataMock).toHaveBeenCalledWith(missing, { includeSize: false });
    expect(result.images).toEqual([
      known,
      expect.objectContaining({
        id: 'missing',
        aspectRatio: '16:9',
        dimensions: { width: 1600, height: 900 },
      }),
    ]);
    expect(result.candidateCount).toBe(1);
    expect(result.resolvedCount).toBe(2);
    expect(result.unresolvedCount).toBe(0);
  });

  it('does not repeatedly probe a record that could not be resolved during the retry window', async () => {
    const missing = makeImage('missing');
    enrichImageAssetMetadataMock.mockResolvedValue(missing);

    const { hydrateMissingAspectMetadata } = await import('@/server/aspectMetadataHydration');
    await hydrateMissingAspectMetadata([missing]);
    await hydrateMissingAspectMetadata([missing]);

    expect(enrichImageAssetMetadataMock).toHaveBeenCalledTimes(1);
  });
});
