import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { findDuplicatesByContentHash, findDuplicatesByOriginalUrl, toDuplicateSummary } from '@/server/duplicateDetector';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractExifSummary } from '@/utils/exif';
import { extractSnagx } from '@/utils/snagx';

const logIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload] ' + message, details);
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const isZipFile = (file: File) =>
  file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.toLowerCase().endsWith('.zip');

const getMimeTypeFromFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const normalizeFilename = (filename: string) => {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] || filename;
};

export async function POST(request: NextRequest) {
  try {
    // Check for required environment variables
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      logIssue('No file provided in form submission');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    const computeContentHash = (payload: Buffer) =>
      createHash('sha256').update(payload).digest('hex');

    // Get folder, tags, description, and URLs from form data
    const folder = formData.get('folder') as string;
    const tags = formData.get('tags') as string;
    const description = formData.get('description') as string;
    const originalUrl = formData.get('originalUrl') as string;
    const sourceUrl = formData.get('sourceUrl') as string;
    const namespace = formData.get('namespace') as string;
    const parentIdRaw = formData.get('parentId');
    
    // Clean up values - handle empty strings and "undefined" strings
    const cleanFolder = folder && folder.trim() && folder !== 'undefined' ? folder.trim() : undefined;
    const cleanTags = tags && tags.trim() ? tags.trim().split(',').map(t => t.trim()).filter(t => t) : [];
    const cleanDescription = description && description.trim() && description !== 'undefined' ? description.trim() : undefined;
    const cleanOriginalUrl = originalUrl && originalUrl.trim() && originalUrl !== 'undefined' ? originalUrl.trim() : undefined;
    const cleanSourceUrl = sourceUrl && sourceUrl.trim() && sourceUrl !== 'undefined' ? sourceUrl.trim() : undefined;
    const cleanSourceUrlNormalized = normalizeOriginalUrl(cleanSourceUrl);
    const cleanNamespace = namespace && namespace.trim() && namespace !== 'undefined' ? namespace.trim() : undefined;
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || undefined;
    const effectiveNamespace = cleanNamespace || defaultNamespace;
    const parentIdValue = typeof parentIdRaw === 'string' ? parentIdRaw.trim() : '';
    const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

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

    type UploadSuccess = {
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
    type UploadFailure = {
      filename: string;
      error: string;
      reason?: 'invalid-type' | 'too-large' | 'duplicate' | 'upload' | 'unsupported';
    };
    type DuplicateMatches = Awaited<ReturnType<typeof findDuplicatesByOriginalUrl>>;

    const uploadSingleImage = async ({
      buffer,
      originalBuffer,
      fileName,
      fileType,
      fileSize,
    }: {
      buffer: Buffer;
      originalBuffer: Buffer;
      fileName: string;
      fileType: string;
      fileSize: number;
    }): Promise<{ ok: true; data: UploadSuccess } | { ok: false; error: string; status: number; reason?: UploadFailure['reason']; duplicates?: DuplicateMatches }> => {
      const isSnagx = fileName.toLowerCase().endsWith('.snagx');
      if (!isSnagx && !SUPPORTED_IMAGE_TYPES.has(fileType)) {
        logIssue('Rejected non-image upload', { filename: fileName, type: fileType });
        return { ok: false, error: 'File must be an image', status: 400, reason: 'invalid-type' };
      }

      if (!isSnagx && fileSize > MAX_IMAGE_BYTES) {
        logIssue('Rejected oversized upload', { filename: fileName, bytes: fileSize, limit: MAX_IMAGE_BYTES });
        return { ok: false, error: 'File size must be less than 10MB', status: 400, reason: 'too-large' };
      }

      let normalizedName = normalizeFilename(fileName);
      const normalizedOriginalUrl = normalizeOriginalUrl(cleanOriginalUrl);
      let duplicateMatches: DuplicateMatches = [];

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
          normalizedName = extracted.filename;
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
        duplicateMatches = await findDuplicatesByOriginalUrl(normalizedOriginalUrl, effectiveNamespace);
        if (duplicateMatches.length) {
          console.warn('[upload] Duplicate original URL detected', {
            originalUrl: cleanOriginalUrl,
            duplicateIds: duplicateMatches.map(match => match.id),
            folders: duplicateMatches.map(match => match.folder || null)
          });
          return {
            ok: false,
            error: `Duplicate original URL "${cleanOriginalUrl}" detected`,
            status: 409,
            reason: 'duplicate',
            duplicates: duplicateMatches
          };
        }
      }

      let finalBuffer = await shrinkIfNeeded(workingBuffer, workingFileType);
      const contentHash = computeContentHash(finalBuffer);
      const exifSummary = await extractExifSummary(workingOriginalBuffer);

      if (!normalizedOriginalUrl) {
        duplicateMatches = await findDuplicatesByContentHash(contentHash, effectiveNamespace);
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
      }

      const uploadFormData = new FormData();
      uploadFormData.append('file', new Blob([finalBuffer], { type: workingFileType }), normalizedName);

      const metadataPayload: Record<string, unknown> = {
        filename: normalizedName,
        displayName: normalizedName,
        uploadedAt: new Date().toISOString(),
        size: workingFileSize,
        type: workingFileType,
        folder: cleanFolder,
        tags: cleanTags,
        description: cleanDescription,
        originalUrl: cleanOriginalUrl,
        originalUrlNormalized: normalizedOriginalUrl,
        sourceUrl: cleanSourceUrl,
        sourceUrlNormalized: cleanSourceUrlNormalized,
        namespace: effectiveNamespace,
        contentHash,
        variationParentId: cleanParentId,
        exif: exifSummary,
      };

      const { metadata: limitedMetadata, dropped } = enforceCloudflareMetadataLimit(metadataPayload);
      if (dropped.length) {
        logIssue('Metadata trimmed to fit Cloudflare limits', { dropped });
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
      const baseMeta = imageData.meta ?? limitedMetadata;
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
            variationParentId: cleanParentId,
            linkedAssetId: imageData.id,
          };
          const { metadata: limitedWebpMetadata, dropped } = enforceCloudflareMetadataLimit(webpMetadataPayload);
          if (dropped.length) {
            logIssue('Metadata trimmed for webp variant', { dropped });
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
                meta: webpResult.meta ?? limitedWebpMetadata
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
        const { metadata: limitedUpdatedMetadata, dropped } = enforceCloudflareMetadataLimit(updatedMetadata);
        if (dropped.length) {
          logIssue('Metadata trimmed for linked asset update', { dropped });
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
          folder: cleanFolder,
          tags: cleanTags,
          description: cleanDescription,
          originalUrl: cleanOriginalUrl,
          sourceUrl: cleanSourceUrl,
          namespace: effectiveNamespace,
          parentId: cleanParentId,
          linkedAssetId: webpVariantId,
          webpVariantId,
        }
      };
    };

    if (isZipFile(file)) {
      if (file.size > MAX_ZIP_BYTES) {
        logIssue('Rejected oversized zip upload', { filename: file.name, bytes: file.size, limit: MAX_ZIP_BYTES });
        return NextResponse.json(
          { error: 'Zip file size must be less than 100MB' },
          { status: 400 }
        );
      }

      const zipBuffer = Buffer.from(await file.arrayBuffer());
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const results: UploadSuccess[] = [];
      const failures: UploadFailure[] = [];
      const skipped: { filename: string; reason: string }[] = [];

      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }
        const entryName = normalizeFilename(entry.entryName);
        const entryType = getMimeTypeFromFilename(entryName);
        if (!entryType || !SUPPORTED_IMAGE_TYPES.has(entryType)) {
          skipped.push({ filename: entryName, reason: 'Not an image file' });
          continue;
        }

        const entryBuffer = entry.getData();
        const outcome = await uploadSingleImage({
          buffer: entryBuffer,
          originalBuffer: entryBuffer,
          fileName: entryName,
          fileType: entryType,
          fileSize: entryBuffer.byteLength
        });

        if (outcome.ok) {
          results.push(outcome.data);
        } else {
          failures.push({
            filename: entryName,
            error: outcome.error,
            reason: outcome.reason ?? 'upload'
          });
        }
      }

      if (results.length === 0 && failures.length === 0) {
        return NextResponse.json(
          { error: 'No supported images found in zip' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        results,
        failures,
        skipped,
        successCount: results.length,
        failureCount: failures.length,
        skippedCount: skipped.length,
        isZip: true
      });
    }

    const fileType = file.type || getMimeTypeFromFilename(file.name) || '';
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const outcome = await uploadSingleImage({
      buffer: fileBuffer,
      originalBuffer: fileBuffer,
      fileName: file.name,
      fileType,
      fileSize: file.size
    });

    if (!outcome.ok) {
      if (outcome.reason === 'duplicate') {
        return NextResponse.json(
          {
            error: outcome.error,
            duplicates: outcome.duplicates ? outcome.duplicates.map(toDuplicateSummary) : []
          },
          { status: outcome.status }
        );
      }
      return NextResponse.json(
        { error: outcome.error },
        { status: outcome.status }
      );
    }

    return NextResponse.json(outcome.data);

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
