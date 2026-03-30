import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findDuplicatesByOriginalUrlMock,
  findDuplicatesByContentHashMock,
  getCachedImagesMock,
} = vi.hoisted(() => ({
  findDuplicatesByOriginalUrlMock: vi.fn(),
  findDuplicatesByContentHashMock: vi.fn(),
  getCachedImagesMock: vi.fn(),
}));

vi.mock('@/server/duplicateDetector', () => ({
  findDuplicatesByOriginalUrl: findDuplicatesByOriginalUrlMock,
  findDuplicatesByContentHash: findDuplicatesByContentHashMock,
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

import {
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logCrossNamespaceContentHashWarning,
  logDuplicateFamilySelection,
  logOriginalUrlReuseWarning,
} from '@/server/uploadDuplicatePolicy';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';

const makeImage = (overrides?: Record<string, unknown>) =>
  ({
    id: 'img-default',
    filename: 'default.png',
    uploaded: '2026-01-01T00:00:00.000Z',
    folder: 'folder-default',
    ...overrides,
  }) as CachedCloudflareImage;

describe('uploadDuplicatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImagesMock.mockResolvedValue([]);
  });

  it('returns URL warning and hash duplicates with default reject behavior', async () => {
    const urlMatch = makeImage({ id: 'url-1', folder: 'url-folder' });
    const hashMatch = makeImage({ id: 'hash-1', folder: 'hash-folder', namespace: 'nfl' });

    findDuplicatesByOriginalUrlMock.mockResolvedValueOnce([urlMatch]);
    findDuplicatesByContentHashMock.mockResolvedValueOnce([hashMatch]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'a'.repeat(64),
      normalizedOriginalUrl: 'https://example.com/dynamic-image',
      namespace: 'nfl',
    });

    expect(findDuplicatesByOriginalUrlMock).toHaveBeenCalledWith(
      'https://example.com/dynamic-image',
      'nfl'
    );
    expect(findDuplicatesByContentHashMock).toHaveBeenCalledWith('a'.repeat(64), 'nfl');

    expect(result.duplicateAction).toBe('reject');
    expect(result.originalUrlWarning).toEqual(
      expect.objectContaining({
        normalizedOriginalUrl: 'https://example.com/dynamic-image',
        duplicateIds: ['url-1'],
        duplicateFolders: ['url-folder'],
      })
    );
    expect(result.contentHashDuplicates).toEqual([hashMatch]);
    expect(result.crossNamespaceContentHashMatches).toEqual([]);
    expect(result.duplicateFamilySelection).toBeUndefined();
  });

  it('creates a family selection when family mode finds one canonical duplicate root', async () => {
    const root = makeImage({ id: 'root-1', namespace: 'nfl', uploaded: '2026-01-02T00:00:00.000Z' });
    findDuplicatesByContentHashMock.mockResolvedValueOnce([root]);
    getCachedImagesMock.mockResolvedValueOnce([root]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'b'.repeat(64),
      namespace: 'nfl',
      duplicateAction: 'family',
    });

    expect(result.duplicateFamilySelection).toEqual({
      requestedAction: 'family',
      matchedDuplicateIds: ['root-1'],
      canonicalParentId: 'root-1',
      storedAsVariant: true,
      provenance: 'duplicate-family-override',
    });
  });

  it('collapses duplicate children under the same canonical parent', async () => {
    const root = makeImage({ id: 'root-1', namespace: 'nfl', uploaded: '2026-01-01T00:00:00.000Z' });
    const childA = makeImage({ id: 'child-a', namespace: 'nfl', parentId: 'root-1', uploaded: '2026-01-02T00:00:00.000Z' });
    const childB = makeImage({ id: 'child-b', namespace: 'nfl', parentId: 'root-1', uploaded: '2026-01-03T00:00:00.000Z' });

    findDuplicatesByContentHashMock.mockResolvedValueOnce([childA, childB]);
    getCachedImagesMock.mockResolvedValueOnce([root, childA, childB]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'c'.repeat(64),
      namespace: 'nfl',
      duplicateAction: 'family',
    });

    expect(result.duplicateFamilySelection?.canonicalParentId).toBe('root-1');
    expect(result.duplicateFamilySelection?.matchedDuplicateIds).toEqual(['child-a', 'child-b']);
  });

  it('chooses the oldest canonical root when multiple families match', async () => {
    const olderRoot = makeImage({ id: 'root-old', namespace: 'nfl', uploaded: '2026-01-01T00:00:00.000Z' });
    const newerRoot = makeImage({ id: 'root-new', namespace: 'nfl', uploaded: '2026-01-05T00:00:00.000Z' });
    const olderChild = makeImage({ id: 'child-old', namespace: 'nfl', parentId: 'root-old', uploaded: '2026-01-06T00:00:00.000Z' });

    findDuplicatesByContentHashMock.mockResolvedValueOnce([olderChild, newerRoot]);
    getCachedImagesMock.mockResolvedValueOnce([olderRoot, newerRoot, olderChild]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'd'.repeat(64),
      namespace: 'nfl',
      duplicateAction: 'family',
    });

    expect(result.duplicateFamilySelection?.canonicalParentId).toBe('root-old');
  });

  it('keeps cross-namespace hash matches as warnings only', async () => {
    const crossNamespaceMatch = makeImage({ id: 'other-ns-hash', namespace: 'archive' });
    findDuplicatesByContentHashMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([crossNamespaceMatch]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'e'.repeat(64),
      namespace: 'nfl',
      duplicateAction: 'family',
    });

    expect(findDuplicatesByContentHashMock).toHaveBeenNthCalledWith(1, 'e'.repeat(64), 'nfl');
    expect(findDuplicatesByContentHashMock).toHaveBeenNthCalledWith(2, 'e'.repeat(64));
    expect(result.contentHashDuplicates).toEqual([]);
    expect(result.crossNamespaceContentHashMatches).toEqual([crossNamespaceMatch]);
    expect(result.duplicateFamilySelection).toBeUndefined();
  });

  it('logs warning and duplicate summaries with scope', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logOriginalUrlReuseWarning({
      logScope: 'upload/external',
      originalUrl: 'https://example.com/original',
      warning: {
        normalizedOriginalUrl: 'https://example.com/original',
        matches: [makeImage({ id: 'url-2', folder: 'photos' })],
        duplicateIds: ['url-2'],
        duplicateFolders: ['photos'],
      },
    });

    logContentHashDuplicate({
      logScope: 'upload',
      contentHash: 'f'.repeat(64),
      duplicates: [makeImage({ id: 'hash-2', folder: 'archive' })],
    });

    logCrossNamespaceContentHashWarning({
      logScope: 'upload',
      contentHash: 'g'.repeat(64),
      targetNamespace: 'nfl',
      matches: [makeImage({ id: 'cross-1', folder: 'archive', namespace: 'archive' })],
    });

    logDuplicateFamilySelection({
      logScope: 'upload',
      contentHash: 'h'.repeat(64),
      selection: {
        requestedAction: 'family',
        matchedDuplicateIds: ['hash-2'],
        canonicalParentId: 'parent-1',
        storedAsVariant: true,
        provenance: 'duplicate-family-override',
      },
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[upload/external] Original URL already exists (warning only)',
      expect.objectContaining({
        duplicateIds: ['url-2'],
        folders: ['photos'],
      })
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[upload] Duplicate content hash detected',
      expect.objectContaining({
        contentHash: 'f'.repeat(64),
        duplicateIds: ['hash-2'],
        folders: ['archive'],
      })
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[upload] Content hash exists in other namespaces (warning only)',
      expect.objectContaining({
        contentHash: 'g'.repeat(64),
        targetNamespace: 'nfl',
        duplicateIds: ['cross-1'],
      })
    );

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[upload] Duplicate content admitted as family variant',
      expect.objectContaining({
        contentHash: 'h'.repeat(64),
        canonicalParentId: 'parent-1',
        matchedDuplicateIds: ['hash-2'],
      })
    );
  });
});
