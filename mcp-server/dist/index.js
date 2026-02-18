/**
 * Photarium MCP Server
 *
 * Exposes the Photarium image gallery API as MCP tools for AI agents.
 * This enables LLMs to browse, search, manage, and curate a Cloudflare Images catalog.
 *
 * Tools - Discovery & Search:
 *   - photarium_search: Semantic text search using CLIP embeddings
 *   - photarium_search_color: Find images by dominant color
 *   - photarium_similar: Find visually similar images
 *   - photarium_antipode: Find semantic/color opposites
 *   - photarium_list: List images with filters
 *   - photarium_get: Get detailed image info
 *
 * Tools - Organization:
 *   - photarium_list_folders: List available folders
 *   - photarium_create_folder: Create a new folder
 *   - photarium_list_namespaces: List namespaces
 *   - photarium_update_metadata: Update image metadata
 *
 * Tools - Upload:
 *   - photarium_upload_url: Upload from URL
 *
 * Tools - AI Features:
 *   - photarium_generate_alt: Generate alt text
 *   - photarium_generate_description: Generate description
 *   - photarium_generate_prompt: Generate text-to-image prompt
 *   - photarium_concepts: Get semantic concept scores
 *
 * Tools - System:
 *   - photarium_vector_status: Check embedding/search system status
 *   - photarium_generate_embeddings: Generate embeddings for an image
 *   - (plus uploads, prompts, extras, audits, batch ops, and family management)
 *
 * Configuration:
 *   PHOTARIUM_BASE_URL - Base URL of Photarium instance (default: http://localhost:3000)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
// Configuration
const BASE_URL = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
// API Client
async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const baseHeaders = {
        'Content-Type': 'application/json',
        'x-photarium-source': 'mcp',
        'x-photarium-component': 'photarium-mcp-server',
        'x-photarium-trigger': 'mcp',
    };
    const response = await fetch(url, {
        ...options,
        headers: {
            ...baseHeaders,
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }
    return response.json();
}
async function apiRequestRaw(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const baseHeaders = {
        'x-photarium-source': 'mcp',
        'x-photarium-component': 'photarium-mcp-server',
        'x-photarium-trigger': 'mcp',
    };
    const response = await fetch(url, {
        ...options,
        headers: {
            ...baseHeaders,
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }
    return response;
}
function parseDataUrl(value) {
    if (!value.startsWith('data:')) {
        return { data: value };
    }
    const [header, data] = value.split(',', 2);
    const mimeMatch = header.match(/^data:([^;]+);base64$/i);
    return { mimeType: mimeMatch?.[1], data: data || '' };
}
function decodeBase64(value) {
    const { mimeType, data } = parseDataUrl(value);
    const buffer = Buffer.from(data, 'base64');
    return { buffer, mimeType };
}
// Tool implementations
// Semantic search using CLIP embeddings - finds images by concept/meaning
async function semanticSearch(query, limit = 20, namespace) {
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
async function textSearch(query, options = {}) {
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
async function searchByColor(hexColor, limit = 20, namespace) {
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
async function findSimilar(imageId, type = 'clip', limit = 10, options = {}) {
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
async function listImages(options) {
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
async function getImage(imageId) {
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
async function getImageMetadata(imageId) {
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
async function uploadFromUrl(url, options = {}) {
    try {
        // Fetch the image
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
            return { success: false, error: `Failed to fetch image from URL: ${imageResponse.status}` };
        }
        const blob = await imageResponse.blob();
        const filename = url.split('/').pop() || 'uploaded-image';
        // Create form data
        const formData = new FormData();
        formData.append('file', blob, filename);
        if (options.folder)
            formData.append('folder', options.folder);
        if (options.tags)
            formData.append('tags', options.tags.join(','));
        if (options.namespace)
            formData.append('namespace', options.namespace);
        if (options.description)
            formData.append('description', options.description);
        formData.append('originalUrl', options.originalUrl || url);
        if (options.sourceUrl)
            formData.append('sourceUrl', options.sourceUrl);
        if (options.parentId)
            formData.append('parentId', options.parentId);
        const response = await fetch(`${BASE_URL}/api/upload/external`, {
            method: 'POST',
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
            return { success: false, error: result.error || 'Upload failed' };
        }
        return { success: true, imageId: result.id };
    }
    catch (error) {
        return { success: false, error: String(error) };
    }
}
async function listFolders(namespace) {
    const params = new URLSearchParams();
    if (namespace)
        params.set('namespace', namespace);
    const data = await apiRequest(`/api/folders?${params}`);
    return data.folders;
}
async function createFolder(name) {
    return apiRequest('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}
async function listNamespaces() {
    const data = await apiRequest('/api/namespaces');
    return data.namespaces;
}
async function updateMetadata(imageId, updates) {
    const data = await apiRequest(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
    return formatImageResult(data);
}
async function deleteImage(imageId) {
    return apiRequest(`/api/images/${imageId}`, {
        method: 'DELETE',
    });
}
async function findAntipode(imageId, options = {}) {
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
async function generateAlt(imageId) {
    const data = await apiRequest(`/api/images/${imageId}/alt`, {
        method: 'POST',
    });
    return data;
}
async function searchByImage(imageId, limit = 20, namespace) {
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
async function generateDescription(imageId, options = {}) {
    const data = await apiRequest(`/api/images/${imageId}/description`, {
        method: 'POST',
        body: options.existingDescription ? JSON.stringify({ existingDescription: options.existingDescription }) : undefined,
    });
    return data;
}
async function generatePrompt(imageId, options = {}) {
    const params = new URLSearchParams();
    if (options.force)
        params.set('force', '1');
    const query = params.toString();
    const data = await apiRequest(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
        method: 'POST',
        body: JSON.stringify({
            force: options.force,
            existingPrompt: options.existingPrompt,
        }),
    });
    return data;
}
async function getConcepts(imageId) {
    const data = await apiRequest(`/api/images/${imageId}/concepts`, {
        method: 'POST',
    });
    return data;
}
async function getVectorStatus() {
    return apiRequest('/api/images/vectors/status');
}
async function generateEmbeddings(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/embeddings`, {
        method: 'POST',
        body: JSON.stringify({
            clip: options.clip !== false,
            color: options.color !== false,
            force: options.force === true,
        }),
    });
}
async function getEmbeddingStatus(imageId) {
    return apiRequest(`/api/images/${imageId}/embeddings`);
}
async function batchGenerateEmbeddings(options) {
    return apiRequest('/api/images/embeddings/batch', {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
async function ensureVectorIndex() {
    return apiRequest('/api/images/vectors/status', { method: 'POST' });
}
async function getColorsBulk(imageIds) {
    const params = new URLSearchParams();
    params.set('ids', imageIds.join(','));
    const data = await apiRequest(`/api/images/colors?${params}`);
    return data.colors;
}
async function getPromptsBulk(imageIds) {
    const params = new URLSearchParams();
    params.set('ids', imageIds.join(','));
    const data = await apiRequest(`/api/images/prompts?${params}`);
    return data.prompts;
}
async function getPromptRecord(imageId) {
    return apiRequest(`/api/images/${imageId}/prompt`);
}
async function generatePromptRecord(imageId, options = {}) {
    const params = new URLSearchParams();
    if (options.force)
        params.set('force', '1');
    const query = params.toString();
    return apiRequest(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
        method: 'POST',
        body: JSON.stringify({
            force: options.force,
            existingPrompt: options.existingPrompt,
        }),
    });
}
async function getExtras(imageId) {
    return apiRequest(`/api/images/${imageId}/extras`);
}
async function updateExtras(imageId, updates) {
    return apiRequest(`/api/images/${imageId}/extras`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}
async function rotateImage(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/rotate`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
async function getHaiku(imageId) {
    return apiRequest(`/api/images/${imageId}/haiku`, { method: 'POST' });
}
async function listUploads(options = {}) {
    const params = new URLSearchParams();
    if (options.page !== undefined)
        params.set('page', String(options.page));
    if (options.pageSize !== undefined)
        params.set('pageSize', String(options.pageSize));
    if (options.folder)
        params.set('folder', options.folder);
    return apiRequest(`/api/uploads?${params}`);
}
async function downloadUpload(uploadId) {
    const response = await apiRequestRaw(`/api/uploads/${uploadId}/download`, { method: 'GET' });
    const contentType = response.headers.get('content-type') || undefined;
    const disposition = response.headers.get('content-disposition') || undefined;
    const sizeHeader = response.headers.get('content-length') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
    return {
        filename: filenameMatch?.[1],
        contentType,
        size: sizeHeader ? Number(sizeHeader) : undefined,
        base64,
    };
}
async function downloadImageById(imageId, variant) {
    const params = new URLSearchParams();
    if (variant)
        params.set('variant', variant);
    const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
    const contentType = response.headers.get('content-type') || undefined;
    const disposition = response.headers.get('content-disposition') || undefined;
    const sizeHeader = response.headers.get('content-length') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
    return {
        filename: filenameMatch?.[1],
        contentType,
        size: sizeHeader ? Number(sizeHeader) : undefined,
        base64,
    };
}
async function downloadOriginalImageById(imageId) {
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
function _tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function _extractFromMetadataMap(metadata, sourceLabel) {
    const workflowKeys = ['workflow', 'comfy_workflow', 'comfyui_workflow'];
    const promptKeys = ['prompt', 'comfy_prompt', 'parameters'];
    let workflow = null;
    for (const key of workflowKeys) {
        if (metadata[key]) {
            workflow = _tryParseJson(metadata[key]);
            if (workflow !== null)
                break;
        }
    }
    let prompt = null;
    for (const key of promptKeys) {
        if (metadata[key]) {
            prompt = _tryParseJson(metadata[key]);
            if (prompt !== null)
                break;
        }
    }
    if (!workflow || !prompt) {
        for (const value of Object.values(metadata)) {
            const parsed = _tryParseJson(value.trim());
            if (!parsed || typeof parsed !== 'object')
                continue;
            const obj = parsed;
            if (!workflow && obj.workflow !== undefined)
                workflow = obj.workflow;
            if (!prompt && obj.prompt !== undefined)
                prompt = obj.prompt;
            if (workflow && prompt)
                break;
        }
    }
    if (!workflow && !prompt) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: `No Comfy workflow/prompt JSON metadata found in ${sourceLabel}.`,
        };
    }
    return {
        found: true,
        workflow,
        prompt,
        rawMetadata: metadata,
    };
}
function _extractExifText(exifBuffer) {
    const out = {};
    if (exifBuffer.length < 14)
        return out;
    let tiffStart = 0;
    if (exifBuffer.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
        tiffStart = 6;
    }
    if (tiffStart + 8 > exifBuffer.length)
        return out;
    const endian = exifBuffer.toString('ascii', tiffStart, tiffStart + 2);
    const le = endian === 'II';
    if (!le && endian !== 'MM')
        return out;
    const u16 = (off) => (le ? exifBuffer.readUInt16LE(off) : exifBuffer.readUInt16BE(off));
    const u32 = (off) => (le ? exifBuffer.readUInt32LE(off) : exifBuffer.readUInt32BE(off));
    const firstIfdRel = u32(tiffStart + 4);
    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };
    const readIfd = (ifdRel, prefix = 'ifd') => {
        const ifdOff = tiffStart + ifdRel;
        if (ifdOff + 2 > exifBuffer.length)
            return;
        const count = u16(ifdOff);
        for (let i = 0; i < count; i += 1) {
            const entryOff = ifdOff + 2 + i * 12;
            if (entryOff + 12 > exifBuffer.length)
                break;
            const tag = u16(entryOff);
            const type = u16(entryOff + 2);
            const valueCount = u32(entryOff + 4);
            const valueOrOffset = u32(entryOff + 8);
            const unit = typeSizes[type] || 1;
            const byteLen = valueCount * unit;
            let raw;
            if (byteLen <= 4) {
                raw = exifBuffer.subarray(entryOff + 8, entryOff + 8 + byteLen);
            }
            else {
                const dataOff = tiffStart + valueOrOffset;
                if (dataOff + byteLen > exifBuffer.length)
                    continue;
                raw = exifBuffer.subarray(dataOff, dataOff + byteLen);
            }
            let decoded = null;
            if (type === 2) {
                decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
            }
            else if (type === 7 || type === 1) {
                if (tag === 0x9286 && raw.length > 8) {
                    const payload = raw.subarray(8);
                    decoded = payload.toString('utf8').replace(/\x00+$/g, '').trim();
                }
                else {
                    decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
                }
            }
            if (decoded) {
                out[`${prefix}_tag_${tag.toString(16)}`] = decoded;
                if (tag === 0x010e)
                    out.image_description = decoded;
                if (tag === 0x9286)
                    out.user_comment = decoded;
            }
            if (tag === 0x8769 && valueOrOffset > 0) {
                readIfd(valueOrOffset, `${prefix}_exif`);
            }
        }
    };
    if (firstIfdRel > 0)
        readIfd(firstIfdRel);
    return out;
}
function extractComfyMetadataFromJpeg(buffer) {
    const metadata = {};
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: 'Not a JPEG file.',
        };
    }
    let offset = 2;
    let commentIndex = 0;
    while (offset + 4 <= buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff)
            offset += 1;
        if (offset >= buffer.length)
            break;
        const marker = buffer[offset];
        offset += 1;
        if (marker === 0xd9 || marker === 0xda)
            break;
        if (offset + 2 > buffer.length)
            break;
        const len = buffer.readUInt16BE(offset);
        if (len < 2 || offset + len > buffer.length)
            break;
        const data = buffer.subarray(offset + 2, offset + len);
        if (marker === 0xe1) {
            if (data.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
                Object.assign(metadata, _extractExifText(data));
            }
            else if (data.subarray(0, 29).toString('ascii').startsWith('http://ns.adobe.com/xap/1.0/')) {
                const xmp = data.subarray(29).toString('utf8').replace(/\x00+$/g, '').trim();
                if (xmp)
                    metadata.xmp = xmp;
            }
        }
        else if (marker === 0xfe) {
            const txt = data.toString('utf8').replace(/\x00+$/g, '').trim();
            if (txt)
                metadata[`comment_${commentIndex++}`] = txt;
        }
        offset += len;
    }
    return _extractFromMetadataMap(metadata, 'JPEG metadata segments');
}
function extractComfyMetadataFromWebp(buffer) {
    const metadata = {};
    if (buffer.length < 12
        || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
        || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: 'Not a WebP file.',
        };
    }
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkType = buffer.subarray(offset, offset + 4).toString('ascii');
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataOff = offset + 8;
        const dataEnd = dataOff + chunkSize;
        if (dataEnd > buffer.length)
            break;
        const data = buffer.subarray(dataOff, dataEnd);
        if (chunkType === 'EXIF') {
            Object.assign(metadata, _extractExifText(data));
        }
        else if (chunkType === 'XMP ') {
            const xmp = data.toString('utf8').replace(/\x00+$/g, '').trim();
            if (xmp)
                metadata.xmp = xmp;
        }
        offset = dataEnd + (chunkSize % 2);
    }
    return _extractFromMetadataMap(metadata, 'WebP EXIF/XMP chunks');
}
function extractComfyMetadataFromPng(buffer) {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: {},
            message: 'Not a PNG file; Comfy workflow extraction currently supports PNG embedded metadata.',
        };
    }
    const metadata = {};
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        offset += 4;
        const chunkType = buffer.toString('ascii', offset, offset + 4);
        offset += 4;
        if (offset + length + 4 > buffer.length) {
            break;
        }
        const chunkData = buffer.subarray(offset, offset + length);
        offset += length;
        offset += 4; // crc
        if (chunkType === 'tEXt') {
            const sep = chunkData.indexOf(0);
            if (sep > 0) {
                const key = chunkData.subarray(0, sep).toString('utf8');
                const value = chunkData.subarray(sep + 1).toString('utf8');
                metadata[key] = value;
            }
        }
        else if (chunkType === 'zTXt') {
            const sep = chunkData.indexOf(0);
            if (sep > 0 && sep + 2 <= chunkData.length) {
                const key = chunkData.subarray(0, sep).toString('utf8');
                const compressed = chunkData.subarray(sep + 2);
                try {
                    metadata[key] = inflateSync(compressed).toString('utf8');
                }
                catch {
                    // ignore malformed chunk
                }
            }
        }
        else if (chunkType === 'iTXt') {
            const sep0 = chunkData.indexOf(0);
            if (sep0 > 0 && sep0 + 3 <= chunkData.length) {
                const key = chunkData.subarray(0, sep0).toString('utf8');
                const compressionFlag = chunkData[sep0 + 1];
                const afterFlag = sep0 + 3;
                const sep1 = chunkData.indexOf(0, afterFlag); // language
                if (sep1 >= 0) {
                    const sep2 = chunkData.indexOf(0, sep1 + 1); // translated keyword
                    if (sep2 >= 0) {
                        const textBytes = chunkData.subarray(sep2 + 1);
                        try {
                            metadata[key] = (compressionFlag === 1 ? inflateSync(textBytes) : textBytes).toString('utf8');
                        }
                        catch {
                            // ignore malformed chunk
                        }
                    }
                }
            }
        }
        if (chunkType === 'IEND') {
            break;
        }
    }
    return _extractFromMetadataMap(metadata, 'PNG text chunks');
}
function extractComfyMetadata(buffer, contentType, filename) {
    const lowerType = (contentType || '').toLowerCase();
    const lowerName = (filename || '').toLowerCase();
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
    const isWebp = buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (isPng || lowerType.includes('png') || lowerName.endsWith('.png')) {
        const result = extractComfyMetadataFromPng(buffer);
        return { ...result, format: 'png' };
    }
    if (isJpeg || lowerType.includes('jpeg') || lowerType.includes('jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
        const result = extractComfyMetadataFromJpeg(buffer);
        return { ...result, format: 'jpeg' };
    }
    if (isWebp || lowerType.includes('webp') || lowerName.endsWith('.webp')) {
        const result = extractComfyMetadataFromWebp(buffer);
        return { ...result, format: 'webp' };
    }
    return {
        found: false,
        workflow: null,
        prompt: null,
        rawMetadata: {},
        format: 'unknown',
        message: 'Unsupported artifact format for embedded workflow extraction. Supported: PNG, JPEG, WebP.',
    };
}
async function resolveSavePath(savePath, fallbackFilename) {
    const resolved = path.isAbsolute(savePath) ? savePath : path.resolve(process.cwd(), savePath);
    const endsWithSeparator = savePath.endsWith(path.sep) || savePath.endsWith('/');
    const hasExtension = Boolean(path.extname(resolved));
    if (endsWithSeparator || !hasExtension) {
        return path.join(resolved, fallbackFilename);
    }
    try {
        const stats = await fs.stat(resolved);
        if (stats.isDirectory()) {
            return path.join(resolved, fallbackFilename);
        }
    }
    catch {
        // path doesn't exist; treat as file path
    }
    return resolved;
}
async function saveBase64ToFile(base64, savePath, fallbackFilename) {
    const targetPath = await resolveSavePath(savePath, fallbackFilename);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(base64, 'base64'));
    return targetPath;
}
async function importFromUrl(url) {
    return apiRequest('/api/import', {
        method: 'POST',
        body: JSON.stringify({ url }),
    });
}
async function uploadFileBase64(endpoint, payload) {
    const { buffer, mimeType } = decodeBase64(payload.base64);
    const contentType = payload.contentType || mimeType || 'application/octet-stream';
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), payload.filename);
    if (payload.folder)
        formData.append('folder', payload.folder);
    if (payload.tags?.length)
        formData.append('tags', payload.tags.join(','));
    if (payload.description)
        formData.append('description', payload.description);
    if (payload.originalUrl)
        formData.append('originalUrl', payload.originalUrl);
    if (payload.sourceUrl)
        formData.append('sourceUrl', payload.sourceUrl);
    if (payload.sourcePath)
        formData.append('sourcePath', payload.sourcePath);
    if (payload.namespace)
        formData.append('namespace', payload.namespace);
    if (payload.parentId)
        formData.append('parentId', payload.parentId);
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result?.error || `Upload failed (${response.status})`);
    }
    return result;
}
async function createAnimation(options) {
    const items = [];
    const files = [];
    options.frames.forEach((frame) => {
        if (frame.kind === 'url') {
            items.push({ kind: 'url', url: frame.url });
        }
        else {
            const { buffer, mimeType } = decodeBase64(frame.data);
            const contentType = frame.contentType || mimeType || 'application/octet-stream';
            const fileIndex = files.length;
            files.push({ buffer, filename: frame.filename, contentType });
            items.push({ kind: 'file', fileIndex });
        }
    });
    const formData = new FormData();
    formData.append('items', JSON.stringify(items));
    if (options.fps !== undefined)
        formData.append('fps', String(options.fps));
    if (options.loop !== undefined)
        formData.append('loop', options.loop ? 'true' : 'false');
    if (options.folder)
        formData.append('folder', options.folder);
    if (options.tags?.length)
        formData.append('tags', options.tags.join(','));
    if (options.description)
        formData.append('description', options.description);
    if (options.originalUrl)
        formData.append('originalUrl', options.originalUrl);
    if (options.sourceUrl)
        formData.append('sourceUrl', options.sourceUrl);
    if (options.namespace)
        formData.append('namespace', options.namespace);
    if (options.parentId)
        formData.append('parentId', options.parentId);
    if (options.filename)
        formData.append('filename', options.filename);
    files.forEach((file) => {
        formData.append('files', new Blob([new Uint8Array(file.buffer)], { type: file.contentType || 'application/octet-stream' }), file.filename);
    });
    const response = await fetch(`${BASE_URL}/api/animate`, {
        method: 'POST',
        body: formData,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result?.error || `Animation upload failed (${response.status})`);
    }
    return result;
}
async function auditImages(options = {}) {
    const params = new URLSearchParams();
    if (options.refresh)
        params.set('refresh', '1');
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.offset !== undefined)
        params.set('offset', String(options.offset));
    if (options.concurrency !== undefined)
        params.set('concurrency', String(options.concurrency));
    if (options.variant)
        params.set('variant', options.variant);
    if (options.verbose)
        params.set('verbose', '1');
    return apiRequest(`/api/images/audit?${params}`);
}
async function swapImageParent(imageId, options) {
    return apiRequest(`/api/images/${imageId}/swap-parent`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
async function deleteImageFamily(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/delete-family`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
async function getDeleteFamilyJob(jobId) {
    return apiRequest(`/api/jobs/delete-family/${jobId}`);
}
async function getDebugRaw() {
    return apiRequest('/api/debug');
}
async function createBackup(options = {}) {
    return apiRequest('/api/backup', {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
async function listBackups() {
    return apiRequest('/api/backup');
}
// Helpers
function formatImageResult(img) {
    const canonicalId = String(img.id
        || img.imageId
        || img.canonicalImageId
        || '').trim();
    // Handle both array and object variants
    let publicUrl = '';
    if (Array.isArray(img.variants)) {
        publicUrl = img.variants.find((v) => v.includes('/public')) || img.variants[0] || '';
    }
    else if (img.variants && typeof img.variants === 'object') {
        publicUrl = img.variants.public || Object.values(img.variants)[0] || '';
    }
    return {
        id: canonicalId,
        imageId: canonicalId || undefined,
        canonicalImageId: canonicalId || undefined,
        requestedImageId: img.requestedImageId,
        filename: img.filename,
        url: publicUrl || img.url,
        variants: img.variants,
        folder: img.folder || img.meta?.folder,
        tags: img.tags || img.meta?.tags,
        description: img.description || img.meta?.description,
        altTag: img.altTag || img.meta?.altTag,
        namespace: img.namespace,
        parentId: img.parentId,
        originalUrl: img.originalUrl,
        sourceUrl: img.sourceUrl,
        hasClipEmbedding: img.hasClipEmbedding,
        hasColorEmbedding: img.hasColorEmbedding,
        dominantColors: img.dominantColors,
        averageColor: img.averageColor,
        aspectRatio: img.aspectRatio,
        dimensions: img.dimensions,
        score: img.score,
    };
}
function formatImageSummary(img) {
    const parts = [`ID: ${img.id}`];
    if (img.filename)
        parts.push(`File: ${img.filename}`);
    if (img.folder || img.meta?.folder)
        parts.push(`Folder: ${img.folder || img.meta?.folder}`);
    if (img.description || img.meta?.description) {
        const desc = img.description || img.meta?.description || '';
        parts.push(`Desc: ${desc.slice(0, 100)}${desc.length > 100 ? '...' : ''}`);
    }
    if (img.tags?.length || img.meta?.tags?.length) {
        parts.push(`Tags: ${(img.tags || img.meta?.tags || []).join(', ')}`);
    }
    if (img.score !== undefined)
        parts.push(`Score: ${img.score.toFixed(3)}`);
    return parts.join(' | ');
}
function buildShareUrl(imageId, variant) {
    const params = new URLSearchParams();
    if (variant)
        params.set('variant', variant);
    return `${BASE_URL}/api/images/${imageId}/share${params.toString() ? `?${params}` : ''}`;
}
// Tool definitions
const TOOLS = [
    {
        name: 'list_tools',
        description: 'Return tool definitions for this MCP server.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    // ===== Discovery & Search =====
    {
        name: 'photarium_search',
        description: 'Semantic search for images using natural language and CLIP embeddings. Finds images by concept, subject, mood, or visual characteristics. Best for finding images that "look like" or "feel like" the query, even if they don\'t contain exact matching text.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Natural language search query (e.g., "sunset over mountains", "minimalist product photography", "vibe coding illustration")',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20, max: 100)',
                },
                namespace: {
                    type: ['string', 'null'],
                    description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'photarium_search_text',
        description: 'Traditional text search that matches against image metadata: filename, folder name, tags, description, and alt text. Use this when looking for specific files by name or when you know the exact tags/folder.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Text to search for in filenames, folders, tags, descriptions (e.g., "hero", "landing-page", "blog-posts")',
                },
                folder: {
                    type: 'string',
                    description: 'Optional: limit search to a specific folder',
                },
                namespace: {
                    type: 'string',
                    description: 'Optional: limit search to a specific namespace',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 50)',
                },
                refresh: {
                    type: 'boolean',
                    description: 'If true, refresh the Cloudflare cache before searching',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'photarium_search_color',
        description: 'Search for images by dominant color. Finds images that prominently feature the specified color in their palette. Uses color embeddings for accurate color matching.',
        inputSchema: {
            type: 'object',
            properties: {
                color: {
                    type: 'string',
                    description: 'Hex color code (e.g., "#3B82F6", "FF5733", "red"). Common colors: #FF0000 (red), #00FF00 (green), #0000FF (blue), #FFFF00 (yellow), #FFA500 (orange), #800080 (purple)',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20, max: 100)',
                },
                namespace: {
                    type: ['string', 'null'],
                    description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
                },
            },
            required: ['color'],
        },
    },
    {
        name: 'photarium_search_image',
        description: 'Search for images similar to a given image using its CLIP embedding. Useful for quickly finding look-alike images without specifying a text query.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the source image to search from',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20, max: 100)',
                },
                namespace: {
                    type: ['string', 'null'],
                    description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_similar',
        description: 'Find images visually similar to a given image. Can search by visual/semantic similarity (CLIP) or color palette similarity.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the source image to find similar images for',
                },
                type: {
                    type: 'string',
                    enum: ['clip', 'color'],
                    description: 'Search type: "clip" for semantic/visual similarity, "color" for color palette similarity (default: clip)',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 10, max: 50)',
                },
                includeStrangers: {
                    type: 'boolean',
                    description: 'If true, also return semantically distant images (CLIP-only)',
                },
                offset: {
                    type: 'number',
                    description: 'Offset for similar results (default: 0)',
                },
                strangersLimit: {
                    type: 'number',
                    description: 'Maximum strangers to return (default: limit/2)',
                },
                strangersOffset: {
                    type: 'number',
                    description: 'Offset for strangers results (default: 0)',
                },
                namespace: {
                    type: ['string', 'null'],
                    description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_antipode',
        description: 'Find images that are semantic or color opposites of a given image. Useful for finding contrasting images or exploring the opposite end of the visual spectrum.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the source image',
                },
                domain: {
                    type: 'string',
                    enum: ['clip', 'color'],
                    description: 'Search domain: "clip" for semantic opposites, "color" for color opposites (default: clip)',
                },
                method: {
                    type: 'string',
                    description: 'Search method. CLIP: "negate", "stranger", "otherwise", "reflectroid". Color: "complementary", "histogram", "lightness", "negative"',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 8, max: 20)',
                },
                namespace: {
                    type: ['string', 'null'],
                    description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_list',
        description: 'List images from the gallery with optional filtering by folder or namespace. Returns a paginated list of images.',
        inputSchema: {
            type: 'object',
            properties: {
                folder: {
                    type: 'string',
                    description: 'Filter by folder name',
                },
                namespace: {
                    type: 'string',
                    description: 'Filter by namespace (use "__all__" for all namespaces, "__none__" for images without namespace)',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 50)',
                },
                refresh: {
                    type: 'boolean',
                    description: 'If true, refresh the Cloudflare cache before listing',
                },
                aspectRatioClass: {
                    type: 'string',
                    description: 'Filter by aspect ratio class: square, horizontal, or vertical',
                },
                aspectRatio: {
                    type: 'string',
                    description: 'Filter by a specific aspect ratio label (e.g., "4:3", "16:9")',
                },
            },
        },
    },
    {
        name: 'photarium_get',
        description: 'Get detailed information about a specific image by its ID, including full metadata, folder/tags, aspect ratio/dimensions, file size/type, and variant URLs.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to retrieve',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_image_metadata',
        description: 'Get normalized metadata for a specific image by ID, including folder, tags, uploaded date, variant/family info, description, alt description, prompt, and dimensions.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to inspect',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_download_image',
        description: 'Download an image by ID and return base64 data plus metadata. Useful for piping into ComfyUI or other tools.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to download',
                },
                variant: {
                    type: 'string',
                    description: 'Optional variant (public, full, small, etc.)',
                },
                savePath: {
                    type: 'string',
                    description: 'Optional path to save the file locally (relative to MCP server working directory or absolute). If a directory, the filename from headers or imageId is used.',
                },
                includeBase64: {
                    type: 'boolean',
                    description: 'If false and savePath is provided, omit base64 from the response (default: true).',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_download_original',
        description: 'Download the original uploaded artifact bytes for an image ID (preferred when you need embedded metadata like Comfy workflow data).',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to download',
                },
                savePath: {
                    type: 'string',
                    description: 'Optional path to save the file locally (relative or absolute). If directory-like, the original filename is used.',
                },
                includeBase64: {
                    type: 'boolean',
                    description: 'If false and savePath is provided, omit base64 from the response (default: true).',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_extract_workflow',
        description: 'Download the original image artifact and extract embedded Comfy workflow/prompt metadata (currently PNG text-chunk extraction).',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to inspect for embedded workflow metadata',
                },
                includeRawMetadata: {
                    type: 'boolean',
                    description: 'If true, include all extracted PNG text metadata in the response (default: false).',
                },
            },
            required: ['imageId'],
        },
    },
    // ===== Organization =====
    {
        name: 'photarium_list_folders',
        description: 'List all available folders in the gallery, optionally filtered by namespace.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: {
                    type: 'string',
                    description: 'Filter folders by namespace',
                },
            },
        },
    },
    {
        name: 'photarium_create_folder',
        description: 'Create a new folder in the gallery for organizing images.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the folder to create',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'photarium_list_namespaces',
        description: 'List all registered namespaces. Namespaces allow multi-tenant image organization.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_update_metadata',
        description: 'Update metadata for an image including folder, tags, description, alt text, and namespace. Can also set parent-child relationships for image variants.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to update',
                },
                folder: {
                    type: 'string',
                    description: 'Move image to this folder',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Replace tags with this array',
                },
                description: {
                    type: ['string', 'null'],
                    description: 'Set description (use null to clear)',
                },
                displayName: {
                    type: ['string', 'null'],
                    description: 'Set display name (use null or empty to clear)',
                },
                altTag: {
                    type: 'string',
                    description: 'Set accessibility alt text',
                },
                originalUrl: {
                    type: ['string', 'null'],
                    description: 'Set the original source URL (use null or empty to clear)',
                },
                sourceUrl: {
                    type: ['string', 'null'],
                    description: 'Set the page/source URL (use null or empty to clear)',
                },
                namespace: {
                    type: 'string',
                    description: 'Move image to this namespace',
                },
                parentId: {
                    type: 'string',
                    description: 'Set as variant of another image (parent ID)',
                },
                variationSort: {
                    type: 'number',
                    description: 'Set ordering value for variants within a family',
                },
                clearExif: {
                    type: 'boolean',
                    description: 'If true, remove stored EXIF metadata',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_extras_get',
        description: 'Get additional image extras (stored outside Cloudflare metadata), such as custom descriptions or alt text overrides.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to retrieve extras for',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_extras_update',
        description: 'Update image extras (stored outside Cloudflare metadata). Set description/altText to null to clear.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to update',
                },
                description: {
                    type: ['string', 'null'],
                    description: 'Override description (null clears)',
                },
                altText: {
                    type: ['string', 'null'],
                    description: 'Override alt text (null clears)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_swap_parent',
        description: 'Swap the parent image for a family of variants. New parent must be in the same family.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'Any image ID in the family (the requested target)',
                },
                newParentId: {
                    type: 'string',
                    description: 'The image ID that should become the new parent',
                },
                concurrency: {
                    type: 'number',
                    description: 'Max concurrent Cloudflare updates (default: 3, max: 8)',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, returns planned updates without applying changes',
                },
            },
            required: ['imageId', 'newParentId'],
        },
    },
    {
        name: 'photarium_delete_family',
        description: 'Delete an image family (parent + variants). Can run async and returns a jobId for polling.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'Image ID belonging to the family to delete',
                },
                confirm: {
                    type: 'string',
                    description: 'Required unless dryRun=true. Must be "DELETE_FAMILY"',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, returns which IDs would be deleted without deleting',
                },
                concurrency: {
                    type: 'number',
                    description: 'Max concurrent Cloudflare deletes (default: 3, max: 8)',
                },
                async: {
                    type: 'boolean',
                    description: 'If true, run in background and return a jobId',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_delete_family_job',
        description: 'Fetch status for an async delete-family job by jobId.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: {
                    type: 'string',
                    description: 'Job ID returned from photarium_delete_family with async=true',
                },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'photarium_share_url',
        description: 'Get a share URL for an image and variant size (redirect endpoint).',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The image ID to share',
                },
                variant: {
                    type: 'string',
                    description: 'Variant to use (e.g., public, thumbnail, small, medium, large, xlarge)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_rotate',
        description: 'Rotate an image server-side and re-upload it as a new Cloudflare image.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The image ID to rotate',
                },
                direction: {
                    type: 'string',
                    enum: ['left', 'right'],
                    description: 'Rotate 90° left or right',
                },
                degrees: {
                    type: 'number',
                    description: 'Custom rotation degrees (overrides direction)',
                },
                auto: {
                    type: 'boolean',
                    description: 'If true, auto-rotate based on EXIF orientation',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_delete',
        description: 'Delete an image from the gallery. This action is permanent and cannot be undone.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to delete',
                },
            },
            required: ['imageId'],
        },
    },
    // ===== Upload =====
    {
        name: 'photarium_upload_url',
        description: 'Upload an image to the gallery from a URL. The image will be downloaded and stored in Cloudflare Images.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL of the image to upload',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply to the image',
                },
                description: {
                    type: 'string',
                    description: 'Optional description for the image',
                },
                originalUrl: {
                    type: 'string',
                    description: 'Original URL for duplicate detection',
                },
                sourceUrl: {
                    type: 'string',
                    description: 'Source page URL for provenance',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
                parentId: {
                    type: 'string',
                    description: 'Optional parent image ID to set variant relationship',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'photarium_import_url',
        description: 'Import a remote image URL and return base64 data + metadata for client-side upload workflows.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL of the image to import',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'photarium_upload_file',
        description: 'Upload a file (base64) to the internal upload endpoint. Supports zip/keynote bundles and metadata fields.',
        inputSchema: {
            type: 'object',
            properties: {
                base64: {
                    type: 'string',
                    description: 'Base64-encoded file data (optionally a data URL)',
                },
                filename: {
                    type: 'string',
                    description: 'Filename for the upload (e.g., "image.png" or "bundle.zip")',
                },
                contentType: {
                    type: 'string',
                    description: 'Optional MIME type override (e.g., image/png)',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply',
                },
                description: {
                    type: 'string',
                    description: 'Description to store with the image',
                },
                originalUrl: {
                    type: 'string',
                    description: 'Original URL for duplicate detection',
                },
                sourceUrl: {
                    type: 'string',
                    description: 'Source page URL for provenance',
                },
                sourcePath: {
                    type: 'string',
                    description: 'Optional source path for Keynote archives',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
                parentId: {
                    type: 'string',
                    description: 'Optional parent image ID to set variant relationship',
                },
            },
            required: ['base64', 'filename'],
        },
    },
    {
        name: 'photarium_upload_image',
        description: 'Convenience upload for base64 image data (defaults to external upload API).',
        inputSchema: {
            type: 'object',
            properties: {
                base64: {
                    type: 'string',
                    description: 'Base64-encoded image data (optionally a data URL)',
                },
                filename: {
                    type: 'string',
                    description: 'Filename for the upload (e.g., "image.png")',
                },
                contentType: {
                    type: 'string',
                    description: 'Optional MIME type override (e.g., image/png)',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply',
                },
                description: {
                    type: 'string',
                    description: 'Description to store with the image',
                },
                originalUrl: {
                    type: 'string',
                    description: 'Original URL for duplicate detection',
                },
                sourceUrl: {
                    type: 'string',
                    description: 'Source page URL for provenance',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
                parentId: {
                    type: 'string',
                    description: 'Optional parent image ID to set variant relationship',
                },
                useExternalApi: {
                    type: 'boolean',
                    description: 'If true (default), use /api/upload/external; if false, use /api/upload',
                },
            },
            required: ['base64', 'filename'],
        },
    },
    {
        name: 'photarium_upload_external_file',
        description: 'Upload a file (base64) to the external upload endpoint. Intended for lightweight external tools.',
        inputSchema: {
            type: 'object',
            properties: {
                base64: {
                    type: 'string',
                    description: 'Base64-encoded image data (optionally a data URL)',
                },
                filename: {
                    type: 'string',
                    description: 'Filename for the upload (e.g., "image.png")',
                },
                contentType: {
                    type: 'string',
                    description: 'Optional MIME type override (e.g., image/png)',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply',
                },
                description: {
                    type: 'string',
                    description: 'Description to store with the image',
                },
                originalUrl: {
                    type: 'string',
                    description: 'Original URL for duplicate detection',
                },
                sourceUrl: {
                    type: 'string',
                    description: 'Source page URL for provenance',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
                parentId: {
                    type: 'string',
                    description: 'Optional parent image ID to set variant relationship',
                },
            },
            required: ['base64', 'filename'],
        },
    },
    {
        name: 'photarium_upload_from_path',
        description: 'Upload a file directly from a file path using multipart form data. No base64 encoding needed. Fast and efficient for local files.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute file path to the image file (e.g., /Users/username/Desktop/image.png)',
                },
                filename: {
                    type: 'string',
                    description: 'Optional filename override. If not provided, uses the filename from the path.',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply',
                },
                description: {
                    type: 'string',
                    description: 'Description to store with the image',
                },
                originalUrl: {
                    type: 'string',
                    description: 'Original URL for duplicate detection',
                },
                sourceUrl: {
                    type: 'string',
                    description: 'Source page URL for provenance',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
                parentId: {
                    type: 'string',
                    description: 'Optional parent image ID to set variant relationship',
                },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'photarium_animate',
        description: 'Create an animated WebP from a sequence of frames (URLs or base64). Uploads the result to Cloudflare Images.',
        inputSchema: {
            type: 'object',
            properties: {
                frames: {
                    type: 'array',
                    description: 'Array of frames to animate',
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: ['url', 'base64'] },
                            url: { type: 'string' },
                            data: { type: 'string', description: 'Base64 data for base64 frames (optionally a data URL)' },
                            filename: { type: 'string', description: 'Filename for base64 frames' },
                            contentType: { type: 'string', description: 'Optional MIME type for base64 frames' },
                        },
                        required: ['kind'],
                    },
                },
                fps: { type: 'number', description: 'Frames per second (default: 1)' },
                loop: { type: 'boolean', description: 'Whether the animation should loop (default: true)' },
                folder: { type: 'string', description: 'Folder to organize the image in' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' },
                description: { type: 'string', description: 'Description to store with the animation' },
                originalUrl: { type: 'string', description: 'Original URL for provenance' },
                sourceUrl: { type: 'string', description: 'Source page URL' },
                namespace: { type: 'string', description: 'Namespace to store the animation in' },
                parentId: { type: 'string', description: 'Optional parent image ID' },
                filename: { type: 'string', description: 'Optional filename for the resulting animation' },
            },
            required: ['frames'],
        },
    },
    {
        name: 'photarium_uploads_list',
        description: 'List paginated uploads with canonical Cloudflare URLs and metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'number', description: 'Page number (default: 1)' },
                pageSize: { type: 'number', description: 'Page size (default: 50)' },
                folder: { type: 'string', description: 'Optional folder filter' },
            },
        },
    },
    {
        name: 'photarium_upload_download',
        description: 'Download an upload by ID and return base64 data + metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                uploadId: { type: 'string', description: 'Upload ID to download' },
            },
            required: ['uploadId'],
        },
    },
    // ===== AI Features =====
    {
        name: 'photarium_generate_alt',
        description: 'Generate accessibility alt text for an image using AI vision. The alt text is saved to the image metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to generate alt text for',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_generate_description',
        description: 'Generate a detailed description of an image using AI vision. The description is saved to the image metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to describe',
                },
                existingDescription: {
                    type: 'string',
                    description: 'Optional existing description to provide additional context',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_generate_prompt',
        description: 'Generate a text-to-image prompt that could recreate the given image. Useful for understanding visual style and for prompt engineering.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to analyze',
                },
                force: {
                    type: 'boolean',
                    description: 'If true, regenerate prompt even if one exists',
                },
                existingPrompt: {
                    type: 'string',
                    description: 'Optional existing prompt draft to refine',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_prompt_get',
        description: 'Get the stored PromptThis record (if any) for an image.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to fetch prompt data for',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_prompts_bulk',
        description: 'Fetch stored prompts for multiple images in a single request.',
        inputSchema: {
            type: 'object',
            properties: {
                imageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image IDs to fetch prompts for',
                },
            },
            required: ['imageIds'],
        },
    },
    {
        name: 'photarium_concepts',
        description: 'Get semantic concept scores for an image, showing how the AI interprets its visual qualities along dimensions like warm/cold, minimal/complex, playful/serious, etc.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to analyze',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_haiku',
        description: 'Generate a haiku inspired by the image’s semantic qualities (CLIP embedding).',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to generate a haiku for',
                },
            },
            required: ['imageId'],
        },
    },
    // ===== System =====
    {
        name: 'photarium_vector_status',
        description: 'Check the status of the vector search system, including Redis availability, embedding progress, and index statistics.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_vector_index',
        description: 'Ensure the vector index exists (creates if missing).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_generate_embeddings',
        description: 'Generate CLIP and/or color embeddings for an image, enabling it to be found via semantic search.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to generate embeddings for',
                },
                clip: {
                    type: 'boolean',
                    description: 'Generate CLIP embedding for semantic search (default: true)',
                },
                color: {
                    type: 'boolean',
                    description: 'Generate color embedding for color search (default: true)',
                },
                force: {
                    type: 'boolean',
                    description: 'Regenerate even if embeddings already exist (default: false)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_embedding_status',
        description: 'Get embedding status (CLIP/color) for a specific image.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to check',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_embeddings_batch',
        description: 'Generate embeddings for multiple images in a single batch request.',
        inputSchema: {
            type: 'object',
            properties: {
                imageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image IDs to process',
                },
                clip: {
                    type: 'boolean',
                    description: 'Generate CLIP embeddings (default: true)',
                },
                color: {
                    type: 'boolean',
                    description: 'Generate color embeddings (default: true)',
                },
                force: {
                    type: 'boolean',
                    description: 'Regenerate even if embeddings already exist',
                },
            },
            required: ['imageIds'],
        },
    },
    {
        name: 'photarium_colors_bulk',
        description: 'Fetch color metadata (dominant colors, average color) for multiple images.',
        inputSchema: {
            type: 'object',
            properties: {
                imageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image IDs',
                },
            },
            required: ['imageIds'],
        },
    },
    {
        name: 'photarium_audit',
        description: 'Audit CDN URLs and report broken or failing image variants.',
        inputSchema: {
            type: 'object',
            properties: {
                refresh: { type: 'boolean', description: 'Refresh cache before auditing' },
                limit: { type: 'number', description: 'Number of images to check (0 = all)' },
                offset: { type: 'number', description: 'Offset into the image list' },
                concurrency: { type: 'number', description: 'Number of concurrent checks (default: 8)' },
                variant: { type: 'string', description: 'Variant to check (default: public)' },
                verbose: { type: 'boolean', description: 'Include all checks in results' },
            },
        },
    },
    {
        name: 'photarium_backup',
        description: 'Trigger a Redis database backup. Creates both an RDB snapshot and a compressed bundle with AOF files. Automatically rotates old backups.',
        inputSchema: {
            type: 'object',
            properties: {
                keepCount: {
                    type: 'number',
                    description: 'Number of backups to retain (default: 10)',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, show what would be done without actually backing up (default: false)',
                },
            },
        },
    },
    {
        name: 'photarium_list_backups',
        description: 'List existing Redis backups with their timestamps, sizes, and types (RDB snapshots and compressed bundles).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_debug_raw',
        description: 'Fetch raw Cloudflare Images API data for debugging.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
// Server setup
const server = new Server({
    name: 'photarium-mcp-server',
    version: '0.3.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));
async function handleToolCall(name, args = {}) {
    try {
        switch (name) {
            case 'list_tools': {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ tools: TOOLS }, null, 2),
                        },
                    ],
                };
            }
            // ===== Discovery & Search =====
            case 'photarium_search': {
                const { query, limit, namespace } = args;
                const result = await semanticSearch(query, limit, namespace);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_search_text': {
                const { query, folder, namespace, limit, refresh } = args;
                const result = await textSearch(query, { folder, namespace, limit, refresh });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_search_color': {
                const { color, limit, namespace } = args;
                const result = await searchByColor(color, limit, namespace);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_search_image': {
                const { imageId, limit, namespace } = args;
                const result = await searchByImage(imageId, limit, namespace);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_similar': {
                const { imageId, type, limit, includeStrangers, offset, strangersLimit, strangersOffset, namespace } = args;
                const result = await findSimilar(imageId, type, limit, {
                    includeStrangers,
                    offset,
                    strangersLimit,
                    strangersOffset,
                    namespace,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_antipode': {
                const { imageId, domain, method, limit, namespace } = args;
                const result = await findAntipode(imageId, { domain, method, limit, namespace });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_list': {
                const { folder, namespace, limit, refresh, aspectRatioClass, aspectRatio } = args;
                const result = await listImages({ folder, namespace, limit, refresh, aspectRatioClass, aspectRatio });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_get': {
                const { imageId } = args;
                const result = await getImage(imageId);
                if (!result) {
                    return {
                        content: [{ type: 'text', text: 'Image not found' }],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_image_metadata': {
                const { imageId } = args;
                const result = await getImageMetadata(imageId);
                if (!result) {
                    return {
                        content: [{ type: 'text', text: 'Image not found' }],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_download_image': {
                const { imageId, variant, savePath, includeBase64 } = args;
                const result = await downloadImageById(imageId, variant);
                let savedPath;
                if (savePath) {
                    const fallbackFilename = result.filename || `${imageId}${variant ? `_${variant}` : ''}.bin`;
                    savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
                }
                const response = includeBase64 === false && savePath
                    ? { ...result, base64: undefined, savedPath }
                    : { ...result, savedPath };
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(response, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_download_original': {
                const { imageId, savePath, includeBase64 } = args;
                const result = await downloadOriginalImageById(imageId);
                let savedPath;
                if (savePath) {
                    const fallbackFilename = result.filename || `${imageId}_original.bin`;
                    savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
                }
                const response = includeBase64 === false && savePath
                    ? { ...result, base64: undefined, savedPath }
                    : { ...result, savedPath };
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(response, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_extract_workflow': {
                const { imageId, includeRawMetadata } = args;
                const download = await downloadOriginalImageById(imageId);
                const decoded = Buffer.from(download.base64, 'base64');
                const extracted = extractComfyMetadata(decoded, download.contentType, download.filename);
                const response = {
                    imageId,
                    format: extracted.format,
                    contentType: download.contentType || null,
                    size: download.size || decoded.length,
                    filename: download.filename || null,
                    variantUsed: download.variantUsed,
                    fallbackUsed: download.fallbackUsed,
                    fallbackReason: download.fallbackReason || null,
                    extracted: extracted.found,
                    workflow: extracted.workflow,
                    prompt: extracted.prompt,
                    message: extracted.message || null,
                };
                if (includeRawMetadata) {
                    response.rawMetadata = extracted.rawMetadata;
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(response, null, 2),
                        },
                    ],
                };
            }
            // ===== Organization =====
            case 'photarium_list_folders': {
                const { namespace } = args;
                const folders = await listFolders(namespace);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ folders }, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_create_folder': {
                const { name } = args;
                const result = await createFolder(name);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_list_namespaces': {
                const namespaces = await listNamespaces();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ namespaces }, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_update_metadata': {
                const { imageId, folder, tags, description, displayName, altTag, originalUrl, sourceUrl, namespace, parentId, variationSort, clearExif } = args;
                const result = await updateMetadata(imageId, {
                    folder,
                    tags,
                    description,
                    displayName,
                    altTag,
                    originalUrl,
                    sourceUrl,
                    namespace,
                    parentId,
                    variationSort,
                    clearExif,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_extras_get': {
                const { imageId } = args;
                const result = await getExtras(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_extras_update': {
                const { imageId, description, altText } = args;
                const result = await updateExtras(imageId, { description, altText });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_swap_parent': {
                const { imageId, newParentId, concurrency, dryRun } = args;
                const result = await swapImageParent(imageId, { newParentId, concurrency, dryRun });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_delete_family': {
                const { imageId, confirm, dryRun, concurrency, async } = args;
                const result = await deleteImageFamily(imageId, { confirm, dryRun, concurrency, async });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_delete_family_job': {
                const { jobId } = args;
                const result = await getDeleteFamilyJob(jobId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_share_url': {
                const { imageId, variant } = args;
                const result = { imageId, variant: variant || 'large', url: buildShareUrl(imageId, variant) };
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_rotate': {
                const { imageId, direction, degrees, auto } = args;
                const result = await rotateImage(imageId, { direction, degrees, auto });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_delete': {
                const { imageId } = args;
                const result = await deleteImage(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // ===== Upload =====
            case 'photarium_upload_url': {
                const { url, folder, tags, namespace, description, originalUrl, sourceUrl, parentId } = args;
                const result = await uploadFromUrl(url, { folder, tags, namespace, description, originalUrl, sourceUrl, parentId });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_import_url': {
                const { url } = args;
                const result = await importFromUrl(url);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_file': {
                const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, sourcePath, namespace, parentId } = args;
                const result = await uploadFileBase64('/api/upload', {
                    base64,
                    filename,
                    contentType,
                    folder,
                    tags,
                    description,
                    originalUrl,
                    sourceUrl,
                    sourcePath,
                    namespace,
                    parentId,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_image': {
                const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, useExternalApi } = args;
                const endpoint = useExternalApi === false ? '/api/upload' : '/api/upload/external';
                const result = await uploadFileBase64(endpoint, {
                    base64,
                    filename,
                    contentType,
                    folder,
                    tags,
                    description,
                    originalUrl,
                    sourceUrl,
                    namespace,
                    parentId,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_external_file': {
                const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, namespace, parentId } = args;
                const result = await uploadFileBase64('/api/upload/external', {
                    base64,
                    filename,
                    contentType,
                    folder,
                    tags,
                    description,
                    originalUrl,
                    sourceUrl,
                    namespace,
                    parentId,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_from_path': {
                const { filePath, filename, folder, tags, description, originalUrl, sourceUrl, namespace, parentId } = args;
                try {
                    const { readFileSync } = await import('node:fs');
                    const fileBuffer = readFileSync(filePath);
                    const finalFilename = filename || filePath.split('/').pop() || 'upload.bin';
                    // Determine MIME type from extension
                    const ext = finalFilename.split('.').pop()?.toLowerCase() || '';
                    const mimeMap = {
                        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
                        bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
                        avif: 'image/avif',
                    };
                    const mimeType = mimeMap[ext] || 'application/octet-stream';
                    const form = new FormData();
                    form.append('file', new Blob([fileBuffer], { type: mimeType }), finalFilename);
                    if (folder)
                        form.append('folder', folder);
                    if (description)
                        form.append('description', description);
                    if (originalUrl)
                        form.append('originalUrl', originalUrl);
                    if (sourceUrl)
                        form.append('sourceUrl', sourceUrl);
                    if (namespace)
                        form.append('namespace', namespace);
                    if (parentId)
                        form.append('parentId', parentId);
                    if (tags && tags.length > 0) {
                        tags.forEach((tag) => form.append('tags', tag));
                    }
                    const response = await fetch(`${BASE_URL}/api/upload`, {
                        method: 'POST',
                        body: form,
                    });
                    const result = await response.json();
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                }
                catch (err) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error uploading from path: ${err instanceof Error ? err.message : String(err)}`,
                            },
                        ],
                        isError: true,
                    };
                }
            }
            case 'photarium_animate': {
                const { frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename } = args;
                const result = await createAnimation({ frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_uploads_list': {
                const { page, pageSize, folder } = args;
                const result = await listUploads({ page, pageSize, folder });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_download': {
                const { uploadId } = args;
                const result = await downloadUpload(uploadId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // ===== AI Features =====
            case 'photarium_generate_alt': {
                const { imageId } = args;
                const result = await generateAlt(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_generate_description': {
                const { imageId, existingDescription } = args;
                const result = await generateDescription(imageId, { existingDescription });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_generate_prompt': {
                const { imageId, force, existingPrompt } = args;
                const result = await generatePrompt(imageId, { force, existingPrompt });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_prompt_get': {
                const { imageId } = args;
                const result = await getPromptRecord(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_prompts_bulk': {
                const { imageIds } = args;
                const result = await getPromptsBulk(imageIds);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ prompts: result }, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_concepts': {
                const { imageId } = args;
                const result = await getConcepts(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_haiku': {
                const { imageId } = args;
                const result = await getHaiku(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            // ===== System =====
            case 'photarium_vector_status': {
                const result = await getVectorStatus();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_vector_index': {
                const result = await ensureVectorIndex();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_generate_embeddings': {
                const { imageId, clip, color, force } = args;
                const result = await generateEmbeddings(imageId, { clip, color, force });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_embedding_status': {
                const { imageId } = args;
                const result = await getEmbeddingStatus(imageId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_embeddings_batch': {
                const { imageIds, clip, color, force } = args;
                const result = await batchGenerateEmbeddings({ imageIds, clip, color, force });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_colors_bulk': {
                const { imageIds } = args;
                const result = await getColorsBulk(imageIds);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ colors: result }, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_audit': {
                const { refresh, limit, offset, concurrency, variant, verbose } = args;
                const result = await auditImages({ refresh, limit, offset, concurrency, variant, verbose });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_backup': {
                const { keepCount, dryRun } = args;
                const result = await createBackup({ keepCount, dryRun });
                // Format a nice summary for the LLM
                let summary = '';
                if (result.dryRun) {
                    summary = `[DRY RUN] Would create:\n- RDB: ${result.wouldCreate?.rdb}\n- Bundle: ${result.wouldCreate?.bundle}`;
                }
                else if (result.success && result.backup) {
                    summary = `✓ Backup completed successfully!\n\n`;
                    summary += `RDB Snapshot: ${result.backup.rdb.filename} (${result.backup.rdb.sizeHuman})\n`;
                    summary += `Bundle: ${result.backup.bundle.filename} (${result.backup.bundle.sizeHuman})`;
                    if (!result.backup.bundle.includesAof) {
                        summary += ` [RDB only, no AOF]`;
                    }
                    summary += `\n\nTimestamp: ${result.timestamp}\n\nSteps:\n${result.steps?.map(s => `  - ${s}`).join('\n')}`;
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary || JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_list_backups': {
                const result = await listBackups();
                // Format a nice summary
                let summary = `📦 Redis Backups (${result.count} backup sets)\n`;
                summary += `Directory: ${result.backupDir}\n`;
                summary += `Retention: ${result.keepCount} backups\n\n`;
                if (result.count === 0) {
                    summary += 'No backups found.';
                }
                else {
                    const timestamps = Object.keys(result.grouped).sort().reverse();
                    for (const ts of timestamps) {
                        const group = result.grouped[ts];
                        const date = ts.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
                        summary += `📁 ${date}\n`;
                        if (group.rdb) {
                            summary += `   RDB: ${group.rdb.sizeHuman}\n`;
                        }
                        if (group.bundle) {
                            summary += `   Bundle: ${group.bundle.sizeHuman}\n`;
                        }
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: summary,
                        },
                    ],
                };
            }
            case 'photarium_debug_raw': {
                const result = await getDebugRaw();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
}
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args || {}));
});
const HTTP_HOST = process.env.PHOTARIUM_HTTP_HOST || '127.0.0.1';
const HTTP_PORT = process.env.PHOTARIUM_HTTP_PORT ? Number(process.env.PHOTARIUM_HTTP_PORT) : undefined;
const HTTP_ENABLED = new Set(['1', 'true', 'yes', 'on']).has((process.env.PHOTARIUM_HTTP_ENABLED || '').toLowerCase());
function getTokenFromHeaders(headers) {
    const rawAuth = headers.authorization || headers.Authorization;
    const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice('bearer '.length).trim();
        return token || undefined;
    }
    const rawToken = headers['x-mcp-token'] || headers['X-MCP-Token'];
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    return token || undefined;
}
function maybeInjectToken(args, headers) {
    if (args.token !== undefined) {
        return args;
    }
    const token = getTokenFromHeaders(headers);
    if (!token) {
        return args;
    }
    return { ...args, token };
}
async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk.toString('utf8');
        });
        req.on('end', () => {
            if (!data.trim()) {
                resolve({});
                return;
            }
            try {
                const parsed = JSON.parse(data);
                if (parsed && typeof parsed === 'object') {
                    resolve(parsed);
                    return;
                }
                reject(new Error('Request body must be a JSON object'));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}
async function startHttpServer() {
    const port = HTTP_PORT ?? 8787;
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const path = url.pathname.replace(/\/+$/, '') || '/';
            if (req.method === 'GET' && path === '/health') {
                sendJson(res, 200, { status: 'ok' });
                return;
            }
            if (req.method === 'GET' && path === '/tools') {
                sendJson(res, 200, { tools: TOOLS });
                return;
            }
            if (path.startsWith('/tools/') && req.method === 'GET') {
                const name = decodeURIComponent(path.slice('/tools/'.length));
                const tool = TOOLS.find((entry) => entry.name === name);
                if (!tool) {
                    sendJson(res, 404, { ok: false, error: `Unknown tool: ${name}` });
                    return;
                }
                sendJson(res, 200, { tool });
                return;
            }
            if (req.method === 'POST' && path === '/tools/call') {
                const payload = await readJsonBody(req);
                const name = payload.name;
                if (!name) {
                    sendJson(res, 400, { ok: false, error: 'Missing tool name' });
                    return;
                }
                const rawArgs = payload.arguments;
                const args = maybeInjectToken(rawArgs || {}, req.headers);
                const result = await handleToolCall(name, args);
                sendJson(res, 200, { ok: !result.isError, result });
                return;
            }
            if (req.method === 'POST' && path.startsWith('/tools/')) {
                const name = decodeURIComponent(path.slice('/tools/'.length));
                const payload = await readJsonBody(req);
                const args = payload.arguments
                    || payload.args
                    || payload;
                const result = await handleToolCall(name, maybeInjectToken(args || {}, req.headers));
                sendJson(res, 200, { ok: !result.isError, result });
                return;
            }
            sendJson(res, 404, { ok: false, error: 'Not found' });
        }
        catch (error) {
            sendJson(res, 400, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    server.listen(port, HTTP_HOST, () => {
        console.error(`Photarium MCP HTTP proxy listening on http://${HTTP_HOST}:${port}`);
    });
}
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Photarium MCP server running on stdio');
    if (HTTP_ENABLED || HTTP_PORT !== undefined) {
        await startHttpServer();
    }
}
main().catch(console.error);
