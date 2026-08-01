import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import type { toDuplicateSummary } from '@/server/duplicateDetector';
import {
  type DuplicateFamilySelection,
  type DuplicateOverrideSelection,
  type UploadDuplicateAction,
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logUploadDeduplicationResult,
} from '@/server/uploadDuplicatePolicy';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractExifSummary } from '@/utils/exif';
import { extractSnagx } from '@/utils/snagx';
import { sanitizeFilename } from '@/utils/filename';
import { queueAutoEmbeddingsForImage, type AutoEmbeddingsStatus } from '@/server/autoEmbeddings';
import { MAX_IMAGE_BYTES, prepareImageForUpload } from '@/server/uploadPreparation';
import type { UploadNormalizationMetadata } from '@/server/uploadPreparation';
import { calculateAspectRatio } from '@/utils/imageUtils';
import { classifyAspectRatio } from '@/server/aspectRatio';
import { storeImageAspectMetadata } from '@/server/vectorSearch';
import { extractComfyWorkflowMetadata } from '@/utils/comfyMetadata';
import { ingestComfyWorkflowForImage } from '@/server/comfy/workflowIngestion';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { validateParentForNewChild } from '@/server/parentValidation';

// Re-export for backward compatibility
export { sanitizeFilename, MAX_FILENAME_LENGTH } from '@/utils/filename';
export {
  CLOUDFLARE_MAX_ANIMATION_FRAME_AREA,
  CLOUDFLARE_MAX_IMAGE_AREA,
  CLOUDFLARE_MAX_IMAGE_DIMENSION,
  MAX_IMAGE_BYTES,
  prepareImageForUpload,
} from '@/server/uploadPreparation';
export type {
  PreparedUploadPayload,
  UploadNormalizationMetadata,
  UploadNormalizationReason,
} from '@/server/uploadPreparation';

export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif'
]);

export type UploadContext = {
  accountId: string;
  apiToken: string;
  folder?: string;
  tags: string[];
  displayName?: string;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  sourcePath?: string;
  namespace?: string;
  parentId?: string;
  duplicateAction?: UploadDuplicateAction;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  rotatedFromId?: string;
  rotatedAt?: string;
  rotationDegrees?: number;
  isAnimated?: boolean;
};

export type UploadSuccess = {
  id: string;
  filename: string;
  url: string;
  variants: string[];
  uploaded: string;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  linkedAssetId?: string;
  webpVariantId?: string;
  autoEmbeddings?: AutoEmbeddingsStatus;
  uploadNormalization?: UploadNormalizationMetadata;
  duplicateHandling?: DuplicateFamilySelection;
  duplicateOverride?: DuplicateOverrideSelection;
};

export type UploadFailure = {
  filename: string;
  error: string;
  reason?: 'invalid-type' | 'too-large' | 'duplicate' | 'upload' | 'unsupported';
  duplicates?: ReturnType<typeof toDuplicateSummary>[];
};

const logIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload] ' + message, details);
};

type BufferedAspectMetadata = {
  aspectRatio: string;
  aspectRatioClass: ReturnType<typeof classifyAspectRatio>;
  dimensions: { width: number; height: number };
};

const readAspectMetadataFromBuffer = async (buffer: Buffer): Promise<BufferedAspectMetadata | undefined> => {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return;
    const ratio = calculateAspectRatio(metadata.width, metadata.height);
    return {
      aspectRatio: ratio.common,
      aspectRatioClass: classifyAspectRatio(metadata.width, metadata.height),
      dimensions: { width: metadata.width, height: metadata.height },
    };
  } catch (error) {
    console.warn('[upload] Failed to read aspect ratio metadata', error);
    return undefined;
  }
};

const persistAspectMetadataFromBuffer = async (
  imageId: string,
  buffer: Buffer,
  knownMetadata?: BufferedAspectMetadata
) => {
  try {
    const metadata = knownMetadata ?? await readAspectMetadataFromBuffer(buffer);
    if (!metadata) return;
    await storeImageAspectMetadata({
      imageId,
      aspectRatio: metadata.aspectRatio,
      aspectRatioClass: metadata.aspectRatioClass,
      width: metadata.dimensions.width,
      height: metadata.dimensions.height,
    });
  } catch (error) {
    console.warn('[upload] Failed to persist aspect ratio metadata', error);
  }
};

export type UploadOutcome =
  | { ok: true; data: UploadSuccess }
  | {
      ok: false;
      error: string;
      status: number;
      reason?: UploadFailure['reason'];
      duplicates?: Awaited<ReturnType<typeof evaluateUploadDeduplicationPolicy>>['contentHashDuplicates'];
    };

export async function uploadImageBuffer({
  buffer,
  originalBuffer,
  fileName,
  fileType,
  fileSize,
  context
}: {
  buffer: Buffer;
  originalBuffer: Buffer;
  fileName: string;
  fileType: string;
  fileSize: number;
  context: UploadContext;
}): Promise<UploadOutcome> {
  const {
    accountId,
    apiToken,
    folder,
    tags,
    displayName,
    description,
    originalUrl,
    sourceUrl,
    sourcePath,
    namespace,
    parentId,
    duplicateAction,
    generatedBy,
    comfyMetadataDetected,
    comfyMetadataSource,
    rotatedFromId,
    rotatedAt,
    rotationDegrees,
    isAnimated,
  } = context;
  const isSnagx = fileName.toLowerCase().endsWith('.snagx');
  const normalizedNamespace = typeof namespace === 'string' && namespace.trim()
    ? namespace.trim()
    : undefined;
  const hasExplicitNamespace = Boolean(
    normalizedNamespace &&
    normalizedNamespace !== '__all__' &&
    normalizedNamespace !== '__none__' &&
    normalizedNamespace !== 'undefined'
  );

  if (!hasExplicitNamespace || !normalizedNamespace) {
    return {
      ok: false,
      error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
      status: 400,
      reason: 'upload',
    };
  }
  const parentValidation = await validateParentForNewChild(parentId);
  if (!parentValidation.ok) {
    return {
      ok: false,
      error: parentValidation.error,
      status: parentValidation.status,
      reason: 'upload',
    };
  }
  const canonicalParentId = parentValidation.canonicalParentId;
  const effectiveNamespace = parentValidation.canonicalParentNamespace ?? normalizedNamespace;

  if (!isSnagx && !SUPPORTED_IMAGE_TYPES.has(fileType)) {
    logIssue('Rejected non-image upload', { filename: fileName, type: fileType });
    return { ok: false, error: 'File must be an image', status: 400, reason: 'invalid-type' };
  }

  // Sanitize filename: truncate, clean, and handle Google Photos blobs
  let normalizedName = sanitizeFilename(fileName);
  const normalizedOriginalUrl = normalizeOriginalUrl(originalUrl);
  const normalizedSourceUrl = normalizeOriginalUrl(sourceUrl);

  let workingBuffer = buffer;
  let workingOriginalBuffer = originalBuffer;
  let workingFileType = fileType;
  let workingFileSize = fileSize;

  if (isSnagx) {
    try {
      const extracted = extractSnagx(buffer, normalizedName);
      workingBuffer = extracted.buffer;
      workingOriginalBuffer = extracted.buffer;
      workingFileType = 'image/png';
      workingFileSize = extracted.buffer.byteLength;
      // Sanitize the extracted filename too
      normalizedName = sanitizeFilename(extracted.filename);
    } catch {
      logIssue('Failed to extract .snagx image', { filename: fileName });
      return { ok: false, error: 'Failed to extract image from .snagx file', status: 400, reason: 'unsupported' };
    }
  }

  if (!SUPPORTED_IMAGE_TYPES.has(workingFileType)) {
    logIssue('Rejected unsupported type after extraction', { filename: fileName, type: workingFileType });
    return { ok: false, error: 'File must be an image', status: 400, reason: 'invalid-type' };
  }

  const prepared = await prepareImageForUpload({
    buffer: workingBuffer,
    fileType: workingFileType,
    fileName: normalizedName,
    maxBytes: MAX_IMAGE_BYTES,
  });
  if (!prepared.ok) {
    logIssue('Unable to prepare oversized image for upload', {
      filename: normalizedName,
      bytes: workingFileSize,
      limit: MAX_IMAGE_BYTES,
      error: prepared.error,
    });
    return { ok: false, error: prepared.error, status: 400, reason: 'too-large' };
  }
  workingBuffer = prepared.data.buffer;
  workingFileType = prepared.data.fileType;
  normalizedName = prepared.data.fileName;
  workingFileSize = prepared.data.bytesAfter;
  if (prepared.data.transformed) {
    logIssue('Auto-optimized oversized upload', {
      filename: normalizedName,
      beforeBytes: prepared.data.bytesBefore,
      afterBytes: prepared.data.bytesAfter,
      note: prepared.data.note,
      reasons: prepared.data.uploadNormalization?.reasons,
      targetType: workingFileType,
    });
  }

  const finalBuffer = workingBuffer;
  const contentHash = createHash('sha256').update(finalBuffer).digest('hex');
  const deduplication = await evaluateUploadDeduplicationPolicy({
    contentHash,
    normalizedOriginalUrl,
    namespace: effectiveNamespace,
    duplicateAction,
    requestedParentId: canonicalParentId,
  });
  logUploadDeduplicationResult({
    logScope: 'upload',
    contentHash,
    originalUrl,
    targetNamespace: effectiveNamespace,
    result: deduplication,
  });

  const resolvedParentId = deduplication.duplicateFamilySelection?.canonicalParentId ?? canonicalParentId;

  const exifSummary = await extractExifSummary(workingOriginalBuffer);
  const comfyExtraction = await extractComfyWorkflowMetadata(workingOriginalBuffer, { mimeType: workingFileType });
  const effectiveGeneratedBy = comfyExtraction.detected ? 'comfyui' : generatedBy;
  const effectiveComfyMetadataDetected = comfyExtraction.detected ? true : comfyMetadataDetected;
  const effectiveComfyMetadataSource = comfyExtraction.source ?? comfyMetadataSource;

  if (
    deduplication.contentHashDuplicates.length &&
    !deduplication.duplicateFamilySelection &&
    !deduplication.duplicateOverrideSelection
  ) {
    logContentHashDuplicate({
      logScope: 'upload',
      contentHash,
      duplicates: deduplication.contentHashDuplicates,
    });
    return {
      ok: false,
      error: 'Duplicate image content detected',
      status: 409,
      reason: 'duplicate',
      duplicates: deduplication.contentHashDuplicates
    };
  }

  const uploadFormData = new FormData();
  uploadFormData.append('file', new Blob([new Uint8Array(finalBuffer)], { type: workingFileType }), normalizedName);
  const bufferedAspectMetadata = await readAspectMetadataFromBuffer(finalBuffer);

  const metadataPayload: Record<string, unknown> = {
    filename: normalizedName,
    displayName: (typeof displayName === 'string' && displayName.trim()) ? displayName.trim() : normalizedName,
    uploadedAt: new Date().toISOString(),
    size: workingFileSize,
    type: workingFileType,
    folder: folder,
    tags: tags,
    sourcePath: sourcePath,
    namespace: effectiveNamespace,
    contentHash,
    variationParentId: resolvedParentId,
    duplicateFamilyOverride: deduplication.duplicateFamilySelection ? true : undefined,
    duplicateDetectionOverride: deduplication.duplicateOverrideSelection ? true : undefined,
    uploadNormalization: prepared.data.uploadNormalization,
    generatedBy: effectiveGeneratedBy,
    comfyMetadataDetected: effectiveComfyMetadataDetected,
    comfyMetadataSource: effectiveComfyMetadataSource,
    ...(bufferedAspectMetadata ?? {}),
    rotatedFromId,
    rotatedAt,
    rotationDegrees,
    isAnimated,
  };
  const extrasMetadata: Record<string, unknown> = {
    originalUrl: originalUrl || undefined,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: sourceUrl || undefined,
    sourceUrlNormalized: normalizedSourceUrl,
    exif: exifSummary,
  };
  const cachedMetadataPayload = {
    ...metadataPayload,
    ...extrasMetadata,
  };

  const { metadata: limitedMetadata, dropped, size, limitBytes } = enforceCloudflareMetadataLimit(metadataPayload);
  if (dropped.length) {
    logIssue('Metadata trimmed to fit Cloudflare limits', { dropped, size, limitBytes });
  }
  uploadFormData.append('metadata', JSON.stringify(limitedMetadata));

  const cloudflareResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
      body: uploadFormData,
    }
  );

  // Handle non-JSON responses (rate limits, timeouts, HTML error pages)
  const contentType = cloudflareResponse.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const textBody = await cloudflareResponse.text();
    console.error('Cloudflare returned non-JSON response:', {
      status: cloudflareResponse.status,
      statusText: cloudflareResponse.statusText,
      contentType,
      bodyPreview: textBody.slice(0, 500)
    });
    
    // Detect specific error conditions
    let errorMessage = 'Cloudflare returned an unexpected response';
    if (cloudflareResponse.status === 429) {
      errorMessage = 'Rate limited by Cloudflare. Please wait and try again.';
    } else if (cloudflareResponse.status === 503 || cloudflareResponse.status === 502) {
      errorMessage = 'Cloudflare service temporarily unavailable. Please retry.';
    } else if (cloudflareResponse.status === 408 || textBody.includes('timeout')) {
      errorMessage = 'Request timed out. The file may be too large or the connection is slow.';
    } else if (cloudflareResponse.status >= 500) {
      errorMessage = `Cloudflare server error (${cloudflareResponse.status}). Please retry.`;
    }
    
    return {
      ok: false,
      error: errorMessage,
      status: cloudflareResponse.status,
      reason: 'upload'
    };
  }

  const result = await cloudflareResponse.json();

  if (!cloudflareResponse.ok) {
    console.error('Cloudflare API error:', result);
    return {
      ok: false,
      error: result.errors?.[0]?.message || 'Failed to upload to Cloudflare',
      status: cloudflareResponse.status,
      reason: 'upload'
    };
  }

  const imageData = result.result;
  const serverMeta = imageData.meta && typeof imageData.meta === 'object'
    ? (imageData.meta as Record<string, unknown>)
    : undefined;
  const baseMeta = serverMeta ? { ...cachedMetadataPayload, ...serverMeta } : cachedMetadataPayload;
  const primaryCached = transformApiImageToCached({
    id: imageData.id,
    filename: imageData.filename,
    uploaded: imageData.uploaded,
    variants: imageData.variants,
    size: imageData.size,
    meta: baseMeta
  });
  // These stores are independent of each other, so write them concurrently.
  // Exception: the comfy ingest patches the same extras record as
  // patchImageExtrasRecord (read-modify-write), so those two stay chained.
  const extrasChain = (async () => {
    await patchImageExtrasRecord(imageData.id, {
      ...(description ? { description } : {}),
      ...extrasMetadata,
    });
    try {
      await ingestComfyWorkflowForImage({
        imageId: imageData.id,
        comfyExtraction,
        imageDescription: {
          description,
        },
        embeddingModel: 'clip-ViT-B-32',
        embeddingVersion: 'v1',
      });
    } catch (error) {
      console.warn('[upload] Failed to ingest comfy workflow extras', {
        imageId: imageData.id,
        error,
      });
    }
  })();
  const [, , , autoEmbeddings] = await Promise.all([
    upsertCachedImage(primaryCached),
    extrasChain,
    persistAspectMetadataFromBuffer(imageData.id, finalBuffer, bufferedAspectMetadata),
    queueAutoEmbeddingsForImage(primaryCached),
  ]);

  let webpVariantId: string | undefined;
  if (workingFileType === 'image/svg+xml') {
    try {
      const webpBuffer = await sharp(finalBuffer).webp({ quality: 85 }).toBuffer();
      const webpName = normalizedName.replace(/\.svg$/i, '') + '.webp';
      const webpFormData = new FormData();
      webpFormData.append('file', new Blob([new Uint8Array(webpBuffer)], { type: 'image/webp' }), webpName);
      const webpMetadataPayload = {
        ...metadataPayload,
        filename: webpName,
        displayName: webpName,
        variationParentId: resolvedParentId,
        linkedAssetId: imageData.id,
      };
      const { metadata: limitedWebpMetadata, dropped, size, limitBytes } = enforceCloudflareMetadataLimit(webpMetadataPayload);
      if (dropped.length) {
        logIssue('Metadata trimmed for webp variant', { dropped, size, limitBytes });
      }
      webpFormData.append('metadata', JSON.stringify(limitedWebpMetadata));
      const webpResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
          },
          body: webpFormData,
        }
      );
      const webpJson = await webpResponse.json();
      if (!webpResponse.ok) {
        console.error('Cloudflare WebP upload error:', webpJson);
      } else {
        const webpResult = webpJson.result;
        webpVariantId = webpResult?.id;
        if (webpResult) {
          const cachedVariant = transformApiImageToCached({
            id: webpResult.id,
            filename: webpResult.filename,
            uploaded: webpResult.uploaded,
            variants: webpResult.variants,
            size: webpResult.size,
            meta: webpResult.meta && typeof webpResult.meta === 'object'
              ? { ...cachedMetadataPayload, ...webpMetadataPayload, ...(webpResult.meta as Record<string, unknown>) }
              : { ...cachedMetadataPayload, ...webpMetadataPayload }
          });
          await upsertCachedImage(cachedVariant);
          await patchImageExtrasRecord(webpResult.id, {
            ...(description ? { description } : {}),
            ...extrasMetadata,
          });
          await persistAspectMetadataFromBuffer(webpResult.id, webpBuffer);
          await queueAutoEmbeddingsForImage(cachedVariant);
        }
      }
    } catch (err) {
      console.error('Failed to convert SVG to WebP', err);
    }
  }

  if (webpVariantId) {
    const updatedMetadata = {
      ...metadataPayload,
      linkedAssetId: webpVariantId,
      updatedAt: new Date().toISOString(),
    };
    const { metadata: limitedUpdatedMetadata, dropped, size, limitBytes } = enforceCloudflareMetadataLimit(updatedMetadata);
    if (dropped.length) {
      logIssue('Metadata trimmed for linked asset update', { dropped, size, limitBytes });
    }
    try {
      const patchResp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageData.id}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metadata: limitedUpdatedMetadata }),
        }
      );
      if (!patchResp.ok) {
        const patchJson = await patchResp.json();
        console.error('Failed to patch SVG metadata', patchJson);
      } else {
        const updatedPrimary = transformApiImageToCached({
          id: imageData.id,
          filename: imageData.filename,
          uploaded: imageData.uploaded,
          variants: imageData.variants,
          size: imageData.size,
          meta: {
            ...updatedMetadata,
            ...extrasMetadata,
          }
        });
        await upsertCachedImage(updatedPrimary);
      }
    } catch (err) {
      console.error('Failed to patch SVG metadata', err);
    }
  }

  return {
    ok: true,
    data: {
      id: imageData.id,
      filename: normalizedName,
      url: imageData.variants.find((v: string) => v.includes('public')) || imageData.variants[0],
      variants: imageData.variants,
      uploaded: new Date().toISOString(),
      folder: folder,
      tags: tags,
      description: description,
      originalUrl: originalUrl,
      sourceUrl: sourceUrl,
      namespace: effectiveNamespace,
      parentId: resolvedParentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
      autoEmbeddings,
      uploadNormalization: prepared.data.uploadNormalization,
      duplicateHandling: deduplication.duplicateFamilySelection,
      duplicateOverride: deduplication.duplicateOverrideSelection,
    }
  };
}
