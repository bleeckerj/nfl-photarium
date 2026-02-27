import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/page/upload-video/route';

const { uploadVideoBufferMock, uploadVideoFromRemoteUrlMock } = vi.hoisted(() => ({
  uploadVideoBufferMock: vi.fn(),
  uploadVideoFromRemoteUrlMock: vi.fn(),
}));

vi.mock('@/server/videoUploadService', () => ({
  uploadVideoBuffer: uploadVideoBufferMock,
  uploadVideoFromRemoteUrl: uploadVideoFromRemoteUrlMock,
}));

const ORIGINAL_ENV = { ...process.env };

const createJsonRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/import/page/upload-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const createFormRequest = (formData: FormData) =>
  new NextRequest(
    new Request('http://localhost/api/import/page/upload-video', {
      method: 'POST',
      body: formData,
    })
  );

describe('POST /api/import/page/upload-video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.IMAGE_NAMESPACE = 'default-ns';

    uploadVideoBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'asset-1',
        assetType: 'video',
        filename: 'clip.mp4',
        uploaded: '2026-02-20T00:00:00.000Z',
        streamUid: 'stream-1',
        videoStatus: 'pending',
        tags: [],
      },
    });

    uploadVideoFromRemoteUrlMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'asset-2',
        assetType: 'video',
        filename: 'remote.mp4',
        uploaded: '2026-02-20T00:00:00.000Z',
        streamUid: 'stream-2',
        videoStatus: 'pending',
        tags: [],
      },
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects missing JSON URL', async () => {
    const response = await POST(createJsonRequest({}));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No video URL provided/i);
    expect(uploadVideoFromRemoteUrlMock).not.toHaveBeenCalled();
  });

  it('rejects private JSON URLs', async () => {
    const response = await POST(createJsonRequest({ url: 'http://127.0.0.1/video.mp4' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Only public http\(s\) URLs/i);
    expect(uploadVideoFromRemoteUrlMock).not.toHaveBeenCalled();
  });

  it('imports remote URL videos', async () => {
    const response = await POST(
      createJsonRequest({
        url: 'https://cdn.example.com/video.mp4',
        tags: 'loop,hero',
        namespace: 'ns-a',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.assetType).toBe('video');
    expect(uploadVideoFromRemoteUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://cdn.example.com/video.mp4',
      })
    );
  });

  it('rejects remote URL uploads without an explicit namespace', async () => {
    const response = await POST(
      createJsonRequest({
        url: 'https://cdn.example.com/video.mp4',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/specific namespace is required/i);
    expect(uploadVideoFromRemoteUrlMock).not.toHaveBeenCalled();
  });

  it('rejects missing form file', async () => {
    const formData = new FormData();
    const response = await POST(createFormRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No video file provided/i);
    expect(uploadVideoBufferMock).not.toHaveBeenCalled();
  });

  it('rejects multipart uploads without an explicit namespace', async () => {
    const formData = new FormData();
    const file = new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' });
    formData.append('file', file);
    formData.append('tags', 'loop');

    const response = await POST(createFormRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/specific namespace is required/i);
    expect(uploadVideoBufferMock).not.toHaveBeenCalled();
  });

  it('uploads multipart file videos with explicit namespace', async () => {
    const formData = new FormData();
    const file = new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' });
    formData.append('file', file);
    formData.append('tags', 'loop');
    formData.append('namespace', 'ns-a');

    const response = await POST(createFormRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.assetType).toBe('video');
    expect(uploadVideoBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'clip.mp4',
        fileType: 'video/mp4',
        context: expect.objectContaining({
          namespace: 'ns-a',
          tags: ['loop'],
        }),
      })
    );
  });
});
