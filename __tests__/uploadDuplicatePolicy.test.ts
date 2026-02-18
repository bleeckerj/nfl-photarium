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
  logOriginalUrlReuseWarning,
} from '@/server/uploadDuplicatePolicy';

const makeImage = (overrides?: Record<string, unknown>) =>
  ({
    id: 'img-default',
    filename: 'default.png',
    uploaded: '2026-01-01T00:00:00.000Z',
    folder: 'folder-default',
    ...overrides,
  }) as any;

describe('uploadDuplicatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns URL warning and hash duplicates when both match', async () => {
    const urlMatch = makeImage({ id: 'url-1', folder: 'url-folder' });
    const hashMatch = makeImage({ id: 'hash-1', folder: 'hash-folder' });

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
  });

  it('skips URL lookup when normalizedOriginalUrl is missing', async () => {
    findDuplicatesByContentHashMock.mockResolvedValueOnce([]);

    const result = await evaluateUploadDeduplicationPolicy({
      contentHash: 'b'.repeat(64),
      namespace: 'nfl',
    });

    expect(findDuplicatesByOriginalUrlMock).not.toHaveBeenCalled();
    expect(findDuplicatesByContentHashMock).toHaveBeenCalledWith('b'.repeat(64), 'nfl');
    expect(result.originalUrlWarning).toBeUndefined();
    expect(result.contentHashDuplicates).toEqual([]);
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
  });
});
