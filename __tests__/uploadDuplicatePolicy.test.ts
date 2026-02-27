import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findDuplicatesByOriginalUrlMock, findDuplicatesByContentHashMock } = vi.hoisted(() => ({
  findDuplicatesByOriginalUrlMock: vi.fn(),
  findDuplicatesByContentHashMock: vi.fn(),
}));

vi.mock('@/server/duplicateDetector', () => ({
  findDuplicatesByOriginalUrl: findDuplicatesByOriginalUrlMock,
  findDuplicatesByContentHash: findDuplicatesByContentHashMock,
}));

import {
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logCrossNamespaceContentHashWarning,
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
  });

  it('returns URL warning and hash duplicates when both match', async () => {
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

    expect(result.originalUrlWarning).toEqual(
      expect.objectContaining({
        normalizedOriginalUrl: 'https://example.com/dynamic-image',
        duplicateIds: ['url-1'],
        duplicateFolders: ['url-folder'],
      })
    );
    expect(result.contentHashDuplicates).toEqual([hashMatch]);
    expect(result.crossNamespaceContentHashMatches).toEqual([]);
  });

  it('skips URL lookup when normalizedOriginalUrl is missing and returns cross-namespace warnings', async () => {
    const crossNamespaceMatch = makeImage({ id: 'other-ns-hash', namespace: 'archive' });
    findDuplicatesByContentHashMock
      .mockResolvedValueOnce([]) // scoped lookup in target namespace
      .mockResolvedValueOnce([crossNamespaceMatch]); // global lookup for warning-only cross-namespace matches

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'b'.repeat(64),
      namespace: 'nfl',
    });

    expect(findDuplicatesByOriginalUrlMock).not.toHaveBeenCalled();
    expect(findDuplicatesByContentHashMock).toHaveBeenNthCalledWith(1, 'b'.repeat(64), 'nfl');
    expect(findDuplicatesByContentHashMock).toHaveBeenNthCalledWith(2, 'b'.repeat(64));
    expect(result.originalUrlWarning).toBeUndefined();
    expect(result.contentHashDuplicates).toEqual([]);
    expect(result.crossNamespaceContentHashMatches).toEqual([crossNamespaceMatch]);
  });

  it('does not hard-block duplicates when namespace is missing', async () => {
    const globalMatch = makeImage({ id: 'hash-anywhere', namespace: 'other-ns' });
    findDuplicatesByContentHashMock.mockResolvedValueOnce([globalMatch]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'd'.repeat(64),
      namespace: undefined,
    });

    expect(findDuplicatesByContentHashMock).toHaveBeenCalledWith('d'.repeat(64));
    expect(result.contentHashDuplicates).toEqual([]);
    expect(result.crossNamespaceContentHashMatches).toEqual([globalMatch]);
  });

  it('logs warning and duplicate summaries with scope', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

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
      contentHash: 'c'.repeat(64),
      duplicates: [makeImage({ id: 'hash-2', folder: 'archive' })],
    });

    logCrossNamespaceContentHashWarning({
      logScope: 'upload',
      contentHash: 'e'.repeat(64),
      targetNamespace: 'nfl',
      matches: [makeImage({ id: 'cross-1', folder: 'archive', namespace: 'archive' })],
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
        contentHash: 'c'.repeat(64),
        duplicateIds: ['hash-2'],
        folders: ['archive'],
      })
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[upload] Content hash exists in other namespaces (warning only)',
      expect.objectContaining({
        contentHash: 'e'.repeat(64),
        targetNamespace: 'nfl',
        duplicateIds: ['cross-1'],
      })
    );
  });
});
