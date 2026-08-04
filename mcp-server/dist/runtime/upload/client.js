import { BASE_URL } from '../shared/config.js';
import { apiRequest, apiRequestRaw } from '../shared/api-client.js';
import { decodeBase64 } from '../shared/base64.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import { camelizeUploadStem, detectImageMimeFromBuffer, extensionFromFilename, extensionFromMimeType, extractUploadFilenameFromUrl, looksLikeTransportFilename, withExtension, } from './filenames.js';
export async function suggestSemanticDisplayNameFromUrl(url, hints = {}) {
    try {
        const form = new FormData();
        form.append('remoteUrl', url);
        if (hints.filename)
            form.append('filename', hints.filename);
        if (hints.folder)
            form.append('folder', hints.folder);
        if (hints.tags?.length)
            form.append('tags', hints.tags.join(','));
        const response = await fetch(`${BASE_URL}/api/display-name/suggest`, {
            method: 'POST',
            body: form,
        });
        if (!response.ok)
            return undefined;
        const payload = (await response.json());
        const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
        if (!displayName)
            return undefined;
        return camelizeUploadStem(displayName);
    }
    catch {
        return undefined;
    }
}
export async function uploadFromUrl(url, options = {}) {
    try {
        // Fetch the image
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
            return { success: false, error: `Failed to fetch image from URL: ${imageResponse.status}` };
        }
        const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
        if (!imageBytes.length) {
            return { success: false, error: 'Downloaded file is empty' };
        }
        const inferredMime = detectImageMimeFromBuffer(imageBytes)
            || imageResponse.headers.get('content-type')?.split(';')[0]?.trim()
            || undefined;
        if (!inferredMime || !inferredMime.startsWith('image/')) {
            return { success: false, error: 'Downloaded content is not valid image data' };
        }
        const extractedFilename = extractUploadFilenameFromUrl(url, inferredMime);
        const extractedExtension = extensionFromFilename(extractedFilename) || extensionFromMimeType(inferredMime) || '.jpg';
        const extractedStem = extractedFilename.replace(/\.[^.]+$/, '');
        let semanticDisplayName = options.displayName ? camelizeUploadStem(options.displayName) : '';
        if (!semanticDisplayName) {
            if (looksLikeTransportFilename(extractedFilename)) {
                const suggested = await suggestSemanticDisplayNameFromUrl(url, {
                    filename: extractedFilename,
                    folder: options.folder,
                    tags: options.tags,
                });
                semanticDisplayName = suggested || camelizeUploadStem(extractedStem);
            }
            else {
                semanticDisplayName = camelizeUploadStem(extractedStem);
            }
        }
        const filename = withExtension(semanticDisplayName || 'UploadedImage', extractedExtension);
        // Create form data
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(imageBytes)], { type: inferredMime }), filename);
        formData.append('displayName', semanticDisplayName || filename.replace(/\.[^.]+$/, ''));
        if (options.folder)
            formData.append('folder', options.folder);
        if (options.createFolder)
            formData.append('createFolder', 'true');
        if (options.tags)
            formData.append('tags', options.tags.join(','));
        if (options.namespace)
            formData.append('namespace', options.namespace);
        if (options.description)
            formData.append('description', options.description);
        const prompt = normalizeManualPrompt(options.prompt);
        if (prompt)
            formData.append('prompt', prompt);
        formData.append('originalUrl', options.originalUrl || url);
        if (options.sourceUrl)
            formData.append('sourceUrl', options.sourceUrl);
        if (options.parentId)
            formData.append('parentId', options.parentId);
        if (options.generateSemanticTags === false)
            formData.append('generateSemanticTags', 'false');
        if (options.semanticTagCount !== undefined)
            formData.append('semanticTagCount', String(options.semanticTagCount));
        // Prefer the same upload endpoint used by the web UI / file uploads.
        // This avoids relying on the "external" upload route, which has (in some deployments)
        // failed with upstream orchestration/vision-labeling errors.
        const response = await fetch(`${BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const errorMessage = typeof result?.error === 'string'
                ? result.error
                : 'Upload failed';
            return { success: false, error: errorMessage };
        }
        const imageId = typeof result.id === 'string'
            ? result.id
            : undefined;
        const promptSave = result && typeof result === 'object' && !Array.isArray(result) && 'promptSave' in result
            ? result.promptSave
            : undefined;
        return {
            success: true,
            imageId,
            ...(promptSave !== undefined ? { promptSave: promptSave } : {}),
        };
    }
    catch (error) {
        return { success: false, error: String(error) };
    }
}
export async function listUploads(options = {}) {
    const params = new URLSearchParams();
    if (options.page !== undefined)
        params.set('page', String(options.page));
    if (options.pageSize !== undefined)
        params.set('pageSize', String(options.pageSize));
    if (options.folder)
        params.set('folder', options.folder);
    return apiRequest(`/api/uploads?${params}`);
}
export async function downloadUpload(uploadId) {
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
export async function importFromUrl(url) {
    return apiRequest('/api/import', {
        method: 'POST',
        body: JSON.stringify({ url }),
    });
}
export async function uploadFileBase64(endpoint, payload) {
    const { buffer, mimeType } = decodeBase64(payload.base64);
    const contentType = payload.contentType || mimeType || 'application/octet-stream';
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), payload.filename);
    if (payload.folder)
        formData.append('folder', payload.folder);
    if (payload.createFolder)
        formData.append('createFolder', 'true');
    if (payload.tags?.length)
        formData.append('tags', payload.tags.join(','));
    if (payload.description)
        formData.append('description', payload.description);
    const prompt = normalizeManualPrompt(payload.prompt);
    if (prompt)
        formData.append('prompt', prompt);
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
    if (payload.generateSemanticTags === false)
        formData.append('generateSemanticTags', 'false');
    if (payload.semanticTagCount !== undefined)
        formData.append('semanticTagCount', String(payload.semanticTagCount));
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
export async function createAnimation(options) {
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
    if (options.createFolder)
        formData.append('createFolder', 'true');
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
