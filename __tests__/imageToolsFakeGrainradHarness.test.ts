import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  effectId: 'vhs',
  params: { noiseAmount: 0.2 },
  output: { mode: 'still' as const, format: 'png', preset: 'preview' },
  timeline: { durationMs: 1000, fps: 8, loop: true },
  renderContext: { seed: 7 },
};

const readRequest = async (request: http.IncomingMessage) => {
  for await (const chunk of request) {
    // Drain multipart upload body so the fake service behaves like a real HTTP peer.
    if (!chunk) break;
  }
};

const writeJson = (response: http.ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
};

const createFakeGrainradServer = async () => {
  const server = http.createServer(async (request, response) => {
    const url = request.url || '/';
    if (request.method === 'POST' && url === '/api/render') {
      await readRequest(request);
      writeJson(response, 200, {
        ok: true,
        artifact: { filename: 'fake-preview.png', url: '/artifacts/fake-preview.png', contentType: 'image/png' },
      });
      return;
    }
    if (request.method === 'POST' && url === '/api/export') {
      await readRequest(request);
      writeJson(response, 202, { ok: true, jobId: 'fake-job-1' });
      return;
    }
    if (request.method === 'GET' && url === '/api/jobs/fake-job-1') {
      writeJson(response, 200, {
        ok: true,
        job: {
          id: 'fake-job-1',
          status: 'completed',
          message: 'fake export complete',
          percent: 1,
          result: {
            artifact: { filename: 'fake-export.mp4', url: '/artifacts/fake-export.mp4', contentType: 'video/mp4' },
          },
        },
      });
      return;
    }
    if (request.method === 'GET' && url === '/artifacts/fake-preview.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end('fake-preview-bytes');
      return;
    }
    if (request.method === 'GET' && url === '/artifacts/fake-export.mp4') {
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.end('fake-mp4-bytes');
      return;
    }
    writeJson(response, 404, { ok: false, error: { message: 'not found' } });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fake Grainrad server did not bind to a TCP port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe('image tools fake Grainrad harness', () => {
  let fakeServer: Awaited<ReturnType<typeof createFakeGrainradServer>> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    fetchCloudflareImageMock.mockResolvedValue({ id: 'source-1', filename: 'source.png' });
    getCachedImageMock.mockResolvedValue({
      id: 'source-1',
      filename: 'source.png',
      namespace: 'ns-a',
      folder: 'source-folder',
      tags: ['source'],
    });
    getImageExtrasRecordMock.mockResolvedValue({ imageId: 'source-1', folder: 'extras-folder' });
    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: { id: 'generated-1', filename: 'source-grainrad-vhs.png', tags: [] },
    });
    uploadVideoBufferMock.mockResolvedValue({
      ok: true,
      data: { id: 'video-1', assetType: 'video', filename: 'source-grainrad-vhs.mp4', tags: [] },
    });
  });

  afterEach(async () => {
    await fakeServer?.close();
    fakeServer = null;
    vi.restoreAllMocks();
    delete process.env.GRAINRAD_BASE_URL;
  });

  it('previews, renders stills, and polls animated exports through fake HTTP', async () => {
    fakeServer = await createFakeGrainradServer();
    process.env.GRAINRAD_BASE_URL = fakeServer.baseUrl;
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/images/v1/source-1/blob')) {
        return new Response('source-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return realFetch(input, init);
    });

    const previewEvents = vi.fn();
    const preview = await grainradAdapter.preview?.({
      previewId: 'preview-1',
      imageId: 'source-1',
      request: baseRequest,
      updatePreview: vi.fn(),
      addEvent: previewEvents,
    });
    expect(preview?.artifact.buffer.toString()).toBe('fake-preview-bytes');
    expect(previewEvents).toHaveBeenCalledWith(expect.objectContaining({ phase: 'grainrad.submit' }));

    const still = await grainradAdapter.run({
      runId: 'run-1',
      imageId: 'source-1',
      request: baseRequest,
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });
    expect(still.uploadedAsset.id).toBe('generated-1');

    const animated = await grainradAdapter.run({
      runId: 'run-2',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        output: { mode: 'animated', format: 'mp4', preset: 'preview' },
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });
    expect(animated.externalJobId).toBe('fake-job-1');
    expect(animated.uploadedAsset.id).toBe('video-1');
  });
});
