import { describe, expect, it, vi } from 'vitest';
import {
  createVariationDraft,
  extractAssignmentCandidateAssets,
  formatBytes,
  formatDuration,
  formatFrameTime,
  mergeUniqueAssetsById,
  normalizeTags,
  sortFamilyAssets,
  toOptionalPositiveInt,
  toOptionalPositiveNumber,
  videoRecordFromSeed,
} from '@/components/video-detail/videoTransforms';

describe('video detail transforms', () => {
  it('extracts assignment candidate assets', () => {
    expect(extractAssignmentCandidateAssets({
      assignmentCandidates: [
        { asset: { id: 'child', filename: 'child.png', uploaded: '2026-01-02T00:00:00Z' } },
        {
          asset: { id: 'variant', filename: 'variant.png', uploaded: '2026-01-03T00:00:00Z' },
          parentAsset: { id: 'parent', filename: 'parent.png', uploaded: '2026-01-01T00:00:00Z' },
        },
      ],
    }).map((asset) => asset.id)).toEqual(['child', 'variant', 'parent']);
  });

  it('merges assets by id and creates video records from seeds', () => {
    expect(mergeUniqueAssetsById(
      [{ id: 'a', filename: 'old.mp4', uploaded: '2026-01-01T00:00:00Z' }],
      [{ id: 'a', filename: 'new.mp4', uploaded: '2026-01-02T00:00:00Z', folder: 'clips' }]
    )[0]).toMatchObject({ id: 'a', filename: 'new.mp4', folder: 'clips' });

    expect(videoRecordFromSeed({
      id: 'v1',
      filename: 'clip.mp4',
      displayName: 'Clip',
      uploaded: '2026-01-01T00:00:00Z',
      videoPlaybackUrl: 'https://example.com/play',
      tags: ['demo'],
    })).toMatchObject({
      id: 'v1',
      assetType: 'video',
      displayName: 'Clip',
      playbackUrl: 'https://example.com/play',
      videoStatus: 'ready',
      tags: ['demo'],
    });
  });

  it('creates variation drafts and parses positive numeric inputs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(createVariationDraft({ filename: 'clip.webp' })).toMatchObject({
      id: '123-8',
      filename: 'clip.webp',
      maxWidth: '960',
      maxOutputMb: '10',
      fps: '12',
      loop: true,
    });
    vi.restoreAllMocks();

    expect(toOptionalPositiveInt('12.4')).toBe(12);
    expect(toOptionalPositiveNumber('12.4')).toBe(12.4);
    expect(toOptionalPositiveInt('-1')).toBeUndefined();
  });

  it('formats bytes, durations, frame times, and tags', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(formatBytes(400)).toBe('1 KB');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatFrameTime(0.42)).toBe('0.42s');
    expect(formatFrameTime(65.42)).toBe('1:05.42');
    expect(normalizeTags(' hero, hero, , Editorial ')).toEqual(['hero', 'Editorial']);
  });

  it('sorts family assets by variation sort or newest upload fallback', () => {
    expect(sortFamilyAssets([
      { id: 'old', filename: 'old', uploaded: '2026-01-01T00:00:00Z' },
      { id: 'new', filename: 'new', uploaded: '2026-01-02T00:00:00Z' },
    ]).map((asset) => asset.id)).toEqual(['new', 'old']);

    expect(sortFamilyAssets([
      { id: 'a', filename: 'a', uploaded: '2026-01-01T00:00:00Z', variationSort: 2 },
      { id: 'b', filename: 'b', uploaded: '2026-01-02T00:00:00Z', variationSort: 1 },
      { id: 'c', filename: 'c', uploaded: '2026-01-03T00:00:00Z' },
    ]).map((asset) => asset.id)).toEqual(['b', 'a', 'c']);
  });
});
