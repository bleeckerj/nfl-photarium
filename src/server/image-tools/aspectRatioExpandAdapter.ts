import type { UploadSuccess } from '@/server/uploadService';
import { buildAspectRatioExpansionProvenance, generateAspectRatioExpansion, persistAspectRatioExpansionProvenance, uploadAspectRatioExpansionArtifact } from '@/server/aspectRatioExpansion/service';
import type { ImageToolAdapter, ImageToolRequest, ImageToolRunResult } from '@/server/image-tools/types';

const asString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const getRequest = (request: ImageToolRequest) => {
  const params = request.params || {};
  return {
    provider: asString(params.provider) as 'auto' | 'openai' | 'comfyui' | undefined,
    aspectRatio: asString(params.aspectRatio) || '4:5',
    placement: (asString(params.placement) || 'center') as 'top' | 'right' | 'bottom' | 'left' | 'center',
    instructions: asString(params.instructions),
    negativePrompt: asString(params.negativePrompt),
    seed: asNumber(params.seed),
    filename: asString(params.filename),
    description: asString(params.description),
    tags: Array.isArray(params.tags) ? params.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
  };
};

const manifest: ImageToolAdapter['manifest'] = {
  id: 'aspect-ratio-expand',
  label: 'Generative aspect-ratio expansion',
  description: 'Extend an image into a new aspect ratio with OpenAI image edits or a configured ComfyUI workflow.',
  adapterKind: 'aspect-ratio-provider',
  inputAssetTypes: ['image'],
  outputModes: ['still'],
  supportsAsync: true,
  resultKinds: ['image'],
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    shortDescription: 'Preserve the source image while generating the added canvas area.',
  },
  controls: [
    {
      id: 'params.provider',
      label: 'Provider',
      type: 'select',
      defaultValue: 'auto',
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'openai', label: 'OpenAI image edit' },
        { value: 'comfyui', label: 'ComfyUI workflow' },
      ],
      group: 'general',
    },
    {
      id: 'params.aspectRatio',
      label: 'Aspect ratio',
      type: 'text',
      defaultValue: '4:5',
      group: 'general',
    },
    {
      id: 'params.placement',
      label: 'Placement',
      type: 'select',
      defaultValue: 'center',
      options: [
        { value: 'center', label: 'Center' },
        { value: 'top', label: 'Top' },
        { value: 'right', label: 'Right' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'left', label: 'Left' },
      ],
      group: 'general',
    },
    {
      id: 'params.instructions',
      label: 'Expansion instructions',
      type: 'textarea',
      defaultValue: '',
      group: 'general',
    },
    {
      id: 'params.negativePrompt',
      label: 'Negative prompt',
      type: 'textarea',
      defaultValue: '',
      group: 'general',
      advanced: true,
    },
    {
      id: 'params.seed',
      label: 'Seed',
      type: 'number',
      group: 'general',
      advanced: true,
    },
    {
      id: 'output.format',
      label: 'Format',
      type: 'select',
      defaultValue: 'webp',
      options: [
        { value: 'webp', label: 'WebP' },
        { value: 'png', label: 'PNG' },
      ],
      group: 'output',
    },
  ],
  defaultRequest: {
    effectId: 'expand',
    params: { provider: 'auto', aspectRatio: '4:5', placement: 'center' },
    output: { mode: 'still', format: 'webp' },
  },
};

const buildGeneration = async (imageId: string, request: ImageToolRequest, onProgress: (message: string, percent?: number) => void) => {
  const operation = await generateAspectRatioExpansion({
    imageId,
    request: getRequest(request),
    onProgress,
  });
  return {
    operation,
    provenance: buildAspectRatioExpansionProvenance(operation),
  };
};

const completeRun = async (imageId: string, request: ImageToolRequest, update: (message: string, percent?: number) => void): Promise<ImageToolRunResult> => {
  const { operation, provenance } = await buildGeneration(imageId, request, update);
  const uploadedAsset = await uploadAspectRatioExpansionArtifact({
    sourceImageId: imageId,
    sourceFilename: operation.source.filename,
    artifact: operation.result,
    request: getRequest(request),
    provenance,
  });
  await persistAspectRatioExpansionProvenance(uploadedAsset.id, provenance, imageId);
  return {
    kind: 'image',
    uploadedAsset,
    externalJobId: provenance.externalJobId,
    metadata: provenance,
  };
};

export const aspectRatioExpandAdapter: ImageToolAdapter = {
  manifest,
  async run({ imageId, request, updateRun, addEvent }) {
    addEvent({ phase: 'aspect-ratio-expand.started', message: 'Starting aspect-ratio expansion' });
    return completeRun(imageId, request, (message, percent) => {
      updateRun({ message, percent, externalJobId: undefined });
      addEvent({ phase: 'aspect-ratio-expand.progress', message, details: percent === undefined ? undefined : { percent } });
    });
  },
  async preview({ imageId, request, updatePreview, addEvent }) {
    addEvent({ phase: 'aspect-ratio-expand.started', message: 'Starting aspect-ratio preview' });
    const { operation, provenance } = await buildGeneration(imageId, request, (message, percent) => {
      updatePreview({ message, percent });
      addEvent({ phase: 'aspect-ratio-expand.progress', message, details: percent === undefined ? undefined : { percent } });
    });
    return {
      kind: 'image',
      artifact: {
        buffer: operation.result.buffer,
        contentType: operation.result.contentType,
        filename: operation.result.filename,
      },
      externalJobId: provenance.externalJobId,
      metadata: provenance,
    };
  },
  async uploadArtifact({ sourceImageId, sourceFilename, artifact, request, metadata }) {
    const provenance = metadata as ReturnType<typeof buildAspectRatioExpansionProvenance>;
    const uploadedAsset = await uploadAspectRatioExpansionArtifact({
      sourceImageId,
      sourceFilename,
      artifact,
      request: getRequest(request),
      provenance,
    });
    return uploadedAsset as UploadSuccess;
  },
};
