import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVideoAssetRecord: vi.fn(),
  resolveVideoDownloadCandidates: vi.fn(),
  fetchVideoDownloadCandidate: vi.fn(),
  uploadVideoBuffer: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({ getVideoAssetRecord: mocks.getVideoAssetRecord }));
vi.mock('@/server/videoDownloadSourceService', () => ({
  resolveVideoDownloadCandidates: mocks.resolveVideoDownloadCandidates,
  fetchVideoDownloadCandidate: mocks.fetchVideoDownloadCandidate,
}));
vi.mock('@/server/videoUploadService', () => ({
  MAX_VIDEO_BYTES: 8,
  uploadVideoBuffer: mocks.uploadVideoBuffer,
}));
vi.mock('fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
  rm: mocks.rm,
}));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));

import { rotateVideoAsset, VideoRotationError } from '@/server/videoRotationService';

const successfulChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => child.emit('close', 0));
  return child;
};

describe('video rotation workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVideoAssetRecord.mockResolvedValue({
      id: 'video-1',
      filename: 'clip.mov',
      displayName: 'Clip',
      streamUid: 'stream-1',
      uploaded: '2026-07-10T00:00:00.000Z',
      videoStatus: 'ready',
      folder: 'motion',
      tags: ['source'],
      description: 'A source clip',
      namespace: 'test-space',
      parentId: 'image-parent',
      animatedWebpImageId: 'stale-webp',
      animatedWebpVariants: [{ imageId: 'stale-webp' }],
      mux: { assetId: 'mux-1', status: 'ready' },
      hasClipEmbedding: true,
    });
    mocks.resolveVideoDownloadCandidates.mockResolvedValue({
      urls: ['https://example.com/download.mp4'],
      streamUrls: new Set(['https://example.com/download.mp4']),
      streamDownloadStatus: 'ready',
    });
    mocks.fetchVideoDownloadCandidate.mockResolvedValue({
      url: 'https://example.com/download.mp4',
      response: new Response(Buffer.from('input'), { headers: { 'content-type': 'video/mp4' } }),
    });
    mocks.readFile.mockResolvedValue(Buffer.from('output'));
    mocks.rm.mockResolvedValue(undefined);
    mocks.spawn.mockImplementation(successfulChild);
    mocks.uploadVideoBuffer.mockResolvedValue({
      ok: true,
      data: {
        id: 'video-rotated',
        filename: 'clip-rotated-90.mp4',
        assetType: 'video',
        uploaded: '2026-07-11T00:00:00.000Z',
        streamUid: 'stream-rotated',
        videoStatus: 'pending',
        tags: ['source'],
      },
    });
  });

  it('uploads a clean derivative and removes its temporary workspace', async () => {
    const result = await rotateVideoAsset('video-1', 90);

    expect(mocks.uploadVideoBuffer).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'clip-rotated-90.mp4',
      fileType: 'video/mp4',
      context: expect.objectContaining({
        displayName: 'Clip rotated 90°',
        folder: 'motion',
        tags: ['source'],
        namespace: 'test-space',
        parentId: 'image-parent',
        rotatedFromId: 'video-1',
        rotationDegrees: 90,
      }),
    }));
    expect(result.animatedWebpImageId).toBeUndefined();
    expect(result.animatedWebpVariants).toBeUndefined();
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining('photarium-video-rotate-'),
      { recursive: true, force: true }
    );
  });

  it('rejects oversized output and still removes temporary files', async () => {
    mocks.readFile.mockResolvedValue(Buffer.alloc(9));
    await expect(rotateVideoAsset('video-1', 180)).rejects.toEqual(
      expect.objectContaining<Partial<VideoRotationError>>({ status: 413 })
    );
    expect(mocks.uploadVideoBuffer).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalled();
  });

  it('reports preparation when Stream candidates are not ready yet', async () => {
    mocks.resolveVideoDownloadCandidates.mockResolvedValue({
      urls: ['https://example.com/pending.mp4'],
      streamUrls: new Set(),
      streamDownloadStatus: 'inprogress',
    });
    mocks.fetchVideoDownloadCandidate.mockResolvedValue({
      url: '', response: null, lastStatus: 404,
    });

    await expect(rotateVideoAsset('video-1', 90)).rejects.toEqual(
      expect.objectContaining<Partial<VideoRotationError>>({ status: 409 })
    );
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });
});
