import { verifyHostedOriginal, recordDemarkProvenance } from './hosted-verification.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { downloadOriginalImageById, getImage } from '../discovery/client.js';
import { getExtras, updateMetadata } from '../organization/client.js';
import { detectImageMimeFromBuffer, extensionFromFilename } from '../upload/filenames.js';
import { uploadFileBase64 } from '../upload/client.js';
import {
  buildDemarkedDisplayName,
  buildDemarkedFilename,
  mergeDemarkedTags,
} from './naming.js';
import {
  createDemarkTempDirectory,
  removeDemarkTempDirectory,
  runDemarkWorker,
} from './worker-runner.js';
import type {
  DemarkBatchResult,
  DemarkFailureResult,
  DemarkInputItem,
  DemarkItemResult,
  DemarkSettings,
  DemarkSuccessResult,
  DemarkWorkerItemResult,
} from './types.js';

interface SourceContext {
  imageId: string;
  parentId: string;
  sourceFilename: string;
  outputFilename: string;
  displayName: string;
  tags: string[];
  namespace: string;
  folder?: string;
  originalUrl?: string;
  sourceUrl?: string;
  altTag?: string;
  description?: string;
  dimensions?: { width: number; height: number };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dimensionsValue(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  imageId: string,
  stage: DemarkFailureResult['stage'],
  error: unknown,
  childId?: string,
): DemarkFailureResult {
  return {
    imageId,
    status: 'failed',
    stage,
    error: errorMessage(error),
    ...(childId ? { childId } : {}),
  };
}

function expectedMimeForFilename(filename: string): string {
  const extension = extensionFromFilename(filename);
  return extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : 'image/jpeg';
}

function readChildId(upload: Record<string, unknown>): string | undefined {
  const direct = stringValue(upload.id) || stringValue(upload.imageId) || stringValue(upload.canonicalImageId);
  if (direct) return direct;
  if (upload.result && typeof upload.result === 'object' && !Array.isArray(upload.result)) {
    const nested = upload.result as Record<string, unknown>;
    return stringValue(nested.id) || stringValue(nested.imageId);
  }
  return undefined;
}

function readSourceContext(imageId: string, source: Record<string, unknown>, downloadedFilename: string | undefined, mime: string): SourceContext {
  const originalFilename = stringValue(source.filename) || stringValue(downloadedFilename);
  const extension = mime === "image/jpeg" ? ".jpg" : `.${mime.slice(6)}`;
  const sourceFilename = originalFilename ? path.basename(originalFilename, path.extname(originalFilename)) + extension : undefined;
  if (!sourceFilename) throw new Error(`Source image ${imageId} has no filename`);
  const namespace = stringValue(source.namespace);
  if (!namespace) throw new Error(`Source image ${imageId} has no namespace metadata`);

  const outputFilename = buildDemarkedFilename(sourceFilename);
  return {
    imageId,
    parentId: stringValue(source.parentId) || imageId,
    sourceFilename,
    outputFilename,
    displayName: buildDemarkedDisplayName(stringValue(source.displayName), sourceFilename),
    tags: mergeDemarkedTags(Array.isArray(source.tags) ? source.tags.filter((tag): tag is string => typeof tag === 'string') : []),
    namespace,
    folder: stringValue(source.folder),
    originalUrl: stringValue(source.originalUrl),
    sourceUrl: stringValue(source.sourceUrl),
    altTag: stringValue(source.altTag),
    description: typeof source.description === "string" ? source.description : undefined,
    dimensions: dimensionsValue(source.dimensions),
  };
}

function verifyCatalogMetadata(
  childId: string,
  child: Record<string, unknown>,
  context: SourceContext,
): void {
  if (stringValue(child.namespace) !== context.namespace) {
    throw Object.assign(new Error(`Uploaded child ${childId} is not in namespace ${context.namespace}`), { childId });
  }
  if (stringValue(child.folder) !== context.folder) {
    throw Object.assign(new Error(`Uploaded child ${childId} is not in folder ${context.folder || '(root)'}`), { childId });
  }
  if (stringValue(child.displayName) !== context.displayName) {
    throw Object.assign(new Error(`Uploaded child ${childId} has an unexpected display name`), { childId });
  }
  if (context.originalUrl && stringValue(child.originalUrl) !== context.originalUrl) {
    throw Object.assign(new Error(`Uploaded child ${childId} did not preserve originalUrl`), { childId });
  }
  if (context.sourceUrl && stringValue(child.sourceUrl) !== context.sourceUrl) {
    throw Object.assign(new Error(`Uploaded child ${childId} did not preserve sourceUrl`), { childId });
  }

  const childTags = Array.isArray(child.tags)
    ? child.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLocaleLowerCase())
    : [];
  for (const tag of context.tags) {
    if (!childTags.includes(tag.toLocaleLowerCase())) {
      throw Object.assign(new Error(`Uploaded child ${childId} did not preserve tag ${tag}`), { childId });
    }
  }
}

function verifyWorkerOutput(
  workerItem: DemarkWorkerItemResult | undefined,
  output: Buffer,
  context: SourceContext,
  outputFilename: string,
): { dimensions: { width: number; height: number }; contentType: string } {
  if (!workerItem) throw new Error(`Worker returned no result for ${context.imageId}`);
  if (!workerItem.ok) throw new Error(workerItem.error || `Worker failed for ${context.imageId}`);
  if (!workerItem.verification || !workerItem.verification.format_valid
    || workerItem.verification.dimensions_valid !== true
    || workerItem.aiMetadataPresent === true || workerItem.verification.c2pa_present === true) {
    throw new Error(`AI metadata verification failed for ${context.imageId}`);
  }

  const dimensions = workerItem.width && workerItem.height
    ? { width: workerItem.width, height: workerItem.height }
    : undefined;
  if (!dimensions) throw new Error(`Worker returned no valid dimensions for ${context.imageId}`);
  if (context.dimensions && (context.dimensions.width !== dimensions.width || context.dimensions.height !== dimensions.height)) {
    throw new Error(
      `Output dimensions ${dimensions.width}x${dimensions.height} do not match source ${context.dimensions.width}x${context.dimensions.height}`,
    );
  }

  const contentType = detectImageMimeFromBuffer(output);
  if (!contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    throw new Error(`Output for ${context.imageId} is not a PNG, JPEG, or WebP image`);
  }
  if (contentType !== expectedMimeForFilename(outputFilename)) {
    throw new Error(`Output bytes for ${context.imageId} do not match ${outputFilename}`);
  }

  if (contentType === 'image/webp' && (!workerItem.verification.inspection_complete
    || workerItem.verification.ai_metadata_present !== false || workerItem.verification.c2pa_present !== false)) {
    throw new Error('WebP metadata inspection is incomplete');
  }
  return { dimensions, contentType };
}

async function uploadAndVerify(
  context: SourceContext,
  settings: DemarkSettings,
  output: Buffer,
  workerItem: DemarkWorkerItemResult | undefined,
): Promise<DemarkSuccessResult> {
  const verification = verifyWorkerOutput(workerItem, output, context, context.outputFilename);
  const description = context.description;
  const upload = await uploadFileBase64('/api/upload', {
    base64: output.toString('base64'),
    filename: context.outputFilename,
    contentType: verification.contentType,
    folder: context.folder,
    tags: context.tags,
    description,
    originalUrl: context.originalUrl,
    sourceUrl: context.sourceUrl,
    namespace: context.namespace,
    parentId: context.parentId,
    generateSemanticTags: false,
    // A requested run creates a new child even when cleanup produces identical bytes.
    duplicateAction: 'override',
  });
  const childId = readChildId(upload);
  if (!childId) throw new Error(`Photarium upload returned no child image ID for ${context.imageId}`);

  try {
    await updateMetadata(childId, {
      folder: context.folder,
      tags: context.tags,
      description,
      displayName: context.displayName,
      altTag: context.altTag,
      originalUrl: context.originalUrl,
      sourceUrl: context.sourceUrl,
      namespace: context.namespace,
      parentId: context.parentId,
    });
  } catch (error) {
    throw Object.assign(new Error(errorMessage(error)), { childId });
  }

  const child = await getImage(childId);
  if (!child) throw Object.assign(new Error(`Uploaded child ${childId} could not be read back`), { childId });
  if (stringValue(child.parentId) !== context.parentId) {
    throw Object.assign(new Error(`Uploaded child ${childId} is not linked to ${context.parentId}`), { childId });
  }
  const childDimensions = dimensionsValue(child.dimensions);
  if (!childDimensions || childDimensions.width !== verification.dimensions.width || childDimensions.height !== verification.dimensions.height) {
    throw Object.assign(new Error(`Uploaded child ${childId} has invalid dimensions`), { childId });
  }
  verifyCatalogMetadata(childId, child, context);
  const url = stringValue(child.url) || stringValue(upload.url);
  if (!url) throw Object.assign(new Error(`Uploaded child ${childId} has no public URL`), { childId });

  const hostedOriginalSha256 = await verifyHostedOriginal(childId, output);
  const file = workerItem!.verification!;
  try {
    await recordDemarkProvenance({ childId, sourceImageId: context.imageId, settings,
      verification: file, sha256: hostedOriginalSha256,
      format: verification.contentType.slice(6), frames: workerItem?.frames ?? 1 });
  } catch (error) { throw Object.assign(new Error(errorMessage(error)), { childId }); }
  return {
    imageId: context.imageId,
    status: 'succeeded',
    childId,
    filename: context.outputFilename,
    displayName: context.displayName,
    url,
    parentId: context.parentId,
    namespace: context.namespace,
    dimensions: childDimensions,
    verification: {
      aiMetadataPresent: file.ai_metadata_present,
      file, hostedOriginalSha256, hostedOriginalMatches: true,
      parentLinked: true,
      dimensionsValid: true,
    },
  };
}

export async function processDemarkImages(
  imageIds: string[],
  settings: DemarkSettings,
): Promise<DemarkBatchResult> {
  const uniqueImageIds = [...new Set(imageIds)];
  const resultByImageId = new Map<string, DemarkItemResult>();
  const contexts = new Map<string, SourceContext>();
  const workerInputs: DemarkInputItem[] = [];
  const tempDirectory = await createDemarkTempDirectory();

  try {
    for (const [index, imageId] of uniqueImageIds.entries()) {
      try {
        const source = await getImage(imageId);
        if (!source) throw new Error(`Source image was not found: ${imageId}`);
        const downloaded = await downloadOriginalImageById(imageId);
        if (downloaded.fallbackUsed || downloaded.variantUsed !== 'original') throw new Error('Original download returned a delivery variant');
        const sourceBytes = Buffer.from(downloaded.base64, 'base64');
        if (!sourceBytes.length) throw new Error(`Source image ${imageId} downloaded as an empty file`);
        const sourceMime = detectImageMimeFromBuffer(sourceBytes);
        if (!sourceMime || !['image/png', 'image/jpeg', 'image/webp'].includes(sourceMime)) {
          throw new Error(`Source image ${imageId} is not a PNG, JPEG, or WebP original`);
        }

        const context = readSourceContext(imageId, source, downloaded.filename, sourceMime);
        const extras = await getExtras(imageId);
        context.description = extras.record?.description ?? context.description;
        context.altTag = extras.record?.altText ?? context.altTag;
        const sourcePath = path.join(tempDirectory, `${index}-${context.sourceFilename}`);
        const outputPath = path.join(tempDirectory, `${index}-${context.outputFilename}`);
        await fs.writeFile(sourcePath, sourceBytes);
        contexts.set(imageId, context);
        workerInputs.push({ imageId, sourcePath, outputPath });
      } catch (error) {
        const stage: DemarkFailureResult['stage'] = errorMessage(error).includes('downloaded')
          ? 'download'
          : 'source';
        resultByImageId.set(imageId, failure(imageId, stage, error));
      }
    }

    if (workerInputs.length) {
      let workerResponse;
      try {
        workerResponse = await runDemarkWorker({ settings, items: workerInputs });
      } catch (error) {
        for (const item of workerInputs) {
          resultByImageId.set(item.imageId, failure(item.imageId, 'process', error));
        }
        workerResponse = undefined;
      }

      if (workerResponse) {
        const workerResults = new Map(workerResponse.items.map((item) => [item.imageId, item]));
        for (const item of workerInputs) {
          const context = contexts.get(item.imageId);
          if (!context) {
            resultByImageId.set(item.imageId, failure(item.imageId, 'source', 'Source context was lost before processing'));
            continue;
          }
          try {
            const workerItem = workerResults.get(item.imageId);
            if (!workerItem?.ok) throw new Error(workerItem?.error || 'Worker returned no result');
            const output = await fs.readFile(item.outputPath);
            const result = await uploadAndVerify(context, settings, output, workerResults.get(item.imageId));
            resultByImageId.set(item.imageId, result);
          } catch (error) {
            const childId = typeof error === 'object' && error !== null && 'childId' in error && typeof error.childId === 'string'
              ? error.childId
              : undefined;
            const message = errorMessage(error);
            const normalizedMessage = message.toLocaleLowerCase();
            const stage: DemarkFailureResult['stage'] = childId
              ? normalizedMessage.includes('verification') || normalizedMessage.includes('read back') || normalizedMessage.includes('linked') || normalizedMessage.includes('dimensions') || normalizedMessage.includes('public url')
                ? 'verify'
                : 'metadata'
              : normalizedMessage.includes('upload') || normalizedMessage.includes('duplicate') || normalizedMessage.includes('child image id')
                ? 'upload'
                : 'process';
            resultByImageId.set(item.imageId, failure(item.imageId, stage, error, childId));
          }
        }
      }
    }

    const results = uniqueImageIds.map((imageId) => resultByImageId.get(imageId) || failure(imageId, 'source', 'No result was produced'));
    const succeeded = results.filter((result) => result.status === 'succeeded').length;
    return {
      mode: settings.mode,
      settings,
      processed: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  } finally {
    await removeDemarkTempDirectory(tempDirectory);
  }
}
