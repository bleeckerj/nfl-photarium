import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { uploadImageBuffer, type UploadSuccess } from '@/server/uploadService';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { sanitizeFilename } from '@/utils/filename';
import { resolveAspectRatioExpansionProvider } from '@/server/aspectRatioExpansion/registry';
import type {
  AspectRatioExpansionRequest,
  AspectRatioExpansionResult,
  ResolvedAspectRatioExpansionProvider,
} from '@/server/aspectRatioExpansion/types';

const normalizePlacement = (value: unknown) => (
  value === 'top' || value === 'right' || value === 'bottom' || value === 'left' || value === 'center'
    ? value
    : 'center'
);

const normalizeRatio = (value: unknown) => {
  const ratio = typeof value === 'string' && value.trim() ? value.trim() : '4:5';
  if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio)) {
    throw new Error('Aspect ratio must use width:height format, for example 4:5');
  }
  return ratio;
};

const normalizeRequest = (request: AspectRatioExpansionRequest): Required<Pick<AspectRatioExpansionRequest, 'aspectRatio' | 'placement'>> & AspectRatioExpansionRequest => ({
  ...request,
  aspectRatio: normalizeRatio(request.aspectRatio),
  placement: normalizePlacement(request.placement),
  provider: request.provider || 'auto',
});

export type AspectRatioExpansionOperation = {
  source: Awaited<ReturnType<typeof downloadSourceImage>>;
  request: ReturnType<typeof normalizeRequest>;
  result: AspectRatioExpansionResult;
};

export async function generateAspectRatioExpansion(params: {
  imageId: string;
  request: AspectRatioExpansionRequest;
  onProgress?: (message: string, percent?: number) => void;
}): Promise<AspectRatioExpansionOperation> {
  const request = normalizeRequest(params.request);
  const adapter = resolveAspectRatioExpansionProvider(request.provider);
  params.onProgress?.(`Using ${adapter.label}`, 0.03);
  const source = await downloadSourceImage(params.imageId);
  const result = await adapter.generate({ source: { ...source, imageId: params.imageId }, request, onProgress: params.onProgress });
  return { source, request, result };
}

const token = (value: string) => value.replace(/[^A-Za-z0-9]+/g, 'x');

const buildFilename = (sourceFilename: string, requestedFilename: string | undefined, ratio: string, provider: ResolvedAspectRatioExpansionProvider) => {
  const requested = requestedFilename?.trim();
  const base = sanitizeFilename(requested || sourceFilename).replace(/\.[^.]+$/, '') || 'image';
  return sanitizeFilename(`${base}-expand-${token(ratio)}-${provider}.webp`);
};

export type AspectRatioExpansionProvenance = {
  requestedProvider: string;
  resolvedProvider: ResolvedAspectRatioExpansionProvider;
  aspectRatio: string;
  placement: string;
  instructions?: string;
  negativePrompt?: string;
  seed?: number;
  model?: string;
  workflowId?: string;
  externalJobId?: string;
  output: {
    width: number;
    height: number;
    mimeType: string;
  };
};

export const buildAspectRatioExpansionProvenance = (
  operation: AspectRatioExpansionOperation
): AspectRatioExpansionProvenance => ({
  requestedProvider: operation.request.provider || 'auto',
  resolvedProvider: operation.result.provider,
  aspectRatio: operation.request.aspectRatio,
  placement: operation.request.placement,
  instructions: operation.request.instructions,
  negativePrompt: operation.request.negativePrompt,
  seed: operation.request.seed,
  model: operation.result.model,
  workflowId: operation.result.workflowId,
  externalJobId: operation.result.externalJobId,
  output: {
    width: operation.result.dimensions.width,
    height: operation.result.dimensions.height,
    mimeType: operation.result.contentType,
  },
});

export async function uploadAspectRatioExpansionArtifact(params: {
  sourceImageId: string;
  sourceFilename: string;
  artifact: { buffer: Buffer; contentType: string; filename?: string };
  request: AspectRatioExpansionRequest;
  provenance: AspectRatioExpansionProvenance;
}): Promise<UploadSuccess> {
  const credentials = getCloudflareCredentials();
  const sourceImage = await fetchCloudflareImage(params.sourceImageId, credentials);
  const sourceMetadata = parseCloudflareMetadata(sourceImage.meta);
  const extras = await getImageExtrasRecord(params.sourceImageId);
  const namespace = sourceMetadata.namespace;
  if (!namespace) throw new Error('Source image is missing namespace metadata');
  const filename = buildFilename(
    params.sourceFilename,
    params.request.filename,
    params.provenance.aspectRatio,
    params.provenance.resolvedProvider
  );
  const tags = Array.from(new Set([
    ...(Array.isArray(sourceMetadata.tags) ? sourceMetadata.tags : []),
    ...(Array.isArray(params.request.tags) ? params.request.tags : []),
    'image-tool',
    'aspect-ratio-expand',
    params.provenance.resolvedProvider,
  ]));
  const outcome = await uploadImageBuffer({
    buffer: params.artifact.buffer,
    originalBuffer: params.artifact.buffer,
    fileName: filename,
    fileType: params.artifact.contentType,
    fileSize: params.artifact.buffer.byteLength,
    context: {
      ...credentials,
      folder: extras?.folder ?? sourceMetadata.folder,
      tags,
      displayName: filename,
      description: params.request.description?.trim() || `Generative ${params.provenance.aspectRatio} expansion via ${params.provenance.resolvedProvider}`,
      originalUrl: sourceMetadata.originalUrl,
      sourceUrl: sourceMetadata.sourceUrl,
      namespace,
      parentId: params.sourceImageId,
      duplicateAction: 'family',
      generatedBy: params.provenance.resolvedProvider,
    },
  });
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.data;
}

export async function persistAspectRatioExpansionProvenance(
  imageId: string,
  provenance: AspectRatioExpansionProvenance,
  sourceImageId: string
) {
  await patchImageExtrasRecord(imageId, {
    imageToolRun: {
      toolId: 'aspect-ratio-expand',
      adapterKind: `${provenance.resolvedProvider}-aspect-ratio-expansion`,
      sourceImageId,
      externalJobId: provenance.externalJobId,
      params: {
        requestedProvider: provenance.requestedProvider,
        resolvedProvider: provenance.resolvedProvider,
        aspectRatio: provenance.aspectRatio,
        placement: provenance.placement,
        instructions: provenance.instructions,
        negativePrompt: provenance.negativePrompt,
        seed: provenance.seed,
        model: provenance.model,
        workflowId: provenance.workflowId,
      },
      output: provenance.output,
      createdAt: new Date().toISOString(),
    },
  });
}
