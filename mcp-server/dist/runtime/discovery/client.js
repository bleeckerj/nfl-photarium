import { apiRequest, apiRequestRaw } from '../shared/api-client.js';
import { formatImageResult } from '../shared/image-result.js';
import { getPromptRecord } from '../ai/client.js';
import { getExtras } from '../organization/client.js';
export async function semanticSearch(query, limit = 20, namespace) {
    const data = await apiRequest('/api/images/search', {
        method: 'POST',
        body: JSON.stringify({ type: 'text', query, limit, namespace }),
    });
    return {
        results: data.results.map(formatImageResult),
        query,
        count: data.results.length,
    };
}
// Traditional text search - matches filename, folder, tags, description, alt text
export async function textSearch(query, options = {}) {
    const { images } = await listImages({
        folder: options.folder,
        namespace: options.namespace,
        limit: 0,
        refresh: options.refresh,
    });
    const needle = query.toLowerCase();
    const matchesText = (value) => (value || '').toLowerCase().includes(needle);
    const matchesTags = (tags) => (tags || []).some((tag) => matchesText(tag));
    const filtered = images.filter((img) => {
        return (matchesText(img.filename) ||
            matchesText(img.folder || img.meta?.folder) ||
            matchesText(img.description || img.meta?.description) ||
            matchesText(img.altTag || img.meta?.altTag) ||
            matchesText(img.originalUrl) ||
            matchesText(img.sourceUrl) ||
            matchesTags(img.tags || img.meta?.tags));
    });
    const limit = options.limit || 50;
    const limited = filtered.slice(0, limit);
    return {
        results: limited.map(formatImageResult),
        query,
        count: limited.length,
    };
}
export const METADATA_SEARCH_FIELDS = [
    'filename',
    'folder',
    'tags',
    'description',
    'altText',
    'namespace',
    'sourceUrl',
    'originalUrl',
];
function getFieldValues(img, field) {
    switch (field) {
        case 'filename':
            return img.filename ? [img.filename] : [];
        case 'folder':
            return img.folder ? [img.folder] : [];
        case 'tags':
            return img.tags ?? [];
        case 'description':
            return img.description ? [img.description] : [];
        case 'altText':
            return img.altTag ? [img.altTag] : [];
        case 'namespace':
            return img.namespace ? [img.namespace] : [];
        case 'sourceUrl':
            return img.sourceUrl ? [img.sourceUrl] : [];
        case 'originalUrl':
            return img.originalUrl ? [img.originalUrl] : [];
        default:
            return [];
    }
}
function buildMatcher(query, match, caseSensitive) {
    if (match === 'regex') {
        const regex = new RegExp(query, caseSensitive ? undefined : 'i');
        return (value) => regex.test(value);
    }
    const normalize = (value) => (caseSensitive ? value : value.toLowerCase());
    const needle = normalize(query);
    switch (match) {
        case 'exact':
            return (value) => normalize(value) === needle;
        case 'prefix':
            return (value) => normalize(value).startsWith(needle);
        case 'contains':
        default:
            return (value) => normalize(value).includes(needle);
    }
}
export async function metadataSearch(query, options = {}) {
    const match = options.match ?? 'contains';
    const caseSensitive = options.caseSensitive ?? false;
    const requested = options.fields?.length ? options.fields : METADATA_SEARCH_FIELDS;
    // Preserve a stable field order and drop anything unrecognized; fall back to all fields.
    const resolved = METADATA_SEARCH_FIELDS.filter((field) => requested.includes(field));
    const fields = resolved.length ? resolved : METADATA_SEARCH_FIELDS;
    let matcher;
    try {
        matcher = buildMatcher(query, match, caseSensitive);
    }
    catch (error) {
        throw new Error(`Invalid ${match} pattern: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { images } = await listImages({
        folder: options.folder,
        namespace: options.namespace,
        limit: 0,
        refresh: options.refresh,
    });
    const matched = [];
    for (const img of images) {
        const matchedFields = fields.filter((field) => getFieldValues(img, field).some((value) => matcher(value)));
        if (matchedFields.length > 0) {
            matched.push({ ...img, matchedFields });
        }
    }
    const limit = options.limit ?? 50;
    const limited = limit > 0 ? matched.slice(0, limit) : matched;
    return {
        results: limited,
        query,
        count: limited.length,
        fields,
        match,
    };
}
export async function searchByColor(hexColor, limit = 20, namespace) {
    // Normalize hex color
    const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    const data = await apiRequest('/api/images/search', {
        method: 'POST',
        body: JSON.stringify({ type: 'color', query: color, limit, namespace }),
    });
    return {
        results: data.results.map(formatImageResult),
        query: color,
        count: data.results.length,
    };
}
export async function findSimilar(imageId, type = 'clip', limit = 10, options = {}) {
    const params = new URLSearchParams({ type, limit: String(limit) });
    if (options.includeStrangers)
        params.set('includeStrangers', 'true');
    if (options.offset !== undefined)
        params.set('offset', String(options.offset));
    if (options.strangersLimit !== undefined)
        params.set('strangersLimit', String(options.strangersLimit));
    if (options.strangersOffset !== undefined)
        params.set('strangersOffset', String(options.strangersOffset));
    if (options.namespace !== undefined)
        params.set('namespace', String(options.namespace));
    const data = await apiRequest(`/api/images/${imageId}/similar?${params}`);
    const strangers = data.strangers?.map(formatImageResult);
    return {
        results: data.results.map(formatImageResult),
        query: `similar to ${imageId}`,
        count: data.results.length,
        strangers,
        strangersCount: strangers?.length,
    };
}
export async function listImages(options) {
    const params = new URLSearchParams();
    if (options.namespace)
        params.set('namespace', options.namespace);
    if (options.refresh)
        params.set('refresh', '1');
    if (options.aspectRatioClass)
        params.set('aspectRatioClass', options.aspectRatioClass);
    if (options.aspectRatio)
        params.set('aspectRatio', options.aspectRatio);
    const data = await apiRequest(`/api/images?${params}`);
    let images = data.images;
    // Filter by folder if specified
    if (options.folder) {
        images = images.filter((img) => img.meta?.folder === options.folder);
    }
    // Apply limit
    const limit = options.limit ?? 50;
    const limited = limit > 0 ? images.slice(0, limit) : images;
    return {
        images: limited.map(formatImageResult),
        total: images.length,
    };
}
function _toRecord(value) {
    if (!value)
        return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function _pickString(...values) {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed)
                return trimmed;
        }
    }
    return undefined;
}
function _pickNumber(...values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return undefined;
}
function _normalizeDimensions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const obj = value;
    const width = _pickNumber(obj.width, obj.w);
    const height = _pickNumber(obj.height, obj.h);
    if (width && height) {
        return { width, height };
    }
    return undefined;
}
function _deriveAspectRatio(dimensions) {
    if (!dimensions)
        return undefined;
    const { width, height } = dimensions;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(Math.round(width), Math.round(height));
    if (!g)
        return undefined;
    return `${Math.round(width / g)}:${Math.round(height / g)}`;
}
function _formatFileSize(bytes) {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0)
        return undefined;
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${rounded} ${units[unitIndex]}`;
}
export async function getImage(imageId) {
    try {
        const data = await apiRequest(`/api/images/${imageId}`);
        const rawImage = data.image;
        const normalized = formatImageResult(rawImage);
        const metadata = _toRecord(rawImage.meta);
        const dimensions = normalized.dimensions
            || _normalizeDimensions(rawImage.dimensions)
            || _normalizeDimensions(metadata.dimensions)
            || (() => {
                const width = _pickNumber(rawImage.width, metadata.width);
                const height = _pickNumber(rawImage.height, metadata.height);
                return width && height ? { width, height } : undefined;
            })();
        const aspectRatio = _pickString(normalized.aspectRatio, rawImage.aspectRatio, metadata.aspectRatio) || _deriveAspectRatio(dimensions);
        const fileSizeBytes = _pickNumber(rawImage.size, rawImage.fileSize, rawImage.bytes, metadata.size, metadata.fileSize, metadata.bytes);
        const contentType = _pickString(rawImage.type, rawImage.contentType, rawImage.mimeType, metadata.type, metadata.contentType, metadata.mimeType);
        return {
            ...normalized,
            uploadedAt: _pickString(rawImage.uploaded, rawImage.uploadedAt, rawImage.createdAt, rawImage.updatedAt, metadata.uploadedAt, metadata.updatedAt) || null,
            folder: normalized.folder || _pickString(metadata.folder) || null,
            tags: normalized.tags || (Array.isArray(metadata.tags) ? metadata.tags : []),
            displayName: _pickString(rawImage.displayName, metadata.displayName) || null,
            linkedAssetId: _pickString(rawImage.linkedAssetId, metadata.linkedAssetId) || null,
            variationSort: _pickNumber(rawImage.variationSort, metadata.variationSort) ?? null,
            generatedBy: _pickString(rawImage.generatedBy, metadata.generatedBy) || null,
            contentHash: _pickString(rawImage.contentHash, metadata.contentHash) || null,
            fileSizeBytes: fileSizeBytes ?? null,
            fileSize: _formatFileSize(fileSizeBytes) || null,
            contentType: contentType || null,
            dimensions: dimensions || null,
            aspectRatio: aspectRatio || null,
            metadata,
            raw: rawImage,
        };
    }
    catch {
        return null;
    }
}
export async function getImageMetadata(imageId) {
    let rawImage;
    try {
        const data = await apiRequest(`/api/images/${imageId}`);
        rawImage = data.image;
    }
    catch {
        return null;
    }
    const normalized = formatImageResult(rawImage);
    const isVariant = Boolean(normalized.parentId);
    const familyRootId = isVariant ? normalized.parentId : normalized.id;
    let familyVariantCount = null;
    try {
        const { images } = await listImages({ limit: 0 });
        familyVariantCount = images.filter((img) => (img.parentId || null) === familyRootId).length;
    }
    catch {
        familyVariantCount = null;
    }
    let extrasRecord = null;
    try {
        const extras = await getExtras(imageId);
        extrasRecord = extras.record;
    }
    catch {
        extrasRecord = null;
    }
    let promptText = null;
    try {
        const promptResult = await getPromptRecord(imageId);
        const record = (promptResult.record || {});
        const candidate = record.prompt;
        promptText = typeof candidate === 'string' ? candidate : null;
    }
    catch {
        promptText = null;
    }
    const tags = normalized.tags || [];
    const variants = normalized.variants;
    const variantUrls = Array.isArray(variants)
        ? variants
        : variants && typeof variants === 'object'
            ? Object.values(variants)
            : [];
    return {
        id: normalized.id,
        filename: normalized.filename,
        url: normalized.url,
        uploadedAt: rawImage.createdAt
            || rawImage.uploaded
            || rawImage.uploadedAt
            || rawImage.updatedAt
            || null,
        folder: normalized.folder || null,
        namespace: normalized.namespace || null,
        tags,
        description: normalized.description || null,
        altDescription: extrasRecord?.altText || normalized.altTag || null,
        prompt: promptText,
        isVariant,
        parentId: normalized.parentId || null,
        familyRootId,
        variantCount: familyVariantCount,
        variantUrls,
        dimensions: normalized.dimensions || null,
        aspectRatio: normalized.aspectRatio || null,
        dominantColors: normalized.dominantColors || null,
        averageColor: normalized.averageColor || null,
        hasClipEmbedding: normalized.hasClipEmbedding ?? null,
        hasColorEmbedding: normalized.hasColorEmbedding ?? null,
        originalUrl: normalized.originalUrl || null,
        sourceUrl: normalized.sourceUrl || null,
        extras: extrasRecord,
        raw: rawImage,
    };
}
export async function findAntipode(imageId, options = {}) {
    const params = new URLSearchParams();
    if (options.domain)
        params.set('domain', options.domain);
    if (options.method)
        params.set('method', options.method);
    if (options.limit)
        params.set('limit', String(options.limit));
    if (options.namespace !== undefined)
        params.set('namespace', String(options.namespace));
    const data = await apiRequest(`/api/images/${imageId}/antipode?${params}`);
    return {
        results: data.results.map(formatImageResult),
        query: `antipode of ${imageId}`,
        count: data.results.length,
    };
}
export async function searchByImage(imageId, limit = 20, namespace) {
    const data = await apiRequest('/api/images/search', {
        method: 'POST',
        body: JSON.stringify({ type: 'image', imageId, limit, namespace }),
    });
    return {
        results: data.results.map(formatImageResult),
        query: `image:${imageId}`,
        count: data.results.length,
    };
}
export async function downloadImageById(imageId, variant) {
    const params = new URLSearchParams();
    if (variant)
        params.set('variant', variant);
    const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
    const contentType = response.headers.get('content-type') || undefined;
    const disposition = response.headers.get('content-disposition') || undefined;
    const sizeHeader = response.headers.get('content-length') || undefined;
    const requestedVariant = response.headers.get('x-photarium-variant-requested') || undefined;
    const servedVariant = response.headers.get('x-photarium-variant-served') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
    return {
        filename: filenameMatch?.[1],
        contentType,
        size: sizeHeader ? Number(sizeHeader) : undefined,
        base64,
        requestedVariant,
        servedVariant,
    };
}
export async function downloadOriginalImageById(imageId) {
    try {
        const result = await downloadImageById(imageId, 'original');
        return {
            ...result,
            variantUsed: 'original',
            fallbackUsed: false,
        };
    }
    catch (error) {
        const fallback = await downloadImageById(imageId);
        return {
            ...fallback,
            variantUsed: 'default',
            fallbackUsed: true,
            fallbackReason: error instanceof Error ? error.message : String(error),
        };
    }
}
