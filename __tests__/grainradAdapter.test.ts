import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { grainradAdapter } from '@/server/image-tools/grainradAdapter';
import { createTestImageFixture, type TestImageFixture } from './helpers/imageFixtures';

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
  timeline: { durationMs: 600, fps: 8, loop: true },
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

// RGB display rendering can contend with the full suite's Sharp-heavy tests.
const CPU_INTENSIVE_RENDER_TIMEOUT_MS = 30_000;

let pngFixture: TestImageFixture;
let webpFixture: TestImageFixture;

const blobResponse = (fixture: TestImageFixture) =>
  new Response(new Uint8Array(fixture.buffer), {
    status: 200,
    headers: { 'content-type': fixture.contentType },
  });

// The adapter fetches source bytes directly; no Grainrad HTTP service is called.
const mockBlobFetch = (fixture: TestImageFixture) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const value = String(url);
    if (value.includes('/images/v1/source-1/blob')) return blobResponse(fixture);
    throw new Error(`Unexpected fetch in in-process adapter: ${value}`);
  });

describe('grainradAdapter (in-process)', () => {
  beforeAll(async () => {
    pngFixture = await createTestImageFixture('png', 'source.png');
    webpFixture = await createTestImageFixture('webp', 'source.webp');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    fetchCloudflareImageMock.mockResolvedValue(sourceImage);
    getCachedImageMock.mockResolvedValue(sourceImage);
    getImageExtrasRecordMock.mockResolvedValue({ imageId: 'source-1', folder: 'extras-folder' });
    uploadImageBufferMock.mockResolvedValue({ ok: true, data: uploadResult });
    uploadVideoBufferMock.mockResolvedValue({ ok: true, data: { id: 'video-1', filename: 'source-grainrad-vhs.mp4' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a still in-process and uploads it as a child image (PNG source)', async () => {
    mockBlobFetch(pngFixture);

    const result = await grainradAdapter.run({
      runId: 'run-1',
      imageId: 'source-1',
      request: baseRequest,
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result.uploadedAsset.id).toBe('generated-1');
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
    // The uploaded buffer is a real, decodable PNG.
    const uploadedBuffer = uploadImageBufferMock.mock.calls[0][0].buffer as Buffer;
    const meta = await sharp(uploadedBuffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(96);

    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'generated-1',
      expect.objectContaining({
        imageToolRun: expect.objectContaining({
          toolId: 'grainrad',
          adapterKind: 'grainrad-inproc',
          sourceImageId: 'source-1',
          effectId: 'threshold',
        }),
      })
    );
  });

  it('renders a WebP source without ffmpeg (regression for the [webp] decode failure)', async () => {
    mockBlobFetch(webpFixture);

    const result = await grainradAdapter.run({
      runId: 'run-webp',
      imageId: 'source-1',
      request: baseRequest,
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result.uploadedAsset.id).toBe('generated-1');
    const uploadedBuffer = uploadImageBufferMock.mock.calls[0][0].buffer as Buffer;
    const meta = await sharp(uploadedBuffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(96);
  });

  it('renders an animated GIF and uploads it as an image', async () => {
    mockBlobFetch(pngFixture);

    await grainradAdapter.run({
      runId: 'run-gif',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        effectId: 'vhs',
        params: { noiseAmount: 0.4, scanlineIntensity: 0.2 },
        output: { mode: 'animated', format: 'gif', preset: 'preview' },
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'image/gif', fileName: 'source-grainrad-vhs.gif' })
    );
    const uploadedBuffer = uploadImageBufferMock.mock.calls[0][0].buffer as Buffer;
    const meta = await sharp(uploadedBuffer, { animated: true }).metadata();
    expect(meta.pages ?? 1).toBeGreaterThanOrEqual(2);
  });

  it('stores paramPreset in generated asset provenance', async () => {
    mockBlobFetch(pngFixture);

    await grainradAdapter.run({
      runId: 'run-preset',
      imageId: 'source-1',
      request: {
        ...baseRequest,
        effectId: 'rgb-subpixel-display',
        paramPreset: 'diagonal-tear-hold-soft-wave-medium',
        params: {},
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'generated-1',
      expect.objectContaining({
        imageToolRun: expect.objectContaining({
          effectId: 'rgb-subpixel-display',
          paramPreset: 'diagonal-tear-hold-soft-wave-medium',
        }),
      })
    );
  }, CPU_INTENSIVE_RENDER_TIMEOUT_MS);

  it('renders an ephemeral preview without uploading to Photarium', async () => {
    mockBlobFetch(pngFixture);

    const result = await grainradAdapter.preview?.({
      previewId: 'preview-1',
      imageId: 'source-1',
      request: baseRequest,
      updatePreview: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result?.artifact.contentType).toBe('image/png');
    const meta = await sharp(result!.artifact.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
    expect(uploadVideoBufferMock).not.toHaveBeenCalled();
  });

  it('uses a Cloudflare delivery variant when the original blob endpoint is forbidden', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('forbidden', { status: 403 });
      }
      if (value === 'https://example.com/source/public') {
        return blobResponse(pngFixture);
      }
      throw new Error(`Unexpected fetch: ${value}`);
    });

    const result = await grainradAdapter.preview?.({
      previewId: 'preview-fallback',
      imageId: 'source-1',
      request: baseRequest,
      updatePreview: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result?.artifact.contentType).toBe('image/png');
    const meta = await sharp(result!.artifact.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
  });

  it('rejects undecodable source bytes before rendering', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.includes('/images/v1/source-1/blob')) {
        return new Response('not-webp-image-data', {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        });
      }
      throw new Error(`Unexpected fetch: ${value}`);
    });

    await expect(grainradAdapter.preview?.({
      previewId: 'preview-corrupt',
      imageId: 'source-1',
      request: { ...baseRequest, output: { mode: 'still', format: 'png', preset: 'preview' } },
      updatePreview: vi.fn(),
      addEvent: vi.fn(),
    })).rejects.toThrow(/not decodable/i);

    expect(uploadImageBufferMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
