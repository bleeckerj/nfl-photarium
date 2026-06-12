const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.PHOTARIUM_OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
function normalizePrompt(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function normalizeImageOutputFormat(value) {
    const normalized = (value || 'png').trim().toLowerCase();
    if (normalized === 'jpg' || normalized === 'jpeg')
        return 'jpeg';
    if (normalized === 'webp')
        return 'webp';
    return 'png';
}
function imageMimeForOutputFormat(format) {
    return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}
function extensionForOutputFormat(format) {
    return format === 'jpeg' ? '.jpg' : `.${format}`;
}
function toImageDataUrl(base64, contentType) {
    return `data:${contentType};base64,${base64}`;
}
function detectImageMimeFromBuffer(buffer) {
    if (!buffer || buffer.length < 12)
        return undefined;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
        return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return 'image/jpeg';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50)
        return 'image/webp';
    const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trim().toLowerCase();
    if (head.includes('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
        return 'image/svg+xml';
    return undefined;
}
function cleanFilename(value) {
    const [name] = value.split(/[?#]/);
    const last = (name.split(/[\\/]/).pop() || 'GeneratedImage').trim();
    const dot = last.lastIndexOf('.');
    const stem = dot > 0 ? last.slice(0, dot) : last;
    return stem.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'GeneratedImage';
}
function camelizeUploadStem(value) {
    const words = value.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length)
        return 'GeneratedImage';
    const merged = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
    return /^\d/.test(merged) ? `Image${merged}` : merged;
}
function buildGeneratedFilename(settings, outputFormat) {
    const extension = extensionForOutputFormat(outputFormat);
    const stem = settings.filename
        ? cleanFilename(settings.filename)
        : camelizeUploadStem(settings.displayName || settings.description || settings.prompt.slice(0, 80));
    return `${stem}${extension}`;
}
function readOpenAiApiKey() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey)
        throw new Error('OPENAI_API_KEY is required for Photarium image generation tools');
    return apiKey;
}
async function postOpenAiImageRequest(endpointPath, body) {
    const endpoint = new URL(endpointPath, `${OPENAI_API_BASE_URL.replace(/\/$/, '')}/`);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${readOpenAiApiKey()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const rawText = await response.text();
    let parsed = rawText;
    try {
        parsed = rawText ? JSON.parse(rawText) : {};
    }
    catch {
        parsed = rawText;
    }
    if (!response.ok) {
        throw new Error(`OpenAI image generation failed (${response.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const data = Array.isArray(record.data) ? record.data : [];
    const first = data.find((item) => !!item && typeof item === 'object' && !Array.isArray(item));
    const b64Json = typeof first?.b64_json === 'string' ? first.b64_json : undefined;
    const url = typeof first?.url === 'string' ? first.url : undefined;
    const revisedPrompt = typeof first?.revised_prompt === 'string' ? first.revised_prompt : undefined;
    if (!b64Json && !url)
        throw new Error('OpenAI image generation returned no image data');
    return { b64Json, url, revisedPrompt };
}
async function fetchImageUrlAsBase64(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Failed to download generated image URL (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
        base64: buffer.toString('base64'),
        contentType: detectImageMimeFromBuffer(buffer) || response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
    };
}
async function rasterizeReferenceIfNeeded(buffer, contentType, label) {
    const normalized = (contentType || detectImageMimeFromBuffer(buffer) || '').split(';')[0].trim().toLowerCase();
    if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(normalized)) {
        return { buffer, contentType: normalized === 'image/jpg' ? 'image/jpeg' : normalized, converted: false };
    }
    try {
        const sharp = (await import('sharp')).default;
        return { buffer: await sharp(buffer, { failOn: 'none' }).png().toBuffer(), contentType: 'image/png', converted: true };
    }
    catch (error) {
        throw new Error(`Reference image ${label} is ${normalized || 'an unsupported format'} and could not be rasterized to PNG: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function resolveGenerationReference(deps, reference, index) {
    const role = reference.role || 'semantic_source';
    const instructions = normalizePrompt(reference.instructions);
    const warnings = [];
    if (reference.imageId) {
        const download = await deps.downloadOriginalImageById(reference.imageId);
        const prepared = await rasterizeReferenceIfNeeded(Buffer.from(download.base64, 'base64'), download.contentType, reference.imageId);
        if (prepared.converted)
            warnings.push(`Reference ${reference.imageId} was converted from ${download.contentType || 'unknown'} to image/png for OpenAI input.`);
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
function buildReferencePrompt(prompt, references, mode) {
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
function buildImageRequestSettings(settings) {
    return {
        model: settings.model || DEFAULT_OPENAI_IMAGE_MODEL,
        size: settings.size,
        quality: settings.quality,
        background: settings.background,
        outputFormat: normalizeImageOutputFormat(settings.outputFormat),
    };
}
function buildImagePromptProvenance(args) {
    return JSON.stringify({
        photariumMcpGeneration: {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            ...args,
        },
    }, null, 2);
}
async function materializeOpenAiImageResult(result, outputContentType) {
    if (result.b64Json)
        return { base64: result.b64Json, contentType: outputContentType };
    if (result.url)
        return fetchImageUrlAsBase64(result.url);
    throw new Error('OpenAI image generation returned no materializable image');
}
async function uploadGeneratedImage(deps, options) {
    return deps.uploadFileBase64('/api/upload/external', {
        base64: options.base64,
        filename: buildGeneratedFilename(options.settings, normalizeImageOutputFormat(options.settings.outputFormat)),
        contentType: options.contentType,
        folder: options.settings.folder,
        tags: options.settings.tags,
        description: options.settings.description,
        namespace: options.settings.namespace,
        parentId: options.parentId || options.settings.parentId,
        prompt: options.provenancePrompt,
        sourceUrl: 'https://platform.openai.com/docs/guides/image-generation',
    });
}
export async function generatePhotariumImage(deps, settings) {
    const requestSettings = buildImageRequestSettings(settings);
    const requestBody = {
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
export async function generatePhotariumImageFromReferences(deps, settings, references, mode = 'reference_generate') {
    if (!references.length)
        throw new Error(`${mode === 'semantic_merge' ? 'sources' : 'references'} must include at least one image`);
    const requestSettings = buildImageRequestSettings(settings);
    const resolved = settings.dryRun
        ? references.map((reference, index) => ({
            imageUrl: reference.imageId ? `photarium:${reference.imageId}` : reference.url || '',
            role: reference.role || 'semantic_source',
            instructions: normalizePrompt(reference.instructions),
            warnings: [],
            provenance: { index, imageId: reference.imageId, url: reference.url, role: reference.role || 'semantic_source', instructions: normalizePrompt(reference.instructions) },
        }))
        : await Promise.all(references.map((reference, index) => resolveGenerationReference(deps, reference, index)));
    const prompt = buildReferencePrompt(settings.prompt, resolved.map((reference) => ({ role: reference.role, instructions: reference.instructions })), mode);
    const requestBody = {
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
            upload: { filename: buildGeneratedFilename(settings, requestSettings.outputFormat), namespace: settings.namespace, folder: settings.folder, tags: settings.tags, parentId: singleParentId || settings.parentId },
        };
    }
    const openAiResult = await postOpenAiImageRequest('/images/edits', requestBody);
    const materialized = await materializeOpenAiImageResult(openAiResult, imageMimeForOutputFormat(requestSettings.outputFormat));
    const upload = await uploadGeneratedImage(deps, {
        base64: materialized.base64,
        contentType: materialized.contentType,
        settings,
        provenancePrompt: buildImagePromptProvenance({ mode, prompt: settings.prompt, revisedPrompt: openAiResult.revisedPrompt, ...requestSettings, sources }),
        parentId: singleParentId,
    });
    return { mode, imageId: upload.id || upload.imageId || null, url: upload.url || upload.cloudflareUrl || null, upload, revisedPrompt: openAiResult.revisedPrompt || null, model: requestSettings.model, settings: requestSettings, sources, warnings };
}
