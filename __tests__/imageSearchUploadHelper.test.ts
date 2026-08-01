import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const {
  getCachedImagesMock,
  listVideoAssetRecordsWithSyncMock,
  searchByCLIPMock,
  isVectorSearchAvailableMock,
  generateClipEmbeddingFromBytesMock,
  findDuplicatesByContentHashMock,
  prepareImageForUploadMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  searchByCLIPMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  generateClipEmbeddingFromBytesMock: vi.fn(),
  findDuplicatesByContentHashMock: vi.fn(),
  prepareImageForUploadMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  searchByCLIP: searchByCLIPMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

vi.mock('@/server/embeddingService', () => ({
  generateClipEmbeddingFromBytes: generateClipEmbeddingFromBytesMock,
}));

vi.mock('@/server/duplicateDetector', () => ({
  findDuplicatesByContentHash: findDuplicatesByContentHashMock,
}));

vi.mock('@/server/uploadPreparation', () => ({
  prepareImageForUpload: prepareImageForUploadMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecords: vi.fn(),
  listImageExtrasImageIds: vi.fn().mockResolvedValue([]),
}));

import {
  findExactCatalogMatches,
  prepareReferenceForClip,
  searchByReferenceImage,
  ReferenceDecodeError,
} from '@/server/imageSearchUpload';

const sha256Hex = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

const makeCatalogImage = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.png`,
  uploaded: '2026-01-01T00:00:00Z',
  variants: [],
  ...overrides,
});

const makePngBuffer = async () =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();

const baseOptions = {
  fileName: 'reference.png',
  fileType: 'image/png',
  limit: 10,
  namespace: null as string | null,
};

describe('prepareReferenceForClip', () => {
  it('downscales a decodable image to a jpeg buffer', async () => {
    const png = await makePngBuffer();
    const prepared = await prepareReferenceForClip(png);
    const metadata = await sharp(prepared).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(512);
  });

  it('throws ReferenceDecodeError on undecodable bytes', async () => {
    await expect(prepareReferenceForClip(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      ReferenceDecodeError
    );
  });
});

describe('findExactCatalogMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches on the raw-bytes hash', async () => {
    const raw = Buffer.from('raw-bytes');
    const match = makeCatalogImage('img-raw');
    prepareImageForUploadMock.mockResolvedValue({ ok: false, error: 'nope' });
    findDuplicatesByContentHashMock.mockImplementation(async (hash: string) =>
      hash === sha256Hex(raw) ? [match] : []
    );

    const matches = await findExactCatalogMatches(raw, 'ref.png', 'image/png');
    expect(matches).toEqual([match]);
  });

  it('also matches on the prepared-buffer hash and dedupes by id', async () => {
    const raw = Buffer.from('raw-bytes');
    const prepared = Buffer.from('prepared-bytes');
    const match = makeCatalogImage('img-prepared');
    prepareImageForUploadMock.mockResolvedValue({ ok: true, data: { buffer: prepared } });
    findDuplicatesByContentHashMock.mockImplementation(async (hash: string) =>
      hash === sha256Hex(prepared) ? [match] : []
    );

    const matches = await findExactCatalogMatches(raw, 'ref.png', 'image/png');
    expect(matches).toEqual([match]);
    expect(findDuplicatesByContentHashMock).toHaveBeenCalledTimes(2);
  });
});

describe('searchByReferenceImage', () => {
  let png: Buffer;

  beforeEach(async () => {
    vi.clearAllMocks();
    png = await makePngBuffer();
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    prepareImageForUploadMock.mockResolvedValue({ ok: false, error: 'skip' });
    findDuplicatesByContentHashMock.mockResolvedValue([]);
    isVectorSearchAvailableMock.mockResolvedValue(true);
    generateClipEmbeddingFromBytesMock.mockResolvedValue(new Array(512).fill(0.1));
    searchByCLIPMock.mockResolvedValue([]);
    getCachedImagesMock.mockResolvedValue([
      makeCatalogImage('img-1', { hasClipEmbedding: true }),
      makeCatalogImage('img-2', { hasClipEmbedding: true, tags: ['x-clip'] }),
      makeCatalogImage('img-3', { hasClipEmbedding: true, tags: ['x-search'] }),
      makeCatalogImage('img-4', { hasClipEmbedding: false, namespace: 'ns1' }),
    ]);
  });

  it('filters out images with x-clip and x-search exclusion tags', async () => {
    searchByCLIPMock.mockResolvedValue([
      { imageId: 'img-1', score: 0.1 },
      { imageId: 'img-2', score: 0.2 },
      { imageId: 'img-3', score: 0.3 },
    ]);

    const outcome = await searchByReferenceImage(png, { ...baseOptions });
    expect(outcome.results.map((r) => r.imageId)).toEqual(['img-1']);
    expect(outcome.warnings).toEqual([]);
  });

  it('scopes similar results to the requested namespace', async () => {
    searchByCLIPMock.mockResolvedValue([
      { imageId: 'img-1', score: 0.1 },
      { imageId: 'img-4', score: 0.2 },
    ]);

    const outcome = await searchByReferenceImage(png, { ...baseOptions, namespace: 'ns1' });
    expect(outcome.results.map((r) => r.imageId)).toEqual(['img-4']);
  });

  it('dedupes exact matches out of the similar list and keeps them exact', async () => {
    findDuplicatesByContentHashMock.mockResolvedValue([makeCatalogImage('img-1')]);
    searchByCLIPMock.mockResolvedValue([
      { imageId: 'img-1', score: 0.01 },
      { imageId: 'img-4', score: 0.2 },
    ]);

    const outcome = await searchByReferenceImage(png, { ...baseOptions });
    expect(outcome.exactMatches.map((r) => r.imageId)).toEqual(['img-1']);
    expect(outcome.exactMatches[0].matchType).toBe('exact');
    expect(outcome.exactMatches[0].score).toBe(1);
    expect(outcome.results.map((r) => r.imageId)).toEqual(['img-4']);
  });

  it('surfaces exact matches even when vector search is down', async () => {
    isVectorSearchAvailableMock.mockResolvedValue(false);
    findDuplicatesByContentHashMock.mockResolvedValue([makeCatalogImage('img-1')]);

    const outcome = await searchByReferenceImage(png, { ...baseOptions });
    expect(outcome.exactMatches.map((r) => r.imageId)).toEqual(['img-1']);
    expect(outcome.results).toEqual([]);
    expect(outcome.warnings).toEqual(['vector-search-unavailable']);
    expect(generateClipEmbeddingFromBytesMock).not.toHaveBeenCalled();
  });

  it('warns when the embedding provider returns null', async () => {
    generateClipEmbeddingFromBytesMock.mockResolvedValue(null);

    const outcome = await searchByReferenceImage(png, { ...baseOptions });
    expect(outcome.results).toEqual([]);
    expect(outcome.warnings).toEqual(['clip-unavailable']);
    expect(searchByCLIPMock).not.toHaveBeenCalled();
  });

  it('reports embedding coverage counts', async () => {
    const outcome = await searchByReferenceImage(png, { ...baseOptions });
    expect(outcome.coverage).toEqual({ totalImages: 4, withClip: 3, notIndexed: 1 });
  });

  it('rejects undecodable references before touching the catalog', async () => {
    await expect(
      searchByReferenceImage(Buffer.from('garbage'), { ...baseOptions })
    ).rejects.toBeInstanceOf(ReferenceDecodeError);
    expect(findDuplicatesByContentHashMock).not.toHaveBeenCalled();
  });
});
