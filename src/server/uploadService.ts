import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import type { toDuplicateSummary } from '@/server/duplicateDetector';
import {
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
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

// Re-export for backward compatibility
export { sanitizeFilename, MAX_FILENAME_LENGTH } from '@/utils/filename';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  sourcePath?: string;
  namespace?: string;
  parentId?: string;
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
  if (bytesBefore <= maxBytes) {
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

  if (!fileType.startsWith('image/')) {
    return { ok: false, error: 'File must be an image' };
  }

  const metadata = await sharp(buffer).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  const canResize = Boolean(sourceWidth && sourceHeight);

  const hasAlpha = metadata.hasAlpha === true;
  const qualitySteps = [92, 88, 84, 80, 76, 72, 68, 64, 60];
  const scaleSteps = canResize
    ? [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]
    : [1];
  const minDimension = 320;
  const formatOrder = hasAlpha ? ['image/webp', 'image/jpeg'] : ['image/webp', 'image/jpeg'];

  let smallestCandidate: { buffer: Buffer; type: string; quality: number; width: number; height: number } | null = null;

  for (const scale of scaleSteps) {
    const width = canResize ? Math.max(minDimension, Math.round(sourceWidth * scale)) : 0;
    const height = canResize ? Math.max(minDimension, Math.round(sourceHeight * scale)) : 0;
    const needsResize = canResize && (width !== sourceWidth || height !== sourceHeight);

    for (const quality of qualitySteps) {
      const passing: Array<{ buffer: Buffer; type: string }> = [];
      for (const nextType of formatOrder) {
        let pipeline = sharp(buffer).rotate();
        if (canResize && needsResize) {
          pipeline = pipeline.resize(width, height, {
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

        if (!smallestCandidate || encoded.byteLength < smallestCandidate.buffer.byteLength) {
          smallestCandidate = { buffer: encoded, type: nextType, quality, width, height };
        }

        if (encoded.byteLength <= maxBytes) {
          passing.push({ buffer: encoded, type: nextType });
        }
      }

      if (passing.length > 0) {
        const chosen = passing.sort((a, b) => b.buffer.byteLength - a.buffer.byteLength)[0];
        const note = canResize && needsResize
          ? `Converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} and resized to ${width}x${height} (q${quality})`
          : `Converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} (q${quality})`;
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
          },
        };
      }
    }
  }

  if (smallestCandidate) {
    return {
      ok: false,
      error: `Unable to reduce image below 10MB (smallest attempt: ${(smallestCandidate.buffer.byteLength / 1024 / 1024).toFixed(2)}MB).`,
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
    description,
    originalUrl,
    sourceUrl,
    sourcePath,
    namespace,
    parentId
  } = context;
  const isSnagx = fileName.toLowerCase().endsWith('.snagx');
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
      targetType: workingFileType,
    });
  }

  const finalBuffer = workingBuffer;
  const contentHash = createHash('sha256').update(finalBuffer).digest('hex');
  const deduplication = await evaluateUploadDeduplicationPolicy({
    contentHash,
    normalizedOriginalUrl,
    namespace,
  });
  if (deduplication.originalUrlWarning) {
    logOriginalUrlReuseWarning({
      logScope: 'upload',
      originalUrl,
      warning: deduplication.originalUrlWarning,
    });
  }

  const exifSummary = await extractExifSummary(workingOriginalBuffer);
  const comfyExtraction = await extractComfyWorkflowMetadata(workingOriginalBuffer, { mimeType: workingFileType });

  if (deduplication.contentHashDuplicates.length) {
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
    displayName: normalizedName,
    uploadedAt: new Date().toISOString(),
    size: workingFileSize,
    type: workingFileType,
    folder: folder,
    tags: tags,
    description: description,
    originalUrl: originalUrl,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: sourceUrl,
    sourceUrlNormalized: normalizedSourceUrl,
    sourcePath: sourcePath,
    namespace: namespace,
    contentHash,
    variationParentId: parentId,
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
        variationParentId: parentId,
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
      namespace: namespace,
      parentId: parentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
      autoEmbeddings,
    }
  };
}
