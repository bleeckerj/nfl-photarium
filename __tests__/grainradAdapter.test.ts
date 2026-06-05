import { beforeEach, describe, expect, it, vi } from 'vitest';

import { grainradAdapter } from '@/server/image-tools/grainradAdapter';

const {
  fetchCloudflareImageMock,
  getCloudflareCredentialsMock,
  getCachedImageMock,
  getImageExtrasRecordMock,
  patchImageExtrasRecordMock,
  uploadImageBufferMock,
  uploadVideoBufferMock,
} = vi.hoisted(() => ({
  fetchCloudflareImageMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
  getCachedImageMock: vi.fn(),
  getImageExtrasRecordMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn(),
  uploadImageBufferMock: vi.fn(),
  uploadVideoBufferMock: vi.fn(),
}));

vi.mock('@/server/cloudflareClient', () => ({
  fetchCloudflareImage: fetchCloudflareImageMock,
  getCloudflareCredentials: getCloudflareCredentialsMock,
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: getCachedImageMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: getImageExtrasRecordMock,
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

vi.mock('@/server/uploadService', () => ({
  uploadImageBuffer: uploadImageBufferMock,
}));

vi.mock('@/server/videoUploadService', () => ({
  uploadVideoBuffer: uploadVideoBufferMock,
}));

const baseRequest = {
  effectId: 'threshold',
  params: { threshold: 120 },
  output: { mode: 'still' as const, format: 'png', preset: 'balanced' },
  timeline: { durationMs: 1000, fps: 8, loop: true },
  renderContext: { seed: 1 },
};

const sourceImage = {
  id: 'source-1',
  filename: 'source.png',
  uploaded: '2026-05-01T00:00:00.000Z',
  variants: ['https://example.com/source/public'],
  folder: 'source-folder',
  tags: ['source', '_favorite_'],
  namespace: 'ns-a',
};

const uploadResult = {
  id: 'generated-1',
  filename: 'source-grainrad-threshold.png',
  url: 'https://imagedelivery.net/hash/generated-1/public',
  variants: ['https://imagedelivery.net/hash/generated-1/public'],
  uploaded: '2026-05-01T00:00:01.000Z',
  tags: ['source', 'grainrad', 'image-tool', 'threshold'],
};

describe('grainradAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GRAINRAD_BASE_URL = 'http://grainrad.local';
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'source-1',
      filename: 'source.png',
      uploaded: '2026-05-01T00:00:00.000Z',
      variants: ['https://example.com/source/public'],
    });
    getCachedImageMock.mockResolvedValue(sourceImage);
    getImageExtrasRecordMock.mockResolvedValue({ imageId: 'source-1', folder: 'extras-folder' });
    uploadImageBufferMock.mockResolvedValue({ ok: true, data: uploadResult });
    uploadVideoBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'video-1',
        assetType: 'video',
        filename: 'source-grainrad-vhs.mp4',
        uploaded: '2026-05-01T00:00:02.000Z',
        streamUid: 'stream-1',
        videoStatus: 'pending',
        tags: ['source', 'grainrad', 'image-tool', 'vhs'],
      },
    });
  });

  it('renders a still artifact and uploads it as a child image', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/render') {
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init?.body as FormData).get('sourceFile')).toBeInstanceOf(File);
        return new Response(JSON.stringify({
          ok: true,
          artifact: { filename: 'artifact.png', url: '/artifacts/artifact.png', contentType: 'image/png' },
        }), { status: 200 });
      }
      if (value === 'http://grainrad.local/artifacts/artifact.png') {
        return new Response('artifact-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('{}', { status: 404 });
    });
    const updateRun = vi.fn();

    const result = await grainradAdapter.run({
      runId: 'run-1',
      imageId: 'source-1',
      request: baseRequest,
      updateRun,
      addEvent: vi.fn(),
    });

    expect(result.uploadedAsset.id).toBe('generated-1');
    expect(fetchMock).toHaveBeenCalledWith('http://grainrad.local/api/render', expect.objectContaining({ method: 'POST' }));
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'source-grainrad-threshold.png',
        fileType: 'image/png',
        context: expect.objectContaining({
          folder: 'extras-folder',
          namespace: 'ns-a',
          parentId: 'source-1',
          tags: ['source', 'grainrad', 'image-tool', 'threshold'],
        }),
      })
    );
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'generated-1',
      expect.objectContaining({
        imageToolRun: expect.objectContaining({
          toolId: 'grainrad',
          sourceImageId: 'source-1',
          effectId: 'threshold',
        }),
      })
    );
  });

  it('polls animated exports and uploads mp4 artifacts through video upload', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/export') {
        return new Response(JSON.stringify({ ok: true, jobId: 'job-1' }), { status: 202 });
      }
      if (value === 'http://grainrad.local/api/jobs/job-1') {
        return new Response(JSON.stringify({
          ok: true,
          job: {
            id: 'job-1',
            status: 'completed',
            message: 'done',
            percent: 1,
            result: {
              artifact: { filename: 'artifact.mp4', url: '/artifacts/artifact.mp4', contentType: 'video/mp4' },
            },
          },
        }), { status: 200 });
      }
      if (value === 'http://grainrad.local/artifacts/artifact.mp4') {
        return new Response('mp4-bytes', { status: 200, headers: { 'content-type': 'video/mp4' } });
      }
      return new Response('{}', { status: 404 });
    });

    const result = await grainradAdapter.run({
      runId: 'run-2',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        effectId: 'vhs',
        output: { mode: 'animated', format: 'mp4', preset: 'preview' },
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result.externalJobId).toBe('job-1');
    expect(result.uploadedAsset.id).toBe('video-1');
    expect(uploadVideoBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'source-grainrad-vhs.mp4',
        fileType: 'video/mp4',
        context: expect.objectContaining({
          namespace: 'ns-a',
          parentId: 'source-1',
        }),
      })
    );
  });

  it('explains Grainrad network failures with the failed phase and service hint', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      const error = new Error('fetch failed');
      Object.defineProperty(error, 'cause', {
        value: new Error('connect ECONNREFUSED 127.0.0.1:4173'),
      });
      throw error;
    });

    let caught: unknown;
    try {
      await grainradAdapter.run({
        runId: 'run-3',
        imageId: 'source-1',
        request: baseRequest,
        updateRun: vi.fn(),
        addEvent: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('Grainrad still render request failed at /api/render');
    expect(message).toContain('fetch failed (connect ECONNREFUSED <host>)');
    expect(message).toContain('Check that the Grainrad service is running, set GRAINRAD_BASE_URL, or enable managed startup with GRAINRAD_MANAGED_ENABLED=1.');
    expect(message).not.toContain('127.0.0.1');
  });

  it('renders an ephemeral preview without uploading to Photarium', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/render') {
        return new Response(JSON.stringify({
          ok: true,
          artifact: { filename: 'preview.png', url: '/artifacts/preview.png', contentType: 'image/png' },
        }), { status: 200 });
      }
      if (value === 'http://grainrad.local/artifacts/preview.png') {
        return new Response('preview-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('{}', { status: 404 });
    });

    const result = await grainradAdapter.preview?.({
      previewId: 'preview-1',
      imageId: 'source-1',
      request: baseRequest,
      updatePreview: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result?.artifact.filename).toBe('preview.png');
    expect(result?.artifact.buffer.toString()).toBe('preview-bytes');
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
    expect(uploadVideoBufferMock).not.toHaveBeenCalled();
  });

  it('renders animated previews through the export endpoint without uploading to Photarium', async () => {
    const updatePreview = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/export') {
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init?.body as FormData).get('sourceFile')).toBeInstanceOf(File);
        return new Response(JSON.stringify({ ok: true, jobId: 'preview-job-1' }), { status: 202 });
      }
      if (value === 'http://grainrad.local/api/jobs/preview-job-1') {
        return new Response(JSON.stringify({
          ok: true,
          job: {
            id: 'preview-job-1',
            status: 'completed',
            message: 'preview done',
            percent: 1,
            result: {
              artifact: { filename: 'preview.mp4', url: '/artifacts/preview.mp4', contentType: 'video/mp4' },
            },
          },
        }), { status: 200 });
      }
      if (value === 'http://grainrad.local/artifacts/preview.mp4') {
        return new Response('preview-mp4-bytes', { status: 200, headers: { 'content-type': 'video/mp4' } });
      }
      return new Response('{}', { status: 404 });
    });

    const result = await grainradAdapter.preview?.({
      previewId: 'preview-animated-1',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        effectId: 'vhs',
        output: { mode: 'animated', format: 'mp4', preset: 'preview' },
      },
      updatePreview,
      addEvent: vi.fn(),
    });

    expect(result?.externalJobId).toBe('preview-job-1');
    expect(result?.artifact.filename).toBe('preview.mp4');
    expect(result?.artifact.contentType).toBe('video/mp4');
    expect(result?.artifact.buffer.toString()).toBe('preview-mp4-bytes');
    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({ externalJobId: 'preview-job-1' }));
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
    expect(uploadVideoBufferMock).not.toHaveBeenCalled();
  });

  it('fails previews when Grainrad returns no artifact', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/render') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    await expect(grainradAdapter.preview?.({
      previewId: 'preview-2',
      imageId: 'source-1',
      request: baseRequest,
      updatePreview: vi.fn(),
      addEvent: vi.fn(),
    })).rejects.toThrow(/did not return an artifact/i);
  });

  it('fails when an animated Grainrad job fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (value === 'http://grainrad.local/api/export') {
        return new Response(JSON.stringify({ ok: true, jobId: 'job-failed' }), { status: 202 });
      }
      if (value === 'http://grainrad.local/api/jobs/job-failed') {
        return new Response(JSON.stringify({
          ok: true,
          job: {
            id: 'job-failed',
            status: 'failed',
            message: 'encoder failed',
            error: { message: 'encoder failed' },
          },
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    await expect(grainradAdapter.run({
      runId: 'run-4',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        output: { mode: 'animated', format: 'gif', preset: 'preview' },
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    })).rejects.toThrow(/encoder failed/i);
  });
});
