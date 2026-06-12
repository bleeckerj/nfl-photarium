import { apiRequest } from '../shared/api-client.js';
export async function getVectorStatus() {
    return apiRequest('/api/images/vectors/status');
}
export async function generateEmbeddings(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/embeddings`, {
        method: 'POST',
        body: JSON.stringify({
            clip: options.clip !== false,
            color: options.color !== false,
            force: options.force === true,
        }),
    });
}
export async function getEmbeddingStatus(imageId) {
    return apiRequest(`/api/images/${imageId}/embeddings`);
}
export async function batchGenerateEmbeddings(options) {
    return apiRequest('/api/images/embeddings/batch', {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
export async function ensureVectorIndex() {
    return apiRequest('/api/images/vectors/status', { method: 'POST' });
}
export async function getColorsBulk(imageIds) {
    const params = new URLSearchParams();
    params.set('ids', imageIds.join(','));
    const data = await apiRequest(`/api/images/colors?${params}`);
    return data.colors;
}
export async function auditImages(options = {}) {
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
export async function getDebugRaw() {
    return apiRequest('/api/debug');
}
