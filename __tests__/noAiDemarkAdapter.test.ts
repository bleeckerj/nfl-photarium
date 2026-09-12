import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCachedImageMock,
  getCloudflareCredentialsMock,
  getImageExtrasRecordMock,
  patchImageExtrasRecordMock,
  downloadSourceImageMock,
  runNoAiDemarkMock,
  uploadImageBufferMock,
} = vi.hoisted(() => ({
  getCachedImageMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
  getImageExtrasRecordMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn(),
  downloadSourceImageMock: vi.fn(),
  runNoAiDemarkMock: vi.fn(),
  uploadImageBufferMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({ getCachedImage: getCachedImageMock }));
vi.mock('@/server/cloudflareClient', () => ({ getCloudflareCredentials: getCloudflareCredentialsMock }));
vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: getImageExtrasRecordMock,
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));
vi.mock('@/server/image-tools/sourceDownloader', () => ({ downloadSourceImage: downloadSourceImageMock }));
vi.mock('@/server/image-tools/noAiDemarkRunner', () => ({ runNoAiDemark: runNoAiDemarkMock }));
vi.mock('@/server/uploadService', () => ({
  sanitizeFilename: (filename: string) => filename,
  uploadImageBuffer: uploadImageBufferMock,
}));

import { noAiDemarkAdapter } from '@/server/image-tools/noAiDemarkAdapter';

const verification = { format_valid: true, dimensions_valid: true, ai_metadata_present: false, c2pa_present: false,
  pixel_regeneration_applied: false, pixel_watermark_detector: null, pixel_watermark_present: null,
  inspection_complete: true, inspection_errors: [] };

const source = {
  id: 'variation-1',
  filename: 'coffee-beans.png',
  uploaded: '2026-08-15T00:00:00.000Z',
  variants: ['https://example.com/variation-1/public'],
  folder: 'coffee-archive',
  tags: ['reference', 'Demarked', '_favorite_'],
  namespace: 'cf-artifacts',
  parentId: 'canonical-parent',
  displayName: '2008 Dark Oxygen Infused Coffee Beans',
  altTag: 'Coffee bag on a shelf',
  description: 'A coffee bag on a shelf.',
  originalUrl: 'https://example.com/original',
  sourceUrl: 'https://example.com/source',
};

const request = {
  effectId: 'demark',
  params: {
    strength: 0.04,
    steps: 50,
    modelProfile: 'ctrlregen',
    device: 'auto',
    removeAllMetadata: false,
  },
  output: { mode: 'still' as const, format: 'png' },
};

describe('noAiDemarkAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCachedImageMock
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({
        ...source,
        id: 'demarked-child',
        parentId: 'canonical-parent',
        folder: 'catalog-folder',
        dimensions: { width: 1086, height: 1448 },
      });
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    getImageExtrasRecordMock.mockResolvedValue({ imageId: source.id, folder: 'catalog-folder' });
    downloadSourceImageMock.mockImplementation(async (id: string) => ({
      buffer: Buffer.from(id === source.id ? 'source-image' : 'demarked-image'),
      contentType: 'image/png',
      filename: source.filename,
    }));
    runNoAiDemarkMock.mockResolvedValue({
      buffer: Buffer.from('demarked-image'),
      filename: 'coffee-beans-demarked.png',
      verification,
      frames: 1,
      contentType: 'image/png',
      width: 1086,
      height: 1448,
    });
    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'demarked-child',
        filename: 'coffee-beans-demarked.png',
        url: 'https://example.com/demarked-child/public',
      },
    });
  });

  it('is a run-only catalog plugin with the direct MCP defaults', () => {
    expect(noAiDemarkAdapter.manifest).toMatchObject({
      id: 'no-ai-demarker',
      adapterKind: 'noai-watermark',
      supportsAsync: true,
      supportsPreview: false,
      defaultRequest: {
        effectId: 'demark',
        params: {
          strength: 0.04,
          steps: 50,
          modelProfile: 'ctrlregen',
          device: 'auto',
        },
      },
    });
  });

  it('uploads a verified child with preserved Photarium metadata and provenance', async () => {
    const result = await noAiDemarkAdapter.run({
      runId: 'run-1',
      imageId: source.id,
      request,
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(runNoAiDemarkMock).toHaveBeenCalledWith(expect.objectContaining({
      imageId: source.id,
      outputFilename: 'coffee-beans-demarked.png',
      settings: expect.objectContaining({ modelProfile: 'ctrlregen', strength: 0.04, steps: 50 }),
    }));
    expect(uploadImageBufferMock).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'coffee-beans-demarked.png',
      fileType: 'image/png',
      context: expect.objectContaining({
        folder: 'catalog-folder',
        namespace: 'cf-artifacts',
        parentId: 'canonical-parent',
        displayName: '2008 Dark Oxygen Infused Coffee Beans — Demarked',
        altTag: 'Coffee bag on a shelf',
        tags: ['reference', 'Demarked', '_favorite_'],
        originalUrl: 'https://example.com/original',
        sourceUrl: 'https://example.com/source',
      }),
    }));
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith('demarked-child', expect.objectContaining({
      imageToolRun: expect.objectContaining({
        toolId: 'no-ai-demarker',
        sourceImageId: source.id,
        effectId: 'demark',
        params: expect.objectContaining({ aiMetadataPresent: false, parentId: 'canonical-parent' }),
      }),
      altText: 'Coffee bag on a shelf',
    }));
    expect(result).toMatchObject({
      uploadedAsset: { id: 'demarked-child' },
      metadata: {
        aiMetadataPresent: false,
        dimensions: { width: 1086, height: 1448 },
        parentId: 'canonical-parent',
      },
    });
  });

  it('does not upload a fallback artifact when the no-AI worker fails', async () => {
    runNoAiDemarkMock.mockRejectedValueOnce(new Error('CtrlRegen dependencies unavailable'));

    await expect(noAiDemarkAdapter.run({
      runId: 'run-2',
      imageId: source.id,
      request,
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    })).rejects.toThrow('CtrlRegen dependencies unavailable');

    expect(uploadImageBufferMock).not.toHaveBeenCalled();
  });
  it('uploads WebP with its actual filename and explicit verification', async () => {
    runNoAiDemarkMock.mockResolvedValueOnce({ buffer: Buffer.from('demarked-image'),
      contentType: 'image/webp', filename: 'coffee-beans-demarked.webp',
      width: 1086, height: 1448, verification, frames: 1 });
    const result = await noAiDemarkAdapter.run({ runId: 'webp', imageId: source.id,
      request: { ...request, effectId: 'metadata' }, updateRun: vi.fn(), addEvent: vi.fn() });
    expect(uploadImageBufferMock).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'coffee-beans-demarked.webp', fileType: 'image/webp',
      context: expect.objectContaining({ description: source.description }) }));
    expect(result.metadata).toMatchObject({ verification, hostedOriginalMatches: true });
    expect(downloadSourceImageMock).toHaveBeenCalledWith('demarked-child', { requireOriginal: true });
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith('demarked-child', expect.objectContaining({
      imageToolRun: expect.objectContaining({ output: { mode: 'still', format: 'webp' } }) }));
  });

  it('fails when hosted original bytes change and does not record success', async () => {
    downloadSourceImageMock.mockResolvedValue({ buffer: Buffer.from('different bytes'),
      contentType: 'image/webp', filename: 'source.webp' });
    await expect(noAiDemarkAdapter.run({ runId: 'changed', imageId: source.id,
      request, updateRun: vi.fn(), addEvent: vi.fn() })).rejects.toThrow('Hosted original verification failed');
    expect(patchImageExtrasRecordMock).not.toHaveBeenCalled();
  });

});
