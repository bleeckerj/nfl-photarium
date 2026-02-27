import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import {
  evaluateUploadDeduplicationPolicy,
  logContentHashDuplicate,
  logCrossNamespaceContentHashWarning,
  logOriginalUrlReuseWarning,
} from '@/server/uploadDuplicatePolicy';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractSnagx } from '@/utils/snagx';
import { extractExifSummary } from '@/utils/exif';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { MAX_IMAGE_BYTES, prepareImageForUpload, sanitizeFilename } from '@/server/uploadService';
import { queueAutoEmbeddingsForImage } from '@/server/autoEmbeddings';
import { extractComfyWorkflowMetadata } from '@/utils/comfyMetadata';
import { ingestComfyWorkflowForImage } from '@/server/comfy/workflowIngestion';
import { validateParentForNewChild } from '@/server/parentValidation';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';
import type { ComfyWorkflowExtraction } from '@/utils/comfyMetadata';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type CloudflareUploadApiResult = {
  result?: {
    id?: string;
    filename?: string;
    uploaded?: string;
    variants?: string[];
    size?: number;
    meta?: Record<string, unknown>;
  };
  errors?: Array<{ message?: string }>;
};

function withCors(response: NextResponse) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

const MAX_WORKFLOW_JSON_BYTES = 2_000_000;

function parseOptionalWorkflowJson(
  value: FormDataEntryValue | null
): { ok: true; workflowJson?: unknown } | { ok: false; error: string } {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid comfyWorkflowJson: expected a JSON string' };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: true };

  if (Buffer.byteLength(trimmed, 'utf8') > MAX_WORKFLOW_JSON_BYTES) {
    return { ok: false, error: 'Invalid comfyWorkflowJson: payload too large' };
  }

  try {
    return {
      ok: true,
      workflowJson: JSON.parse(trimmed),
    };
  } catch {
    return { ok: false, error: 'Invalid comfyWorkflowJson: malformed JSON' };
  }
}

function applyWorkflowOverride(
  extraction: ComfyWorkflowExtraction,
  workflowJson?: unknown
): ComfyWorkflowExtraction {
  if (workflowJson === undefined) return extraction;

  const source = 'request:comfyWorkflowJson';
  const mergedSources = Array.from(new Set([...(extraction.sources ?? []), source]));

  return {
    ...extraction,
    detected: true,
    source,
    sources: mergedSources,
    workflowJson,
    workflowSourceKey: source,
  };
}

type PromptSaveSummary = {
  requested: true;
  promptLength: number;
  attempted: number;
  saved: number;
  failed: number;
  imageIds: string[];
  errors?: Array<{ imageId: string; error: string }>;
};

function parseOptionalPromptField(
  value: FormDataEntryValue | null
): { ok: true; prompt?: string } | { ok: false; error: string } {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid prompt: expected a text field' };
  }
  const prompt = value.trim();
  return prompt ? { ok: true, prompt } : { ok: true };
}

async function persistUploadPrompt(
  imageIds: Array<string | undefined>,
  prompt?: string
): Promise<PromptSaveSummary | undefined> {
  if (!prompt) return undefined;

  const uniqueIds = Array.from(new Set(imageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  if (!uniqueIds.length) {
    return {
      requested: true,
      promptLength: prompt.length,
      attempted: 0,
      saved: 0,
      failed: 0,
      imageIds: [],
    };
  }

  const errors: Array<{ imageId: string; error: string }> = [];
  let saved = 0;

  for (const imageId of uniqueIds) {
    try {
      const existing = await getPromptThisRecord(imageId);
      const now = new Date().toISOString();
      const record: PromptThisRecord = {
        imageId,
        prompt,
        model: 'manual',
        provider: 'manual',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await setPromptThisRecord(record);
      saved += 1;
    } catch (error) {
      errors.push({
        imageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (errors.length) {
    logExternalIssue('Failed to persist prompt for one or more uploaded images', {
      attempted: uniqueIds.length,
      failed: errors.length,
      imageIds: uniqueIds,
    });
  }

  return {
    requested: true,
    promptLength: prompt.length,
    attempted: uniqueIds.length,
    saved,
    failed: errors.length,
    imageIds: uniqueIds,
    errors: errors.length ? errors : undefined,
  };
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  try {
    // 0. Feature Flag: Check if API is disabled
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

    const computeContentHash = (payload: Buffer) =>
      createHash('sha256').update(payload).digest('hex');

    const folder = formData.get('folder') as string;
    const tags = formData.get('tags') as string;
    const description = formData.get('description') as string;
    const promptField = parseOptionalPromptField(formData.get('prompt'));
    const displayName = formData.get('displayName') as string;
    const originalUrl = formData.get('originalUrl') as string;
    const sourceUrl = formData.get('sourceUrl') as string;
    const namespace = formData.get('namespace') as string;
    const parentIdRaw = formData.get('parentId');
    const workflowJsonField = parseOptionalWorkflowJson(formData.get('comfyWorkflowJson'));

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

    const cleanFolder = folder && folder.trim() && folder !== 'undefined' ? folder.trim() : undefined;
    const cleanTags = tags && tags.trim() ? tags.trim().split(',').map(t => t.trim()).filter(Boolean) : [];
    const cleanDescription = description && description.trim() && description !== 'undefined' ? description.trim() : undefined;
    const cleanDisplayName = displayName && displayName.trim() && displayName !== 'undefined' ? displayName.trim() : undefined;
    const cleanOriginalUrl = originalUrl && originalUrl.trim() && originalUrl !== 'undefined' ? originalUrl.trim() : undefined;
    const normalizedOriginalUrl = normalizeOriginalUrl(cleanOriginalUrl);
    const cleanSourceUrl = sourceUrl && sourceUrl.trim() && sourceUrl !== 'undefined' ? sourceUrl.trim() : undefined;
    const normalizedSourceUrl = normalizeOriginalUrl(cleanSourceUrl);
    const rawNamespace = typeof namespace === 'string' ? namespace.trim() : '';
    const cleanNamespace =
      rawNamespace && rawNamespace !== 'undefined' && rawNamespace !== '__all__' && rawNamespace !== '__none__'
        ? rawNamespace
        : undefined;
    if (!cleanNamespace) {
      return withCors(
        NextResponse.json(
          {
            error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
          },
          { status: 400 }
        )
      );
    }
    const effectiveNamespace = cleanNamespace;
    const parentIdValue = typeof parentIdRaw === 'string' ? parentIdRaw.trim() : '';
    const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

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
    // Sanitize filename: truncate, clean, and handle Google Photos blobs
    let workingName = sanitizeFilename(file.name);

    if (isSnagx) {
      try {
        const extracted = extractSnagx(originalBuffer, file.name);
        workingBuffer = extracted.buffer;
        workingType = 'image/png';
        // Sanitize the extracted filename too
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
    });
    if (deduplication.originalUrlWarning) {
      logOriginalUrlReuseWarning({
        logScope: 'upload/external',
        originalUrl: cleanOriginalUrl,
        warning: deduplication.originalUrlWarning,
      });
    }
    if (deduplication.crossNamespaceContentHashMatches.length) {
      logCrossNamespaceContentHashWarning({
        logScope: 'upload/external',
        contentHash,
        targetNamespace: effectiveNamespace,
        matches: deduplication.crossNamespaceContentHashMatches,
      });
    }

    if (deduplication.contentHashDuplicates.length) {
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
      description: cleanDescription,
      originalUrl: cleanOriginalUrl,
      originalUrlNormalized: normalizedOriginalUrl,
      sourceUrl: cleanSourceUrl,
      sourceUrlNormalized: normalizedSourceUrl,
      namespace: effectiveNamespace,
      contentHash,
      variationParentId: resolvedParentId,
      exif: exifSummary,
      generatedBy: comfyExtraction.detected ? 'comfyui' : undefined,
      comfyMetadataDetected: comfyExtraction.detected ? true : undefined,
      comfyMetadataSource: comfyExtraction.source,
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

    // Handle non-JSON responses (rate limits, timeouts, HTML error pages)
    const contentType = cloudflareResponse.headers.get('content-type') || '';
    let result: CloudflareUploadApiResult = {};
    let textBody: string | undefined;

    if (contentType.includes('application/json')) {
      const jsonPayload = await cloudflareResponse.json();
      if (jsonPayload && typeof jsonPayload === 'object') {
        result = jsonPayload as CloudflareUploadApiResult;
      }
    } else {
      textBody = await cloudflareResponse.text();
      try {
        const parsedPayload = JSON.parse(textBody);
        if (parsedPayload && typeof parsedPayload === 'object') {
          result = parsedPayload as CloudflareUploadApiResult;
        }
      } catch {
        console.error('Cloudflare returned non-JSON response:', {
          status: cloudflareResponse.status,
          statusText: cloudflareResponse.statusText,
          contentType,
          bodyPreview: textBody.slice(0, 500)
        });
        
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
        
        return withCors(NextResponse.json(
          { error: errorMessage },
          { status: cloudflareResponse.status || 502 }
        ));
      }
    }

    if (!cloudflareResponse.ok) {
      console.error('Cloudflare API error:', result);
      return withCors(NextResponse.json(
        { error: result.errors?.[0]?.message || 'Failed to upload to Cloudflare' },
        { status: cloudflareResponse.status }
      ));
    }

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

    const baseMeta = imageData.meta ?? limitedMetadata;
    const cachedPrimary = transformApiImageToCached({
      id: primaryId,
      filename: primaryFilename,
      uploaded: primaryUploaded,
      variants: primaryVariants,
      size: imageData.size,
      meta: baseMeta
    });
    upsertCachedImage(cachedPrimary);

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
          variationParentId: resolvedParentId,
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
            const cachedWebp = transformApiImageToCached({
              id: webpResult.id,
              filename: webpResult.filename,
              uploaded: webpResult.uploaded,
              variants: webpResult.variants,
              size: webpResult.size,
              meta: webpResult.meta ?? limitedWebpMetadata
            });
            upsertCachedImage(cachedWebp);
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
          upsertCachedImage(
            transformApiImageToCached({
              id: primaryId,
              filename: primaryFilename,
              uploaded: primaryUploaded,
              variants: primaryVariants,
              size: imageData.size,
              meta: updatedMetadata
            })
          );
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
      parentId: resolvedParentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
      autoEmbeddings,
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
