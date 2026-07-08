import sharp from 'sharp';
import {
  createEffectsApi,
  runEightBitPhotariumWorkflow,
  type EffectsApi,
} from 'nfl-grainrad-clone';

import { getCachedImage } from '@/server/cloudflareImageCache';
import { getPromptThisRecord } from '@/server/promptThis';
import type { GrainradArtifact, GrainradRenderProgress } from '@/server/image-tools/grainradEngine';
import type { ImageToolRequest, ImageToolWorkflow } from '@/server/image-tools/types';

const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.PHOTARIUM_OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_REFERENCE_MAX_DIM = 1024;

const PRESET_QUALITY: Record<string, number> = {
  preview: 70,
  balanced: 82,
  'high-quality': 92,
};

const COLOR_DEPTH_PRESETS: Record<string, {
  paletteSize: number;
  prompt: string;
}> = {
  minimal: {
    paletteSize: 10,
    prompt: 'Color depth: use a very limited 8-10 color palette with sparse ramps and minimal interior color variation.',
  },
  classic: {
    paletteSize: 14,
    prompt: 'Color depth: use a classic 12-14 color palette with controlled ramps and restrained dithering.',
  },
  rich: {
    paletteSize: 18,
    prompt: 'Color depth: use a richer 14-16 color pixel-art palette while preserving broad source color families.',
  },
  expanded: {
    paletteSize: 24,
    prompt: 'Color depth: use an expanded 18-24 color pixel-art palette, keeping colors deliberately quantized.',
  },
};

const PIXEL_SCALE_PRESETS: Record<string, {
  workingWidth: number;
  upscale: number;
  prompt: string;
}> = {
  fine: {
    workingWidth: 320,
    upscale: 2,
    prompt: 'Pixel size: use smaller visible pixels and preserve more large-shape detail.',
  },
  medium: {
    workingWidth: 256,
    upscale: 3,
    prompt: 'Pixel size: use balanced home-console blocks with simplified forms.',
  },
  chunky: {
    workingWidth: 160,
    upscale: 4,
    prompt: 'Pixel size: lower the working resolution for larger blocks, chunkier silhouettes, and fewer tiny features.',
  },
  blocky: {
    workingWidth: 96,
    upscale: 6,
    prompt: 'Pixel size: use a very low working resolution with large visible tiles and strongly simplified shapes.',
  },
};

type OpenAiImageResult = {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
};

type EightBitRenderOptions = {
  onProgress?: (progress: GrainradRenderProgress) => void | Promise<void>;
};

let apiSingleton: EffectsApi | null = null;
const getApi = (): EffectsApi => {
  if (!apiSingleton) apiSingleton = createEffectsApi();
  return apiSingleton;
};

const normalizeWorkflow = (workflow?: ImageToolWorkflow): Required<ImageToolWorkflow> => ({
  mode: workflow?.mode === 'filter' ? 'filter' : 'reinterpretation',
  styleStrength: workflow?.styleStrength || 'polished',
  promptHint: workflow?.promptHint || '',
  colorDepth: workflow?.colorDepth || 'classic',
  pixelScale: workflow?.pixelScale || 'medium',
});

const buildWorkflowPromptHint = (workflow: Required<ImageToolWorkflow>) => {
  return [
    COLOR_DEPTH_PRESETS[workflow.colorDepth]?.prompt,
    PIXEL_SCALE_PRESETS[workflow.pixelScale]?.prompt,
    workflow.promptHint,
  ].filter(Boolean).join('\n');
};

const buildWorkflowParams = (
  params: ImageToolRequest['params'],
  workflow: Required<ImageToolWorkflow>
) => {
  const colorDepth = COLOR_DEPTH_PRESETS[workflow.colorDepth];
  const pixelScale = PIXEL_SCALE_PRESETS[workflow.pixelScale];
  return {
    ...params,
    ...(colorDepth ? { paletteSize: colorDepth.paletteSize } : {}),
    ...(pixelScale ? {
      workingWidth: pixelScale.workingWidth,
      upscale: pixelScale.upscale,
    } : {}),
  };
};

const readOpenAiApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for Photarium 8-bit reinterpretation');
  return apiKey;
};

const parseOpenAiImageResponse = async (response: Response): Promise<OpenAiImageResult> => {
  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = rawText;
  }
  if (!response.ok) {
    throw new Error(`OpenAI 8-bit reinterpretation failed (${response.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const first = data.find((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  const b64Json = typeof first?.b64_json === 'string' ? first.b64_json : undefined;
  const url = typeof first?.url === 'string' ? first.url : undefined;
  const revisedPrompt = typeof first?.revised_prompt === 'string' ? first.revised_prompt : undefined;
  if (!b64Json && !url) throw new Error('OpenAI 8-bit reinterpretation returned no image data');
  return { b64Json, url, revisedPrompt };
};

const fetchGeneratedImageUrl = async (url: string) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to download OpenAI 8-bit reinterpretation image (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};

const materializeOpenAiPng = async (result: OpenAiImageResult) => {
  const imageBuffer = result.b64Json
    ? Buffer.from(result.b64Json, 'base64')
    : await fetchGeneratedImageUrl(result.url!);
  return sharp(imageBuffer, { failOn: 'none' }).png().toBuffer();
};

const buildOpenAiReferenceDataUrl = async (sourceBuffer: Buffer) => {
  const png = await sharp(sourceBuffer, { failOn: 'none' })
    .resize(OPENAI_REFERENCE_MAX_DIM, OPENAI_REFERENCE_MAX_DIM, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
};

const postOpenAiReferenceEdit = async (params: {
  prompt: string;
  sourceBuffer: Buffer;
}) => {
  const endpoint = new URL('images/edits', `${OPENAI_API_BASE_URL.replace(/\/$/, '')}/`);
  const body: Record<string, unknown> = {
    model: DEFAULT_OPENAI_IMAGE_MODEL,
    prompt: params.prompt,
    images: [{ image_url: await buildOpenAiReferenceDataUrl(params.sourceBuffer) }],
    output_format: 'png',
  };
  const size = process.env.PHOTARIUM_8BIT_IMAGE_SIZE?.trim();
  const quality = process.env.PHOTARIUM_8BIT_IMAGE_QUALITY?.trim();
  if (size) body.size = size;
  if (quality) body.quality = quality;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readOpenAiApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseOpenAiImageResponse(response);
};

const sourceDescriptionFromCache = async (imageId: string) => {
  const promptRecord = await getPromptThisRecord(imageId).catch(() => null);
  if (promptRecord?.prompt) return promptRecord.prompt;

  const source = await getCachedImage(imageId).catch(() => null);
  const description = source && typeof source.description === 'string' ? source.description.trim() : '';
  return description || undefined;
};

const sourceToPng = (sourceBuffer: Buffer) =>
  sharp(sourceBuffer, { failOn: 'none' }).png().toBuffer();

const outputExtension = (format: string) => {
  const normalized = format.trim().toLowerCase();
  return normalized === 'jpeg' ? 'jpg' : normalized;
};

const encodeStillOutput = async (pngBuffer: Buffer, request: ImageToolRequest) => {
  const format = request.output.format.trim().toLowerCase();
  const quality = PRESET_QUALITY[request.output.preset ?? 'balanced'] ?? PRESET_QUALITY.balanced;
  if (format === 'webp') {
    return {
      buffer: await sharp(pngBuffer, { failOn: 'none' }).webp({ quality }).toBuffer(),
      contentType: 'image/webp',
      extension: 'webp',
    };
  }
  if (format === 'jpg' || format === 'jpeg') {
    return {
      buffer: await sharp(pngBuffer, { failOn: 'none' }).jpeg({ quality }).toBuffer(),
      contentType: 'image/jpeg',
      extension: 'jpg',
    };
  }
  return {
    buffer: pngBuffer,
    contentType: 'image/png',
    extension: outputExtension(format) || 'png',
  };
};

export const renderEightBitWorkflowArtifact = async (
  sourceBuffer: Buffer,
  request: ImageToolRequest,
  options: EightBitRenderOptions & { sourceImageId: string } = { sourceImageId: '' }
): Promise<GrainradArtifact> => {
  if (request.output.mode !== 'still') {
    throw new Error('8-bit reinterpretation exports support still images only');
  }

  await options.onProgress?.({
    phase: 'decode',
    message: 'Preparing source image for 8-bit workflow',
    percent: 0.15,
  });
  const sourcePngBuffer = await sourceToPng(sourceBuffer);
  const workflow = normalizeWorkflow(request.workflow);

  await options.onProgress?.({
    phase: 'render',
    message: workflow.mode === 'reinterpretation'
      ? 'Generating authored 8-bit reinterpretation'
      : 'Rendering direct 8-bit filter',
    percent: workflow.mode === 'reinterpretation' ? 0.35 : 0.45,
    details: {
      workflowMode: workflow.mode,
      styleStrength: workflow.styleStrength,
      colorDepth: workflow.colorDepth,
      pixelScale: workflow.pixelScale,
    },
  });

  const result = await runEightBitPhotariumWorkflow({
    api: getApi(),
    mode: workflow.mode,
    sourcePngBuffer,
    sourceReference: { imageId: options.sourceImageId },
    sourceDescription: workflow.mode === 'reinterpretation' && options.sourceImageId
      ? await sourceDescriptionFromCache(options.sourceImageId)
      : undefined,
    styleStrength: workflow.styleStrength,
    promptHint: buildWorkflowPromptHint(workflow),
    params: buildWorkflowParams(request.params, workflow),
    renderContext: request.renderContext,
    generateImage: workflow.mode === 'reinterpretation'
      ? async ({ prompt }: { prompt: string }) => {
          const openAiResult = await postOpenAiReferenceEdit({ prompt, sourceBuffer });
          return {
            pngBuffer: await materializeOpenAiPng(openAiResult),
            revisedPrompt: openAiResult.revisedPrompt,
            model: DEFAULT_OPENAI_IMAGE_MODEL,
          };
        }
      : undefined,
  });

  const rendered = result.rendered as { png?: Buffer | Uint8Array };
  if (!rendered.png) {
    throw new Error('8-bit workflow did not return rendered PNG bytes');
  }

  await options.onProgress?.({
    phase: 'encode',
    message: 'Encoding 8-bit workflow output',
    percent: 0.8,
    details: {
      workflowMode: result.mode,
      styleStrength: result.styleStrength,
      colorDepth: workflow.colorDepth,
      pixelScale: workflow.pixelScale,
    },
  });
  const encoded = await encodeStillOutput(Buffer.from(rendered.png), request);
  return {
    buffer: encoded.buffer,
    contentType: encoded.contentType,
    filename: `grainrad-eight-bit.${encoded.extension}`,
  };
};
