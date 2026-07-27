import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { cacheUploadedCloudflareImage } from '@/server/cloudflareImageWriteThrough';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import {
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logUploadDeduplicationResult,
} from '@/server/uploadDuplicatePolicy';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractSnagx } from '@/utils/snagx';
import { extractExifSummary } from '@/utils/exif';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { MAX_IMAGE_BYTES, prepareImageForUpload, sanitizeFilename } from '@/server/uploadService';
import { queueAutoEmbeddingsForImage } from '@/server/autoEmbeddings';
import { extractComfyWorkflowMetadata } from '@/utils/comfyMetadata';
import { ingestComfyWorkflowForImage } from '@/server/comfy/workflowIngestion';
import { validateParentForNewChild } from '@/server/parentValidation';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { requireValidFolderName } from '@/server/folderPolicy';
import {
  applyWorkflowOverride,
  parseCloudflareUploadApiResponse,
  parseExternalUploadFormFields,
  persistUploadPrompt,
  withCors,
} from '@/server/uploadExternalRoute';

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.DISABLE_EXTERNAL_API === 'true') {
      return withCors(NextResponse.json(
        { error: 'External upload API is disabled by configuration.' },
        { status: 403 }
      ));
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return withCors(NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      ));
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      logExternalIssue('No file provided');
      return withCors(NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      ));
    }

    const isSnagx = file.name.toLowerCase().endsWith('.snagx');
    if (!isSnagx && !file.type.startsWith('image/')) {
      logExternalIssue('Rejected non-image upload', { filename: file.name, type: file.type });
      return withCors(NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      ));
    }

    const computeContentHash = (payload: Buffer) => createHash('sha256').update(payload).digest('hex');
    const parsedFields = parseExternalUploadFormFields(formData);
    if (!parsedFields.ok) {
      return withCors(NextResponse.json(
        { error: parsedFields.error },
        { status: parsedFields.status }
      ));
    }
    const {
      cleanFolder,
      cleanTags,
      cleanDescription,
      cleanDisplayName,
      cleanOriginalUrl,
      normalizedOriginalUrl,
      cleanSourceUrl,
      normalizedSourceUrl,
      instagramSourceField,
      effectiveNamespace,
      cleanParentId,
      duplicateAction,
      promptField,
      workflowJsonField,
    } = parsedFields.fields;

    if (!instagramSourceField.ok) {
      return withCors(NextResponse.json(
        { error: instagramSourceField.error },
        { status: 400 }
      ));
    }

    if (cleanFolder) {
      try {
        requireValidFolderName(cleanFolder);
      } catch (error) {
        return withCors(NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid folder name' },
          { status: 400 }
        ));
      }
    }

    if (!promptField.ok) {
      logExternalIssue('Rejected invalid prompt payload');
      return withCors(NextResponse.json(
        { error: promptField.error },
        { status: 400 }
      ));
    }
    const cleanPrompt = promptField.prompt;

    if (!workflowJsonField.ok) {
      logExternalIssue('Rejected invalid comfy workflow payload', { reason: workflowJsonField.error });
      return withCors(NextResponse.json(
        { error: workflowJsonField.error },
        { status: 400 }
      ));
    }

    const parentValidation = await validateParentForNewChild(cleanParentId);
    if (!parentValidation.ok) {
      return withCors(
        NextResponse.json(
          { error: parentValidation.error },
          { status: parentValidation.status }
        )
      );
    }
    const resolvedParentId = parentValidation.canonicalParentId;

    const bytes = await file.arrayBuffer();
    const originalBuffer = Buffer.from(bytes);
    let workingBuffer: Buffer = originalBuffer;
    let workingType = file.type;
    let workingName = sanitizeFilename(file.name);

    if (isSnagx) {
      try {
        const extracted = extractSnagx(originalBuffer, file.name);
        workingBuffer = extracted.buffer;
        workingType = 'image/png';
        workingName = sanitizeFilename(extracted.filename);
      } catch {
        logExternalIssue('Failed to extract .snagx image', { filename: file.name });
        return withCors(NextResponse.json(
          { error: 'Failed to extract image from .snagx file' },
          { status: 400 }
        ));
      }
    }

    const sourceBufferForMetadata = workingBuffer;
    const exifSummary = await extractExifSummary(sourceBufferForMetadata);
    const comfyExtraction = applyWorkflowOverride(
      await extractComfyWorkflowMetadata(sourceBufferForMetadata, { mimeType: workingType }),
      workflowJsonField.workflowJson
    );

    const prepared = await prepareImageForUpload({
      buffer: workingBuffer,
      fileType: workingType,
      fileName: workingName,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (!prepared.ok) {
      logExternalIssue('Unable to prepare oversized image for upload', {
        filename: workingName,
        bytes: workingBuffer.byteLength,
        limit: MAX_IMAGE_BYTES,
        error: prepared.error,
      });
      return withCors(NextResponse.json(
        { error: prepared.error },
        { status: 400 }
      ));
    }
    if (prepared.data.transformed) {
      logExternalIssue('Auto-optimized oversized upload', {
        filename: workingName,
        beforeBytes: prepared.data.bytesBefore,
        afterBytes: prepared.data.bytesAfter,
        note: prepared.data.note,
        reasons: prepared.data.uploadNormalization?.reasons,
        targetType: prepared.data.fileType,
      });
    }
    workingBuffer = prepared.data.buffer;
    workingType = prepared.data.fileType;
    workingName = prepared.data.fileName;

    const contentHash = computeContentHash(workingBuffer);
    const deduplication = await evaluateUploadDeduplicationPolicy({
      contentHash,
      normalizedOriginalUrl,
      namespace: effectiveNamespace,
      duplicateAction,
      requestedParentId: resolvedParentId,
    });
    logUploadDeduplicationResult({
      logScope: 'upload/external',
      contentHash,
      originalUrl: cleanOriginalUrl,
      targetNamespace: effectiveNamespace,
      result: deduplication,
    });

    const effectiveParentId = deduplication.duplicateFamilySelection?.canonicalParentId ?? resolvedParentId;

    if (
      deduplication.contentHashDuplicates.length &&
      !deduplication.duplicateFamilySelection &&
      !deduplication.duplicateOverrideSelection
    ) {
      logContentHashDuplicate({
        logScope: 'upload/external',
        contentHash,
        duplicates: deduplication.contentHashDuplicates,
      });
      return withCors(NextResponse.json(
        {
          error: 'Duplicate image content detected',
          duplicates: deduplication.contentHashDuplicates.map(toDuplicateSummary)
        },
        { status: 409 }
      ));
    }

    const uploadFormData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const bufferArray = new Uint8Array(workingBuffer);
    uploadFormData.append('file', new Blob([bufferArray], { type: workingType }), workingName);

    const metadataPayload: Record<string, unknown> = {
      filename: workingName,
      displayName: cleanDisplayName || workingName,
      uploadedAt: new Date().toISOString(),
      size: workingBuffer.byteLength,
      type: workingType,
      folder: cleanFolder,
      tags: cleanTags,
      namespace: effectiveNamespace,
      contentHash,
      variationParentId: effectiveParentId,
      duplicateFamilyOverride: deduplication.duplicateFamilySelection ? true : undefined,
      duplicateDetectionOverride: deduplication.duplicateOverrideSelection ? true : undefined,
      uploadNormalization: prepared.data.uploadNormalization,
      generatedBy: comfyExtraction.detected ? 'comfyui' : undefined,
      comfyMetadataDetected: comfyExtraction.detected ? true : undefined,
      comfyMetadataSource: comfyExtraction.source,
    };
    const extrasMetadata: Record<string, unknown> = {
      originalUrl: cleanOriginalUrl || undefined,
      originalUrlNormalized: normalizedOriginalUrl,
      sourceUrl: cleanSourceUrl || undefined,
      sourceUrlNormalized: normalizedSourceUrl,
      instagramSource: instagramSourceField.instagramSource,
      exif: exifSummary,
    };
    const cachedMetadataPayload = {
      ...metadataPayload,
      ...extrasMetadata,
    };

    const { metadata: limitedMetadata, dropped, size, limitBytes } = enforceCloudflareMetadataLimit(metadataPayload);
    if (dropped.length) {
      logExternalIssue('Metadata trimmed to fit Cloudflare limits', { dropped, size, limitBytes });
    }
    const metadata = JSON.stringify(limitedMetadata);

    uploadFormData.append('metadata', metadata);

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

    const parsedUploadResult = await parseCloudflareUploadApiResponse(cloudflareResponse);
    if (!parsedUploadResult.ok) return parsedUploadResult.response;
    const result = parsedUploadResult.result;

    const imageData = result.result ?? {};
    const primaryId = imageData?.id;
    const primaryFilename = imageData?.filename;
    const primaryUploaded = imageData?.uploaded;
    const primaryVariants = imageData?.variants ?? [];

    if (typeof primaryId !== 'string' || !primaryId) {
      return withCors(NextResponse.json(
        { error: 'Cloudflare response missing image id.' },
        { status: 502 }
      ));
    }
    if (typeof primaryUploaded !== 'string') {
      return withCors(NextResponse.json(
        { error: 'Cloudflare response missing upload timestamp.' },
        { status: 502 }
      ));
    }
    if (!Array.isArray(primaryVariants)) {
      return withCors(NextResponse.json(
        { error: 'Cloudflare response missing variants.' },
        { status: 502 }
      ));
    }

    const baseMeta = imageData.meta && typeof imageData.meta === 'object'
      ? { ...cachedMetadataPayload, ...(imageData.meta as Record<string, unknown>) }
      : cachedMetadataPayload;
    const primaryUpload = {
      id: primaryId,
      filename: primaryFilename || workingName,
      uploaded: primaryUploaded,
      variants: primaryVariants,
      size: imageData.size,
    };
    const cachedPrimary = await cacheUploadedCloudflareImage(primaryUpload, baseMeta);

    await patchImageExtrasRecord(primaryId, {
      ...(cleanDescription ? { description: cleanDescription } : {}),
      ...extrasMetadata,
    });

    if (typeof primaryId === 'string' && primaryId) {
      try {
        await ingestComfyWorkflowForImage({
          imageId: primaryId,
          comfyExtraction,
          imageDescription: {
            description: cleanDescription,
          },
          embeddingModel: 'clip-ViT-B-32',
          embeddingVersion: 'v1',
        });
      } catch (error) {
        console.warn('[upload/external] Failed to ingest comfy workflow extras', {
          imageId: primaryId,
          error,
        });
      }
    }

    const autoEmbeddings = process.env.NODE_ENV === 'test'
      ? { enabled: false, queued: false, reason: 'disabled' as const }
      : await queueAutoEmbeddingsForImage(cachedPrimary);

    let webpVariantId: string | undefined;
    if (workingType === 'image/svg+xml') {
      try {
        const webpBuffer = await sharp(workingBuffer).webp({ quality: 85 }).toBuffer();
        const webpName = workingName.replace(/\.svg$/i, '') + '.webp';
        const webpFormData = new FormData();
        // Convert Buffer to Uint8Array for Blob compatibility
        const webpArray = new Uint8Array(webpBuffer);
        webpFormData.append('file', new Blob([webpArray], { type: 'image/webp' }), webpName);
        const webpMetadata = {
          ...metadataPayload,
          filename: webpName,
          displayName: cleanDisplayName || webpName,
          variationParentId: effectiveParentId,
          linkedAssetId: imageData.id,
        };
        const { metadata: limitedWebpMetadata, dropped, size, limitBytes } = enforceCloudflareMetadataLimit(webpMetadata);
        if (dropped.length) {
          logExternalIssue('Metadata trimmed for webp variant', { dropped, size, limitBytes });
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
            const cachedWebp = await cacheUploadedCloudflareImage(
              webpResult,
              webpResult.meta && typeof webpResult.meta === 'object'
                ? {
                    ...cachedMetadataPayload,
                    ...limitedWebpMetadata,
                    ...(webpResult.meta as Record<string, unknown>)
                  }
                : { ...cachedMetadataPayload, ...limitedWebpMetadata }
            );
            await patchImageExtrasRecord(webpResult.id, {
              ...(cleanDescription ? { description: cleanDescription } : {}),
              ...extrasMetadata,
            });
            if (process.env.NODE_ENV !== 'test') {
              await queueAutoEmbeddingsForImage(cachedWebp);
            }
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
      try {
        const patchResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageData.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ metadata: updatedMetadata }),
          }
        );
        if (!patchResp.ok) {
          const patchJson = await patchResp.json();
          console.error('Failed to patch SVG metadata', patchJson);
        } else {
          await cacheUploadedCloudflareImage(primaryUpload, {
            ...updatedMetadata,
            ...extrasMetadata,
          });
        }
      } catch (err) {
        console.error('Failed to patch SVG metadata', err);
      }
    }

    await upsertRegistryNamespace(effectiveNamespace);

    const promptSave = await persistUploadPrompt([primaryId, webpVariantId], cleanPrompt);

    return withCors(NextResponse.json({
      id: primaryId,
      filename: workingName,
      url: primaryVariants.find((v: string) => v.includes('public')) || primaryVariants[0],
      variants: primaryVariants,
      uploaded: new Date().toISOString(),
      folder: cleanFolder,
      tags: cleanTags,
      description: cleanDescription,
      originalUrl: cleanOriginalUrl,
      sourceUrl: cleanSourceUrl,
      namespace: effectiveNamespace,
      parentId: effectiveParentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
      autoEmbeddings,
      uploadNormalization: prepared.data.uploadNormalization,
      duplicateHandling: deduplication.duplicateFamilySelection,
      duplicateOverride: deduplication.duplicateOverrideSelection,
      ...(promptSave ? { promptSave } : {}),
    }));

  } catch (error) {
    console.error('External upload error:', error);
    return withCors(NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    ));
  }
}
const logExternalIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload/external] ' + message, details);
};
