import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { findDuplicatesByContentHash, findDuplicatesByOriginalUrl } from '@/server/duplicateDetector';
import type { toDuplicateSummary } from '@/server/duplicateDetector';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractExifSummary } from '@/utils/exif';
import { extractSnagx } from '@/utils/snagx';
import { sanitizeFilename, MAX_FILENAME_LENGTH } from '@/utils/filename';

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
  parentId?: string;
  linkedAssetId?: string;
  webpVariantId?: string;
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

const shrinkIfNeeded = async (input: Buffer, type: string): Promise<Buffer> => {
  if (input.byteLength <= MAX_IMAGE_BYTES) {
    return input;
  }
  const transformer = sharp(input).rotate();
  const metadata = await transformer.metadata();
  const width = metadata.width || 4096;
  const height = metadata.height || 4096;
  const maxDimension = Math.max(width, height);
  const targetDimension = Math.min(maxDimension, 4000);
  const scale = targetDimension / maxDimension;
  const resized = transformer.resize(Math.round(width * scale), Math.round(height * scale), { fit: 'inside' });
  const format = type.includes('png') ? 'png' : 'jpeg';
  const encoded = await resized.toFormat(format, { quality: 85 }).toBuffer();
  if (encoded.byteLength <= MAX_IMAGE_BYTES) {
    return encoded;
  }
  return resized.toFormat(format, { quality: 70 }).toBuffer();
};

export type UploadOutcome =
  | { ok: true; data: UploadSuccess }
  | { ok: false; error: string; status: number; reason?: UploadFailure['reason']; duplicates?: ReturnType<typeof findDuplicatesByOriginalUrl> };

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
    namespace,
    parentId
  } = context;
  const isSnagx = fileName.toLowerCase().endsWith('.snagx');
  if (!isSnagx && !SUPPORTED_IMAGE_TYPES.has(fileType)) {
    logIssue('Rejected non-image upload', { filename: fileName, type: fileType });
    return { ok: false, error: 'File must be an image', status: 400, reason: 'invalid-type' };
  }

  if (!isSnagx && fileSize > MAX_IMAGE_BYTES) {
    logIssue('Rejected oversized upload', { filename: fileName, bytes: fileSize, limit: MAX_IMAGE_BYTES });
    return { ok: false, error: 'File size must be less than 10MB', status: 400, reason: 'too-large' };
  }

  // Sanitize filename: truncate, clean, and handle Google Photos blobs
  let normalizedName = sanitizeFilename(fileName);
  const normalizedOriginalUrl = normalizeOriginalUrl(originalUrl);
  const normalizedSourceUrl = normalizeOriginalUrl(sourceUrl);
  let duplicateMatches: Awaited<ReturnType<typeof findDuplicatesByContentHash>> = [];
  let originalUrlDuplicates: Awaited<ReturnType<typeof findDuplicatesByOriginalUrl>> = [];

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
    } catch (error) {
      logIssue('Failed to extract .snagx image', { filename: fileName });
      return { ok: false, error: 'Failed to extract image from .snagx file', status: 400, reason: 'unsupported' };
    }
  }

  if (!SUPPORTED_IMAGE_TYPES.has(workingFileType)) {
    logIssue('Rejected unsupported type after extraction', { filename: fileName, type: workingFileType });
    return { ok: false, error: 'File must be an image', status: 400, reason: 'invalid-type' };
  }

  if (workingFileSize > MAX_IMAGE_BYTES) {
    logIssue('Rejected oversized extracted image', { filename: normalizedName, bytes: workingFileSize, limit: MAX_IMAGE_BYTES });
    return { ok: false, error: 'File size must be less than 10MB', status: 400, reason: 'too-large' };
  }

  if (normalizedOriginalUrl) {
    originalUrlDuplicates = await findDuplicatesByOriginalUrl(normalizedOriginalUrl, namespace);
    if (originalUrlDuplicates.length) {
      console.warn('[upload] Original URL already exists (not treated as duplicate)', {
        originalUrl,
        duplicateIds: originalUrlDuplicates.map(match => match.id),
        folders: originalUrlDuplicates.map(match => match.folder || null)
      });
    }
  }

  const finalBuffer = await shrinkIfNeeded(workingBuffer, workingFileType);
  const contentHash = createHash('sha256').update(finalBuffer).digest('hex');
  const exifSummary = await extractExifSummary(workingOriginalBuffer);

  duplicateMatches = await findDuplicatesByContentHash(contentHash, namespace);
  if (duplicateMatches.length) {
    console.warn('[upload] Duplicate content hash detected', {
      contentHash,
      duplicateIds: duplicateMatches.map(match => match.id),
      folders: duplicateMatches.map(match => match.folder || null)
    });
    return {
      ok: false,
      error: 'Duplicate image content detected',
      status: 409,
      reason: 'duplicate',
      duplicates: duplicateMatches
    };
  }

  const uploadFormData = new FormData();
  uploadFormData.append('file', new Blob([finalBuffer], { type: workingFileType }), normalizedName);

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
    namespace: namespace,
    contentHash,
    variationParentId: parentId,
    exif: exifSummary,
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
    meta: baseMeta
  });
  upsertCachedImage(primaryCached);

  let webpVariantId: string | undefined;
  if (fileType === 'image/svg+xml') {
    try {
      const webpBuffer = await sharp(finalBuffer).webp({ quality: 85 }).toBuffer();
      const webpName = normalizedName.replace(/\.svg$/i, '') + '.webp';
      const webpFormData = new FormData();
      webpFormData.append('file', new Blob([webpBuffer], { type: 'image/webp' }), webpName);
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
            meta: webpResult.meta && typeof webpResult.meta === 'object'
              ? { ...webpMetadataPayload, ...(webpResult.meta as Record<string, unknown>) }
              : webpMetadataPayload
          });
          upsertCachedImage(cachedVariant);
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
    }
  };
}
