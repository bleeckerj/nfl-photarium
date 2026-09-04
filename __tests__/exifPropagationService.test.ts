import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedImages: vi.fn(),
  getImageExtrasRecord: vi.fn(),
  getImageExtrasRecords: vi.fn(),
  patchImageExtrasRecord: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({ getCachedImages: mocks.getCachedImages }));
vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: mocks.getImageExtrasRecord,
  getImageExtrasRecords: mocks.getImageExtrasRecords,
  patchImageExtrasRecord: mocks.patchImageExtrasRecord,
}));

import { ExifPropagationError, propagateImageExif } from '@/server/exifPropagationService';

const image = (id: string, parentId?: string, exif?: Record<string, string | number>) => ({
  id,
  filename: `${id}.jpg`,
  uploaded: '2026-09-01T00:00:00.000Z',
  variants: [],
  parentId,
  exif,
});

const sourceExif = { make: 'Apple', model: 'iPhone 6', iso: 32 };

describe('propagateImageExif', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImageExtrasRecords.mockResolvedValue({});
    mocks.patchImageExtrasRecord.mockResolvedValue({});
  });

  it('pushes a parent EXIF to every child that has none, skipping children that already have it', async () => {
    mocks.getCachedImages.mockResolvedValue([
      image('root'),
      image('child-a', 'root'),
      image('child-b', 'root'),
      image('unrelated'),
    ]);
    mocks.getImageExtrasRecord.mockResolvedValue({ exif: sourceExif });
    mocks.getImageExtrasRecords.mockResolvedValue({
      'child-a': null,
      'child-b': { exif: { summary: { make: 'Canon' } } },
    });

    const result = await propagateImageExif('root');

    expect(result.relation).toBe('parent');
    expect(result.familyRootId).toBe('root');
    expect(result.targetIds).toEqual(['child-a', 'child-b']);
    expect(result.updatedIds).toEqual(['child-a']);
    expect(result.skipped).toEqual([{ id: 'child-b', reason: 'already-has-exif' }]);
    expect(result.failed).toEqual([]);
    expect(mocks.patchImageExtrasRecord).toHaveBeenCalledTimes(1);
    expect(mocks.patchImageExtrasRecord).toHaveBeenCalledWith('child-a', { exif: sourceExif });
  });

  it('pushes a child EXIF to its parent and siblings, overwriting when asked', async () => {
    mocks.getCachedImages.mockResolvedValue([
      image('root', undefined, { make: 'Canon' }),
      image('child-a', 'root'),
      image('child-b', 'root'),
    ]);
    mocks.getImageExtrasRecord.mockResolvedValue({ exif: sourceExif });

    const result = await propagateImageExif('child-a', { mode: 'overwrite' });

    expect(result.relation).toBe('child');
    expect(result.familyRootId).toBe('root');
    expect(result.targetIds).toEqual(['root', 'child-b']);
    expect(result.updatedIds).toEqual(['root', 'child-b']);
    expect(result.skipped).toEqual([]);
    expect(mocks.patchImageExtrasRecord).toHaveBeenCalledWith('root', { exif: sourceExif });
    expect(mocks.patchImageExtrasRecord).toHaveBeenCalledWith('child-b', { exif: sourceExif });
  });

  it('falls back to cached Cloudflare EXIF when the extras record has none', async () => {
    mocks.getCachedImages.mockResolvedValue([image('root', undefined, sourceExif), image('child', 'root')]);
    mocks.getImageExtrasRecord.mockResolvedValue(null);

    const result = await propagateImageExif('root');

    expect(result.exif).toEqual(sourceExif);
    expect(result.updatedIds).toEqual(['child']);
  });

  it('treats cached EXIF on a target as existing EXIF in fill-missing mode', async () => {
    mocks.getCachedImages.mockResolvedValue([image('root'), image('child', 'root', { make: 'Canon' })]);
    mocks.getImageExtrasRecord.mockResolvedValue({ exif: sourceExif });

    const result = await propagateImageExif('root');

    expect(result.updatedIds).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'child', reason: 'already-has-exif' }]);
    expect(mocks.patchImageExtrasRecord).not.toHaveBeenCalled();
  });

  it('reports the plan without writing in dry-run mode', async () => {
    mocks.getCachedImages.mockResolvedValue([image('root'), image('child', 'root')]);
    mocks.getImageExtrasRecord.mockResolvedValue({ exif: sourceExif });

    const result = await propagateImageExif('root', { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.updatedIds).toEqual(['child']);
    expect(mocks.patchImageExtrasRecord).not.toHaveBeenCalled();
  });

  it('collects per-target failures while finishing the batch', async () => {
    mocks.getCachedImages.mockResolvedValue([image('root'), image('child-a', 'root'), image('child-b', 'root')]);
    mocks.getImageExtrasRecord.mockResolvedValue({ exif: sourceExif });
    mocks.patchImageExtrasRecord.mockImplementation(async (id: string) => {
      if (id === 'child-a') throw new Error('redis down');
      return {};
    });

    const result = await propagateImageExif('root');

    expect(result.updatedIds).toEqual(['child-b']);
    expect(result.failed).toEqual([{ id: 'child-a', status: 500, message: 'redis down' }]);
  });

  it('rejects a missing image and an image without EXIF', async () => {
    mocks.getCachedImages.mockResolvedValue([image('root')]);
    mocks.getImageExtrasRecord.mockResolvedValue(null);

    await expect(propagateImageExif('nope')).rejects.toMatchObject({ status: 404 });
    await expect(propagateImageExif('root')).rejects.toBeInstanceOf(ExifPropagationError);
    await expect(propagateImageExif('root')).rejects.toMatchObject({ status: 400 });
  });
});
