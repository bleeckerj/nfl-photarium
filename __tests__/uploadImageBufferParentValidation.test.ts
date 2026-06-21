import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  evaluateUploadDeduplicationPolicyMock,
  logContentHashDuplicateMock,
  logUploadDeduplicationResultMock,
  transformApiImageToCachedMock,
  upsertCachedImageMock,
  validateParentForNewChildMock,
  prepareImageForUploadMock,
  enforceCloudflareMetadataLimitMock,
  extractExifSummaryMock,
  extractComfyWorkflowMetadataMock,
  ingestComfyWorkflowForImageMock,
  patchImageExtrasRecordMock,
  queueAutoEmbeddingsForImageMock,
  storeImageAspectMetadataMock,
} = vi.hoisted(() => ({
  evaluateUploadDeduplicationPolicyMock: vi.fn(),
  logContentHashDuplicateMock: vi.fn(),
  logUploadDeduplicationResultMock: vi.fn(),
  transformApiImageToCachedMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
  validateParentForNewChildMock: vi.fn(),
  prepareImageForUploadMock: vi.fn(),
  enforceCloudflareMetadataLimitMock: vi.fn(),
  extractExifSummaryMock: vi.fn(),
  extractComfyWorkflowMetadataMock: vi.fn(),
  ingestComfyWorkflowForImageMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn(),
  queueAutoEmbeddingsForImageMock: vi.fn(),
  storeImageAspectMetadataMock: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 80, height: 60 }),
  })),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  transformApiImageToCached: transformApiImageToCachedMock,
  upsertCachedImage: upsertCachedImageMock,
}));

vi.mock('@/server/uploadDuplicatePolicy', () => ({
  evaluateUploadDeduplicationPolicy: evaluateUploadDeduplicationPolicyMock,
  logContentHashDuplicate: logContentHashDuplicateMock,
  logUploadDeduplicationResult: logUploadDeduplicationResultMock,
}));

vi.mock('@/utils/urlNormalization', () => ({
  normalizeOriginalUrl: (value?: string) => value,
}));

vi.mock('@/utils/cloudflareMetadata', () => ({
  enforceCloudflareMetadataLimit: enforceCloudflareMetadataLimitMock,
}));

vi.mock('@/utils/exif', () => ({
  extractExifSummary: extractExifSummaryMock,
}));

vi.mock('@/utils/snagx', () => ({
  extractSnagx: vi.fn(),
}));

vi.mock('@/utils/filename', () => ({
  sanitizeFilename: (value: string) => value,
  MAX_FILENAME_LENGTH: 128,
}));

vi.mock('@/server/autoEmbeddings', () => ({
  queueAutoEmbeddingsForImage: queueAutoEmbeddingsForImageMock,
}));

vi.mock('@/server/uploadPreparation', () => ({
  MAX_IMAGE_BYTES: 10_000_000,
  prepareImageForUpload: prepareImageForUploadMock,
}));

vi.mock('@/utils/imageUtils', () => ({
  calculateAspectRatio: vi.fn(() => ({ common: '4:3' })),
}));

vi.mock('@/server/aspectRatio', () => ({
  classifyAspectRatio: vi.fn(() => 'landscape'),
}));

vi.mock('@/server/vectorSearch', () => ({
  storeImageAspectMetadata: storeImageAspectMetadataMock,
}));

vi.mock('@/utils/comfyMetadata', () => ({
  extractComfyWorkflowMetadata: extractComfyWorkflowMetadataMock,
}));

vi.mock('@/server/comfy/workflowIngestion', () => ({
  ingestComfyWorkflowForImage: ingestComfyWorkflowForImageMock,
}));

vi.mock('@/server/imageExtras', () => ({
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

vi.mock('@/server/parentValidation', () => ({
  validateParentForNewChild: validateParentForNewChildMock,
}));

import { uploadImageBuffer } from '@/server/uploadService';

const getPostedMetadata = () => {
  const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
  const formData = init?.body as FormData | undefined;
  const metadata = formData?.get('metadata');
  if (typeof metadata !== 'string') {
    throw new Error('Expected Cloudflare upload metadata form field');
  }
  return JSON.parse(metadata) as Record<string, unknown>;
};

describe('uploadImageBuffer parent validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            id: 'generated-image',
            filename: 'generated.png',
            uploaded: '2026-06-18T00:00:00.000Z',
            variants: ['https://imagedelivery.net/hash/generated-image/public'],
            size: 12,
            meta: {},
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    validateParentForNewChildMock.mockResolvedValue({
      ok: true,
      canonicalParentId: undefined,
      canonicalParentNamespace: undefined,
    });
    prepareImageForUploadMock.mockImplementation(async ({ buffer, fileType, fileName }: {
      buffer: Buffer;
      fileType: string;
      fileName: string;
    }) => ({
      ok: true,
      data: {
        buffer,
        fileType,
        fileName,
        bytesAfter: buffer.byteLength,
        transformed: false,
        uploadNormalization: undefined,
      },
    }));
    evaluateUploadDeduplicationPolicyMock.mockResolvedValue({
      contentHashDuplicates: [],
      crossNamespaceContentHashMatches: [],
      duplicateAction: 'family',
    });
    enforceCloudflareMetadataLimitMock.mockImplementation((metadata: Record<string, unknown>) => ({
      metadata,
      dropped: [],
      size: 1,
      limitBytes: 1024,
    }));
    extractExifSummaryMock.mockResolvedValue(undefined);
    extractComfyWorkflowMetadataMock.mockResolvedValue({ detected: false, sources: [] });
    ingestComfyWorkflowForImageMock.mockResolvedValue({ persisted: false, indexed: false });
    transformApiImageToCachedMock.mockImplementation((image) => ({
      id: image.id,
      filename: image.filename,
      uploaded: image.uploaded,
      variants: image.variants,
      size: image.size,
      namespace: image.meta?.namespace,
      parentId: image.meta?.variationParentId,
    }));
    queueAutoEmbeddingsForImageMock.mockResolvedValue({ enabled: true, queued: false });
    storeImageAspectMetadataMock.mockResolvedValue(undefined);
  });

  it('stores plugin-created children under the canonical parent when the requested parent is a variant', async () => {
    validateParentForNewChildMock.mockResolvedValueOnce({
      ok: true,
      canonicalParentId: 'root-image',
      canonicalParentNamespace: 'root-ns',
      redirectedFromParentId: 'variant-image',
    });

    const result = await uploadImageBuffer({
      buffer: Buffer.from('image-bytes'),
      originalBuffer: Buffer.from('source-image-bytes'),
      fileName: 'generated.png',
      fileType: 'image/png',
      fileSize: 11,
      context: {
        accountId: 'acct',
        apiToken: 'token',
        parentId: 'variant-image',
        namespace: 'variant-ns',
        tags: ['grainrad'],
        duplicateAction: 'family',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.parentId).toBe('root-image');
    expect(result.data.namespace).toBe('root-ns');
    expect(validateParentForNewChildMock).toHaveBeenCalledWith('variant-image');
    expect(evaluateUploadDeduplicationPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'root-ns',
        requestedParentId: 'root-image',
      })
    );
    expect(getPostedMetadata()).toEqual(
      expect.objectContaining({
        namespace: 'root-ns',
        variationParentId: 'root-image',
      })
    );
  });
});
