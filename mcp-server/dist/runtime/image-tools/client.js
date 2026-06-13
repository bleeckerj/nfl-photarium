import { apiRequest } from '../shared/api-client.js';
export async function listImageTools() {
    return apiRequest('/api/image-tools');
}
export async function startImageToolRun(params) {
    return apiRequest(`/api/image-tools/${encodeURIComponent(params.toolId)}/runs`, {
        method: 'POST',
        body: JSON.stringify({
            imageId: params.imageId,
            request: params.request ?? {},
        }),
    });
}
export async function startImageToolPreview(params) {
    return apiRequest(`/api/image-tools/${encodeURIComponent(params.toolId)}/previews`, {
        method: 'POST',
        body: JSON.stringify({
            imageId: params.imageId,
            request: params.request ?? {},
        }),
    });
}
export async function getImageToolRun(runId) {
    return apiRequest(`/api/image-tools/runs/${encodeURIComponent(runId)}`);
}
export async function getImageToolPreview(previewId) {
    return apiRequest(`/api/image-tools/previews/${encodeURIComponent(previewId)}`);
}
