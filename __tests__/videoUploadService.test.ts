import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  uploadVideoBuffer,
  uploadVideoFromRemoteUrl,
  MAX_VIDEO_BYTES,
} from '@/server/videoUploadService';

const {
  createStreamVideoFromFileMock,
  createStreamVideoFromUrlMock,
  createVideoAssetRecordMock,
  queueAutoEmbeddingsForVideoMock,
} = vi.hoisted(() => ({
  createStreamVideoFromFileMock: vi.fn(),
  createStreamVideoFromUrlMock: vi.fn(),
  createVideoAssetRecordMock: vi.fn(),
  queueAutoEmbeddingsForVideoMock: vi.fn(),
}));

vi.mock('@/server/cloudflareStreamClient', () => ({
  createStreamVideoFromFile: createStreamVideoFromFileMock,
  createStreamVideoFromUrl: createStreamVideoFromUrlMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  createVideoAssetRecord: createVideoAssetRecordMock,
}));

vi.mock('@/server/videoEmbeddingService', () => ({
  queueAutoEmbeddingsForVideo: queueAutoEmbeddingsForVideoMock,
}));

describe('videoUploadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStreamVideoFromFileMock.mockResolvedValue({
      uid: 'stream-1',
      thumbnail: 'https://example.com/thumb.jpg',
      preview: 'https://example.com/preview.gif',
      readyToStream: false,
      duration: 3.2,
      status: { state: 'inprogress' },
    });
    createStreamVideoFromUrlMock.mockResolvedValue({
      uid: 'stream-2',
      readyToStream: true,
      duration: 5.5,
      status: { state: 'ready' },
    });
    createVideoAssetRecordMock.mockImplementation(async (input) => ({
      id: 'asset-1',
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-20T00:00:00.000Z',
      ...input,
    }));
    queueAutoEmbeddingsForVideoMock.mockResolvedValue({
      enabled: true,
      queued: true,
    });
  });

  it('rejects unsupported MIME types', async () => {
    const result = await uploadVideoBuffer({
      buffer: Buffer.from('nope'),
      fileName: 'clip.txt',
      fileType: 'text/plain',
      fileSize: 4,
      context: { tags: [], namespace: 'test' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-type');
    expect(createStreamVideoFromFileMock).not.toHaveBeenCalled();
  });

  it('rejects files over max size', async () => {
    const result = await uploadVideoBuffer({
      buffer: Buffer.alloc(1),
      fileName: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: MAX_VIDEO_BYTES + 1,
      context: { tags: [], namespace: 'test' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-large');
    expect(createStreamVideoFromFileMock).not.toHaveBeenCalled();
  });

  it('uploads a video buffer and stores a catalog record', async () => {
    const result = await uploadVideoBuffer({
      buffer: Buffer.from('video-bytes'),
      fileName: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      context: {
        folder: 'loops',
        tags: ['loop', 'hero'],
        description: 'Short loop',
        namespace: 'test',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.streamUid).toBe('stream-1');
    expect(result.data.videoStatus).toBe('pending');
    expect(createStreamVideoFromFileMock).toHaveBeenCalledTimes(1);
    expect(createVideoAssetRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'clip.mp4',
        streamUid: 'stream-1',
        folder: 'loops',
        tags: ['loop', 'hero'],
        namespace: 'test',
      })
    );
  });

  it('imports remote video URL and defaults original/source URLs', async () => {
    const result = await uploadVideoFromRemoteUrl({
      sourceUrl: 'https://cdn.example.com/loop.mp4',
      context: { tags: ['remote'], namespace: 'test' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.videoStatus).toBe('ready');
    expect(result.data.originalUrl).toBe('https://cdn.example.com/loop.mp4');
    expect(result.data.sourceUrl).toBe('https://cdn.example.com/loop.mp4');
    expect(createStreamVideoFromUrlMock).toHaveBeenCalledTimes(1);
  });

  it('requires explicit namespace for remote uploads', async () => {
    const result = await uploadVideoFromRemoteUrl({
      sourceUrl: 'https://cdn.example.com/loop.mp4',
      context: { tags: ['remote'] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/specific namespace is required/i);
  });
});
