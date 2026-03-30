import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import type { toDuplicateSummary } from '@/server/duplicateDetector';
import {
  type DuplicateFamilySelection,
  type UploadDuplicateAction,
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logCrossNamespaceContentHashWarning,
  logDuplicateFamilySelection,
  logOriginalUrlReuseWarning,
} from '@/server/uploadDuplicatePolicy';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractExifSummary } from '@/utils/exif';
import { extractSnagx } from '@/utils/snagx';
import { sanitizeFilename } from '@/utils/filename';
import { queueAutoEmbeddingsForImage, type AutoEmbeddingsStatus } from '@/server/autoEmbeddings';
import { calculateAspectRatio } from '@/utils/imageUtils';
import { classifyAspectRatio } from '@/server/aspectRatio';
import { storeImageAspectMetadata } from '@/server/vectorSearch';
import { extractComfyWorkflowMetadata } from '@/utils/comfyMetadata';
import { ingestComfyWorkflowForImage } from '@/server/comfy/workflowIngestion';
import { patchImageExtrasRecord } from '@/server/imageExtras';

// Re-export for backward compatibility
export { sanitizeFilename, MAX_FILENAME_LENGTH } from '@/utils/filename';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CLOUDFLARE_MAX_IMAGE_DIMENSION = 12_000;
export const CLOUDFLARE_MAX_IMAGE_AREA = 100_000_000;
export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
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

const persistAspectMetadataFromBuffer = async (imageId: string, buffer: Buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return;
    const ratio = calculateAspectRatio(metadata.width, metadata.height);
    await storeImageAspectMetadata({
      imageId,
      aspectRatio: ratio.common,
      aspectRatioClass: classifyAspectRatio(metadata.width, metadata.height),
      width: metadata.width,
      height: metadata.height,
    });
  } catch (error) {
    console.warn('[upload] Failed to persist aspect ratio metadata', error);
  }
};

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const withExtensionForType = (fileName: string, fileType: string) => {
  const ext = IMAGE_EXTENSION_BY_TYPE[fileType];
  if (!ext) return fileName;
  if (fileName.toLowerCase().endsWith(ext)) return fileName;
  if (/\.[a-z0-9]+$/i.test(fileName)) {
    return fileName.replace(/\.[^.]+$/, ext);
  }
  return `${fileName}${ext}`;
};

export type PreparedUploadPayload = {
  buffer: Buffer;
  fileType: string;
  fileName: string;
  transformed: boolean;
  bytesBefore: number;
  bytesAfter: number;
  note?: string;
  uploadNormalization?: UploadNormalizationMetadata;
};

type UploadNormalizationReason = 'max-bytes' | 'max-dimension' | 'max-area';

export type UploadNormalizationMetadata = {
  reasons: UploadNormalizationReason[];
  originalBytes: number;
  finalBytes: number;
  maxBytes: number;
  maxDimension: number;
  maxArea: number;
  originalType: string;
  finalType: string;
  originalWidth?: number;
  originalHeight?: number;
  finalWidth?: number;
  finalHeight?: number;
};

const evaluateConstraintReasons = ({
  bytes,
  width,
  height,
  maxBytes,
  maxDimension,
  maxArea,
}: {
  bytes: number;
  width?: number;
  height?: number;
  maxBytes: number;
  maxDimension: number;
  maxArea: number;
}): UploadNormalizationReason[] => {
  const reasons: UploadNormalizationReason[] = [];
  if (bytes > maxBytes) {
    reasons.push('max-bytes');
  }
  if (typeof width === 'number' && typeof height === 'number') {
    if (width > maxDimension || height > maxDimension) {
      reasons.push('max-dimension');
    }
    if (width * height > maxArea) {
      reasons.push('max-area');
    }
  }
  return reasons;
};

const describeReasons = (reasons: UploadNormalizationReason[]): string => {
  const labels = reasons.map((reason) => {
    if (reason === 'max-bytes') return 'byte limit';
    if (reason === 'max-dimension') return 'dimension limit';
    return 'pixel-area limit';
  });
  return labels.join(', ');
};

const resolveFitInsideDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) => {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
};

export async function prepareImageForUpload({
  buffer,
  fileType,
  fileName,
  maxBytes = MAX_IMAGE_BYTES,
}: {
  buffer: Buffer;
  fileType: string;
  fileName: string;
  maxBytes?: number;
}): Promise<{ ok: true; data: PreparedUploadPayload } | { ok: false; error: string }> {
  const bytesBefore = buffer.byteLength;

  if (!fileType.startsWith('image/')) {
    return { ok: false, error: 'File must be an image' };
  }

  let metadata: sharp.Metadata | undefined;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    metadata = undefined;
  }

  const sourceWidth = typeof metadata?.width === 'number' ? metadata.width : 0;
  const sourceHeight = typeof metadata?.height === 'number' ? metadata.height : 0;
  const canResize = Boolean(sourceWidth && sourceHeight);
  const sourceReasons = evaluateConstraintReasons({
    bytes: bytesBefore,
    width: canResize ? sourceWidth : undefined,
    height: canResize ? sourceHeight : undefined,
    maxBytes,
    maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
    maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
  });

  if (sourceReasons.length === 0) {
    return {
      ok: true,
      data: {
        buffer,
        fileType,
        fileName,
        transformed: false,
        bytesBefore,
        bytesAfter: bytesBefore,
      },
    };
  }

  if (!canResize && sourceReasons.some((reason) => reason !== 'max-bytes')) {
    return { ok: false, error: 'Unable to determine image dimensions for Cloudflare upload limits.' };
  }

  const hasAlpha = metadata?.hasAlpha === true;
  const qualitySteps = [92, 88, 84, 80, 76, 72, 68, 64, 60];
  const sourceArea = canResize ? sourceWidth * sourceHeight : 0;
  const scaleToRespectDimension = canResize
    ? Math.min(1, CLOUDFLARE_MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight))
    : 1;
  const scaleToRespectArea = canResize && sourceArea > 0
    ? Math.min(1, Math.sqrt(CLOUDFLARE_MAX_IMAGE_AREA / sourceArea))
    : 1;
  const requiredScale = Math.min(1, scaleToRespectDimension, scaleToRespectArea);
  const rawScaleSteps = canResize
    ? Array.from(new Set([
        1,
        0.96,
        0.92,
        0.88,
        0.84,
        0.8,
        0.75,
        0.7,
        0.65,
        0.6,
        0.55,
        0.5,
        0.45,
        0.4,
        0.35,
        0.3,
        Number(requiredScale.toFixed(4)),
        Number((requiredScale * 0.98).toFixed(4)),
      ].filter((scale) => scale > 0 && scale <= 1))).sort((a, b) => b - a)
    : [1];
  const requiresDimensionOrAreaDownscale = sourceReasons.includes('max-dimension') || sourceReasons.includes('max-area');
  const scaleSteps = requiresDimensionOrAreaDownscale
    ? rawScaleSteps.filter((scale) => scale <= requiredScale + 0.0005)
    : rawScaleSteps;
  const minDimension = 320;
  const formatOrder = hasAlpha ? ['image/webp', 'image/jpeg'] : ['image/webp', 'image/jpeg'];

  let smallestCandidate:
    | {
        buffer: Buffer;
        type: string;
        quality: number;
        width?: number;
        height?: number;
        reasons: UploadNormalizationReason[];
      }
    | null = null;

  for (const scale of scaleSteps) {
    const requestedWidth = canResize ? Math.max(minDimension, Math.round(sourceWidth * scale)) : 0;
    const requestedHeight = canResize ? Math.max(minDimension, Math.round(sourceHeight * scale)) : 0;
    const needsResize = canResize && (requestedWidth !== sourceWidth || requestedHeight !== sourceHeight);
    const resizedDimensions = canResize
      ? (needsResize
          ? resolveFitInsideDimensions(sourceWidth, sourceHeight, requestedWidth, requestedHeight)
          : { width: sourceWidth, height: sourceHeight })
      : undefined;

    for (const quality of qualitySteps) {
      const passing: Array<{ buffer: Buffer; type: string; width?: number; height?: number }> = [];
      for (const nextType of formatOrder) {
        let pipeline = sharp(buffer).rotate();
        if (canResize && needsResize) {
          pipeline = pipeline.resize(requestedWidth, requestedHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }
        const encoded =
          nextType === 'image/webp'
            ? await pipeline.webp({ quality, effort: 4 }).toBuffer()
            : await pipeline
                .flatten({ background: '#ffffff' })
                .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
                .toBuffer();

        const encodedReasons = evaluateConstraintReasons({
          bytes: encoded.byteLength,
          width: resizedDimensions?.width,
          height: resizedDimensions?.height,
          maxBytes,
          maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
          maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
        });

        if (!smallestCandidate || encoded.byteLength < smallestCandidate.buffer.byteLength) {
          smallestCandidate = {
            buffer: encoded,
            type: nextType,
            quality,
            width: resizedDimensions?.width,
            height: resizedDimensions?.height,
            reasons: encodedReasons,
          };
        }

        if (encodedReasons.length === 0) {
          passing.push({
            buffer: encoded,
            type: nextType,
            width: resizedDimensions?.width,
            height: resizedDimensions?.height,
          });
        }
      }

      if (passing.length > 0) {
        const chosen = passing.sort((a, b) => b.buffer.byteLength - a.buffer.byteLength)[0];
        const notePrefix = sourceReasons.length
          ? `Adjusted for ${describeReasons(sourceReasons)}`
          : 'Adjusted for upload limits';
        const note = canResize && chosen.width && chosen.height && needsResize
          ? `${notePrefix}: converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} and resized to ${chosen.width}x${chosen.height} (q${quality})`
          : `${notePrefix}: converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} (q${quality})`;
        return {
          ok: true,
          data: {
            buffer: chosen.buffer,
            fileType: chosen.type,
            fileName: withExtensionForType(fileName, chosen.type),
            transformed: true,
            bytesBefore,
            bytesAfter: chosen.buffer.byteLength,
            note,
            uploadNormalization: {
              reasons: sourceReasons,
              originalBytes: bytesBefore,
              finalBytes: chosen.buffer.byteLength,
              maxBytes,
              maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
              maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
              originalType: fileType,
              finalType: chosen.type,
              originalWidth: canResize ? sourceWidth : undefined,
              originalHeight: canResize ? sourceHeight : undefined,
              finalWidth: chosen.width,
              finalHeight: chosen.height,
            },
          },
        };
      }
    }
  }

  if (smallestCandidate) {
    const unsatisfied = smallestCandidate.reasons.length
      ? ` Remaining issues: ${describeReasons(smallestCandidate.reasons)}.`
      : '';
    return {
      ok: false,
      error: `Unable to satisfy upload limits (smallest attempt: ${(smallestCandidate.buffer.byteLength / 1024 / 1024).toFixed(2)}MB).${unsatisfied}`,
    };
  }

  return { ok: false, error: 'Unable to convert image for upload' };
}

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
    namespace: normalizedNamespace,
    duplicateAction,
    requestedParentId: parentId,
  });
  if (deduplication.originalUrlWarning) {
    logOriginalUrlReuseWarning({
      logScope: 'upload',
      originalUrl,
      warning: deduplication.originalUrlWarning,
    });
  }
  if (deduplication.crossNamespaceContentHashMatches.length) {
    logCrossNamespaceContentHashWarning({
      logScope: 'upload',
      contentHash,
      targetNamespace: normalizedNamespace,
      matches: deduplication.crossNamespaceContentHashMatches,
    });
  }
  if (deduplication.duplicateFamilySelection) {
    logDuplicateFamilySelection({
      logScope: 'upload',
      contentHash,
      selection: deduplication.duplicateFamilySelection,
    });
  }

  const resolvedParentId = deduplication.duplicateFamilySelection?.canonicalParentId ?? parentId;

  const exifSummary = await extractExifSummary(workingOriginalBuffer);
  const comfyExtraction = await extractComfyWorkflowMetadata(workingOriginalBuffer, { mimeType: workingFileType });

  if (deduplication.contentHashDuplicates.length && !deduplication.duplicateFamilySelection) {
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

  const metadataPayload: Record<string, unknown> = {
    filename: normalizedName,
    displayName: (typeof displayName === 'string' && displayName.trim()) ? displayName.trim() : normalizedName,
    uploadedAt: new Date().toISOString(),
    size: workingFileSize,
    type: workingFileType,
    folder: folder,
    tags: tags,
    originalUrl: originalUrl,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: sourceUrl,
    sourceUrlNormalized: normalizedSourceUrl,
    sourcePath: sourcePath,
    namespace: normalizedNamespace,
    contentHash,
    variationParentId: resolvedParentId,
    duplicateFamilyOverride: deduplication.duplicateFamilySelection ? true : undefined,
    uploadNormalization: prepared.data.uploadNormalization,
    exif: exifSummary,
    generatedBy: comfyExtraction.detected ? 'comfyui' : undefined,
    comfyMetadataDetected: comfyExtraction.detected ? true : undefined,
    comfyMetadataSource: comfyExtraction.source,
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
  const baseMeta = serverMeta ? { ...metadataPayload, ...serverMeta } : metadataPayload;
  const primaryCached = transformApiImageToCached({
    id: imageData.id,
    filename: imageData.filename,
    uploaded: imageData.uploaded,
    variants: imageData.variants,
    size: imageData.size,
    meta: baseMeta
  });
  upsertCachedImage(primaryCached);

  if (description) {
    await patchImageExtrasRecord(imageData.id, { description });
  }

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

  await persistAspectMetadataFromBuffer(imageData.id, finalBuffer);

  const autoEmbeddings = await queueAutoEmbeddingsForImage(primaryCached);

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
              ? { ...webpMetadataPayload, ...(webpResult.meta as Record<string, unknown>) }
              : webpMetadataPayload
          });
          upsertCachedImage(cachedVariant);
          if (description) {
            await patchImageExtrasRecord(webpResult.id, { description });
          }
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
          meta: updatedMetadata
        });
        upsertCachedImage(updatedPrimary);
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
      namespace: normalizedNamespace,
      parentId: resolvedParentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
      autoEmbeddings,
      uploadNormalization: prepared.data.uploadNormalization,
      duplicateHandling: deduplication.duplicateFamilySelection,
    }
  };
}
