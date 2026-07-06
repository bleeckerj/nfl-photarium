const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.PHOTARIUM_OPENAI_IMAGE_MODEL || 'gpt-image-2';

export type ImageReferenceRole =
  | 'style_reference'
  | 'subject_reference'
  | 'composition_reference'
  | 'brand_reference'
  | 'logo_reference'
  | 'semantic_source';

export interface ImageReferenceInput {
  imageId?: string;
  url?: string;
  role?: ImageReferenceRole;
  instructions?: string;
}

export interface ImageGenerationSettings {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  filename?: string;
  namespace?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  displayName?: string;
  parentId?: string;
  originalUrl?: string;
  sourceUrl?: string;
  dryRun?: boolean;
}

export interface AspectRatioVariantSettings {
  imageId?: string;
  imageUrl?: string;
  aspectRatio?: string;
  prompt?: string;
  model?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  filename?: string;
  namespace?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  displayName?: string;
  parentId?: string;
  originalUrl?: string;
  sourceUrl?: string;
  dryRun?: boolean;
}

interface DownloadedImage {
  filename?: string;
  contentType?: string;
  base64: string;
  variantUsed: string;
  fallbackUsed: boolean;
}

interface UploadPayload {
  base64: string;
  filename: string;
  contentType?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  prompt?: string;
}

export interface ImageGenerationDeps {
  downloadOriginalImageById: (imageId: string) => Promise<DownloadedImage>;
  uploadFileBase64: (endpoint: '/api/upload' | '/api/upload/external', payload: UploadPayload) => Promise<Record<string, unknown>>;
}

export interface AspectRatioVariantDeps extends ImageGenerationDeps {
  getImage: (imageId: string) => Promise<Record<string, unknown> | null>;
}

interface OpenAiImageResult {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
}

function normalizePrompt(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickTags(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : undefined;
}

function normalizeImageOutputFormat(value?: string): 'png' | 'jpeg' | 'webp' {
  const normalized = (value || 'png').trim().toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpeg';
  if (normalized === 'webp') return 'webp';
  return 'png';
}

function imageMimeForOutputFormat(format: string): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function extensionForOutputFormat(format: string): string {
  return format === 'jpeg' ? '.jpg' : `.${format}`;
}

function toImageDataUrl(base64: string, contentType: string): string {
  return `data:${contentType};base64,${base64}`;
}

function detectImageMimeFromBuffer(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 12) return undefined;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trim().toLowerCase();
  if (head.includes('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

function cleanFilename(value: string): string {
  const [name] = value.split(/[?#]/);
  const last = (name.split(/[\\/]/).pop() || 'GeneratedImage').trim();
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last;
  return stem.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'GeneratedImage';
}

function camelizeUploadStem(value: string): string {
  const words = value.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return 'GeneratedImage';
  const merged = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
  return /^\d/.test(merged) ? `Image${merged}` : merged;
}

function buildGeneratedFilename(settings: ImageGenerationSettings, outputFormat: string): string {
  const extension = extensionForOutputFormat(outputFormat);
  const stem = settings.filename
    ? cleanFilename(settings.filename)
    : camelizeUploadStem(settings.displayName || settings.description || settings.prompt.slice(0, 80));
  return `${stem}${extension}`;
}

export function parseImageAspectRatio(value: string = '4:5'): { label: string; width: number; height: number } {
  const normalized = value.trim().replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)(?::|\/|x)(\d+(?:\.\d+)?)$/i);
  if (!match) {
    throw new Error(`Invalid aspectRatio "${value}". Use a ratio like "4:5", "1:1", or "9:16".`);
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid aspectRatio "${value}". Ratio numbers must be positive.`);
  }

  return {
    label: `${match[1]}:${match[2]}`,
    width,
    height,
  };
}

function ratioToken(aspectRatio: string): string {
  return aspectRatio.replace(/[^A-Za-z0-9]+/g, 'x');
}

function defaultAspectRatioSize(aspectRatio: { width: number; height: number }): string {
  const base = 1024;
  if (aspectRatio.width === aspectRatio.height) return `${base}x${base}`;
  if (aspectRatio.width < aspectRatio.height) {
    return `${base}x${Math.max(1, Math.round(base * aspectRatio.height / aspectRatio.width))}`;
  }
  return `${Math.max(1, Math.round(base * aspectRatio.width / aspectRatio.height))}x${base}`;
}

function sourceMetadataFromImage(image: Record<string, unknown> | null): {
  filename?: string;
  namespace?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
} {
  if (!image) return {};
  const meta = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata)
    ? image.metadata as Record<string, unknown>
    : {};
  return {
    filename: pickString(image.filename) || pickString(meta.filename),
    namespace: pickString(image.namespace) || pickString(meta.namespace),
    folder: pickString(image.folder) || pickString(meta.folder),
    tags: pickTags(image.tags) || pickTags(meta.tags),
    description: pickString(image.description) || pickString(meta.description),
    originalUrl: pickString(image.originalUrl) || pickString(meta.originalUrl),
    sourceUrl: pickString(image.sourceUrl) || pickString(meta.sourceUrl),
  };
}

function buildAspectRatioVariantFilename(options: {
  requested?: string;
  sourceFilename?: string;
  aspectRatio: string;
  outputFormat: string;
}): string {
  const source = options.requested || options.sourceFilename || 'AspectRatioVariant';
  const sourceStem = cleanFilename(source);
  const baseStem = options.requested ? sourceStem : `${sourceStem}_${ratioToken(options.aspectRatio)}_imagegen_variant`;
  return `${baseStem}${extensionForOutputFormat(options.outputFormat)}`;
}

function buildAspectRatioVariantPrompt(options: {
  aspectRatio: string;
  sourceLabel: string;
  additionalInstructions?: string;
}): string {
  const lines = [
    'Use case: precise-object-edit',
    'Asset type: Photarium image-generated aspect-ratio variant',
    `Primary request: Change the source image to a ${options.aspectRatio} aspect ratio by extending or recomposing the canvas as needed.`,
    `Input images: Image 1 is the edit target/source image (${options.sourceLabel}).`,
    `Composition/framing: preserve the complete visible source image inside the new ${options.aspectRatio} frame; do not crop, zoom, stretch, squeeze, or distort any part of the source.`,
    'Constraints: keep the subject identity, visual style, lighting, texture, embedded text, logos, and important edge details intact. Add plausible surrounding content only where new canvas area is needed.',
    'Avoid: cropping, stretching, perspective distortion, changed text, changed logos, watermarks, borders, frames, or blank padding.',
  ];
  if (options.additionalInstructions) {
    lines.push(`Additional instructions: ${options.additionalInstructions}`);
  }
  return lines.join('\n');
}

function readOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for Photarium image generation tools');
  return apiKey;
}

async function postOpenAiImageRequest(endpointPath: '/images/generations' | '/images/edits', body: Record<string, unknown>): Promise<OpenAiImageResult> {
  const endpoint = new URL(endpointPath.replace(/^\//, ''), `${OPENAI_API_BASE_URL.replace(/\/$/, '')}/`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readOpenAiApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = rawText;
  }
  if (!response.ok) {
    throw new Error(`OpenAI image generation failed (${response.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const first = data.find((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  const b64Json = typeof first?.b64_json === 'string' ? first.b64_json : undefined;
  const url = typeof first?.url === 'string' ? first.url : undefined;
  const revisedPrompt = typeof first?.revised_prompt === 'string' ? first.revised_prompt : undefined;
  if (!b64Json && !url) throw new Error('OpenAI image generation returned no image data');
  return { b64Json, url, revisedPrompt };
}

async function fetchImageUrlAsBase64(url: string): Promise<{ base64: string; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated image URL (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    base64: buffer.toString('base64'),
    contentType: detectImageMimeFromBuffer(buffer) || response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
  };
}

async function rasterizeReferenceIfNeeded(buffer: Buffer, contentType: string | undefined, label: string): Promise<{ buffer: Buffer; contentType: string; converted: boolean }> {
  const normalized = (contentType || detectImageMimeFromBuffer(buffer) || '').split(';')[0].trim().toLowerCase();
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(normalized)) {
    return { buffer, contentType: normalized === 'image/jpg' ? 'image/jpeg' : normalized, converted: false };
  }
  try {
    const sharp = (await import('sharp')).default;
    return { buffer: await sharp(buffer, { failOn: 'none' }).png().toBuffer(), contentType: 'image/png', converted: true };
  } catch (error) {
    throw new Error(`Reference image ${label} is ${normalized || 'an unsupported format'} and could not be rasterized to PNG: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveGenerationReference(deps: ImageGenerationDeps, reference: ImageReferenceInput, index: number) {
  const role = reference.role || 'semantic_source';
  const instructions = normalizePrompt(reference.instructions);
  const warnings: string[] = [];
  if (reference.imageId) {
    const download = await deps.downloadOriginalImageById(reference.imageId);
    const prepared = await rasterizeReferenceIfNeeded(Buffer.from(download.base64, 'base64'), download.contentType, reference.imageId);
    if (prepared.converted) warnings.push(`Reference ${reference.imageId} was converted from ${download.contentType || 'unknown'} to image/png for OpenAI input.`);
    return {
      imageUrl: toImageDataUrl(prepared.buffer.toString('base64'), prepared.contentType),
      role,
      instructions,
      warnings,
      provenance: {
        index,
        imageId: reference.imageId,
        role,
        instructions,
        source: 'photarium',
        filename: download.filename,
        contentType: download.contentType,
        variantUsed: download.variantUsed,
        fallbackUsed: download.fallbackUsed,
      },
    };
  }
  if (reference.url) {
    return {
      imageUrl: reference.url,
      role,
      instructions,
      warnings,
      provenance: { index, url: reference.url, role, instructions, source: 'url' },
    };
  }
  throw new Error(`Reference ${index + 1} must include imageId or url`);
}

type ReferenceGenerationMode = 'reference_generate' | 'semantic_merge' | 'aspect_ratio_variant';

function buildReferencePrompt(prompt: string, references: Array<{ role: ImageReferenceRole; instructions?: string }>, mode: ReferenceGenerationMode): string {
  const lines = [prompt.trim()];
  if (mode === 'semantic_merge') {
    lines.push('', 'Semantic merge instruction: synthesize a new image that blends concepts, visual language, subjects, textures, product cues, and mood from the sources. Do not preserve exact placement, exact logos, or pixel-level composition unless explicitly requested elsewhere.');
  }
  if (references.length) {
    lines.push('', 'Input image roles:');
    references.forEach((reference, index) => {
      lines.push(`Image ${index + 1}: ${reference.role}${reference.instructions ? ` — ${reference.instructions}` : ''}`);
    });
  }
  return lines.join('\n');
}

function buildImageRequestSettings(settings: ImageGenerationSettings) {
  return {
    model: settings.model || DEFAULT_OPENAI_IMAGE_MODEL,
    size: settings.size,
    quality: settings.quality,
    background: settings.background,
    outputFormat: normalizeImageOutputFormat(settings.outputFormat),
  };
}

function buildImagePromptProvenance(args: Record<string, unknown>): string {
  return JSON.stringify({
    photariumMcpGeneration: {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      ...args,
    },
  }, null, 2);
}

async function materializeOpenAiImageResult(result: OpenAiImageResult, outputContentType: string): Promise<{ base64: string; contentType: string }> {
  if (result.b64Json) return { base64: result.b64Json, contentType: outputContentType };
  if (result.url) return fetchImageUrlAsBase64(result.url);
  throw new Error('OpenAI image generation returned no materializable image');
}

async function uploadGeneratedImage(deps: ImageGenerationDeps, options: {
  base64: string;
  contentType: string;
  settings: ImageGenerationSettings;
  provenancePrompt: string;
  parentId?: string;
}): Promise<Record<string, unknown>> {
  return deps.uploadFileBase64('/api/upload/external', {
    base64: options.base64,
    filename: buildGeneratedFilename(options.settings, normalizeImageOutputFormat(options.settings.outputFormat)),
    contentType: options.contentType,
    folder: options.settings.folder,
    tags: options.settings.tags,
    description: options.settings.description,
    originalUrl: options.settings.originalUrl,
    namespace: options.settings.namespace,
    parentId: options.parentId || options.settings.parentId,
    prompt: options.provenancePrompt,
    sourceUrl: options.settings.sourceUrl || 'https://platform.openai.com/docs/guides/image-generation',
  });
}

export async function generatePhotariumImage(deps: ImageGenerationDeps, settings: ImageGenerationSettings): Promise<Record<string, unknown>> {
  const requestSettings = buildImageRequestSettings(settings);
  const requestBody: Record<string, unknown> = {
    model: requestSettings.model,
    prompt: settings.prompt,
    ...(requestSettings.size ? { size: requestSettings.size } : {}),
    ...(requestSettings.quality ? { quality: requestSettings.quality } : {}),
    ...(requestSettings.background ? { background: requestSettings.background } : {}),
    output_format: requestSettings.outputFormat,
  };
  if (settings.dryRun) {
    return {
      dryRun: true,
      mode: 'text_to_image',
      request: { endpoint: '/images/generations', body: requestBody },
      upload: { filename: buildGeneratedFilename(settings, requestSettings.outputFormat), namespace: settings.namespace, folder: settings.folder, tags: settings.tags },
    };
  }
  const openAiResult = await postOpenAiImageRequest('/images/generations', requestBody);
  const materialized = await materializeOpenAiImageResult(openAiResult, imageMimeForOutputFormat(requestSettings.outputFormat));
  const upload = await uploadGeneratedImage(deps, {
    base64: materialized.base64,
    contentType: materialized.contentType,
    settings,
    provenancePrompt: buildImagePromptProvenance({ mode: 'text_to_image', prompt: settings.prompt, revisedPrompt: openAiResult.revisedPrompt, ...requestSettings }),
  });
  return { mode: 'text_to_image', imageId: upload.id || upload.imageId || null, url: upload.url || upload.cloudflareUrl || null, upload, revisedPrompt: openAiResult.revisedPrompt || null, model: requestSettings.model, settings: requestSettings };
}

export async function generatePhotariumImageFromReferences(
  deps: ImageGenerationDeps,
  settings: ImageGenerationSettings,
  references: ImageReferenceInput[],
  mode: ReferenceGenerationMode = 'reference_generate'
): Promise<Record<string, unknown>> {
  if (!references.length) throw new Error(`${mode === 'semantic_merge' ? 'sources' : 'references'} must include at least one image`);
  const requestSettings = buildImageRequestSettings(settings);
  const resolved = settings.dryRun
    ? references.map((reference, index) => ({
        imageUrl: reference.imageId ? `photarium:${reference.imageId}` : reference.url || '',
        role: reference.role || 'semantic_source' as ImageReferenceRole,
        instructions: normalizePrompt(reference.instructions),
        warnings: [] as string[],
        provenance: { index, imageId: reference.imageId, url: reference.url, role: reference.role || 'semantic_source', instructions: normalizePrompt(reference.instructions) },
      }))
    : await Promise.all(references.map((reference, index) => resolveGenerationReference(deps, reference, index)));
  const prompt = buildReferencePrompt(settings.prompt, resolved.map((reference) => ({ role: reference.role, instructions: reference.instructions })), mode);
  const requestBody: Record<string, unknown> = {
    model: requestSettings.model,
    prompt,
    images: resolved.map((reference) => ({ image_url: reference.imageUrl })),
    ...(requestSettings.size ? { size: requestSettings.size } : {}),
    ...(requestSettings.quality ? { quality: requestSettings.quality } : {}),
    ...(requestSettings.background ? { background: requestSettings.background } : {}),
    output_format: requestSettings.outputFormat,
  };
  const warnings = resolved.flatMap((reference) => reference.warnings);
  const sources = resolved.map((reference) => reference.provenance);
  const singleParentId = references.length === 1 && references[0]?.imageId ? references[0].imageId : undefined;
  if (settings.dryRun) {
    return {
      dryRun: true,
      mode,
      request: { endpoint: '/images/edits', body: requestBody },
      sources,
      warnings,
      upload: { filename: buildGeneratedFilename(settings, requestSettings.outputFormat), namespace: settings.namespace, folder: settings.folder, tags: settings.tags, parentId: settings.parentId || singleParentId },
    };
  }
  const openAiResult = await postOpenAiImageRequest('/images/edits', requestBody);
  const materialized = await materializeOpenAiImageResult(openAiResult, imageMimeForOutputFormat(requestSettings.outputFormat));
  const upload = await uploadGeneratedImage(deps, {
    base64: materialized.base64,
    contentType: materialized.contentType,
    settings,
    provenancePrompt: buildImagePromptProvenance({ mode, prompt: settings.prompt, revisedPrompt: openAiResult.revisedPrompt, ...requestSettings, sources }),
    parentId: settings.parentId || singleParentId,
  });
  return { mode, imageId: upload.id || upload.imageId || null, url: upload.url || upload.cloudflareUrl || null, upload, revisedPrompt: openAiResult.revisedPrompt || null, model: requestSettings.model, settings: requestSettings, sources, warnings };
}

export async function generatePhotariumAspectRatioVariant(
  deps: AspectRatioVariantDeps,
  settings: AspectRatioVariantSettings
): Promise<Record<string, unknown>> {
  const imageId = pickString(settings.imageId);
  const imageUrl = pickString(settings.imageUrl);
  if ((imageId ? 1 : 0) + (imageUrl ? 1 : 0) !== 1) {
    throw new Error('Provide exactly one source: imageId or imageUrl.');
  }

  const aspectRatio = parseImageAspectRatio(settings.aspectRatio);
  const sourceMetadata = imageId && !settings.dryRun
    ? sourceMetadataFromImage(await deps.getImage(imageId))
    : {};
  const outputFormat = normalizeImageOutputFormat(settings.outputFormat || 'png');
  const prompt = buildAspectRatioVariantPrompt({
    aspectRatio: aspectRatio.label,
    sourceLabel: imageId ? `Photarium image ${imageId}` : imageUrl || 'direct image URL',
    additionalInstructions: normalizePrompt(settings.prompt),
  });
  const filename = buildAspectRatioVariantFilename({
    requested: settings.filename,
    sourceFilename: sourceMetadata.filename,
    aspectRatio: aspectRatio.label,
    outputFormat,
  });

  const generationSettings: ImageGenerationSettings = {
    prompt,
    model: settings.model,
    size: settings.size || defaultAspectRatioSize(aspectRatio),
    quality: settings.quality,
    outputFormat,
    background: settings.background,
    filename,
    namespace: settings.namespace || sourceMetadata.namespace,
    folder: settings.folder || sourceMetadata.folder,
    tags: settings.tags || sourceMetadata.tags,
    description:
      settings.description
      || `Image-generated ${aspectRatio.label} aspect-ratio variant preserving the full source image without cropping or stretching.`,
    displayName: settings.displayName,
    parentId: settings.parentId || imageId,
    originalUrl: settings.originalUrl || sourceMetadata.originalUrl,
    sourceUrl: settings.sourceUrl || sourceMetadata.sourceUrl,
    dryRun: settings.dryRun,
  };

  const result = await generatePhotariumImageFromReferences(
    deps,
    generationSettings,
    [
      imageId
        ? {
            imageId,
            role: 'composition_reference',
            instructions: `Edit target. Preserve the full source and recompose only the surrounding canvas to ${aspectRatio.label}; no crop or stretch.`,
          }
        : {
            url: imageUrl,
            role: 'composition_reference',
            instructions: `Edit target. Preserve the full source and recompose only the surrounding canvas to ${aspectRatio.label}; no crop or stretch.`,
          },
    ],
    'aspect_ratio_variant'
  );

  return {
    ...result,
    aspectRatio: aspectRatio.label,
    requestedSource: imageId ? { imageId } : { imageUrl },
  };
}
