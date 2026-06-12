import { apiRequest } from '../shared/api-client.js';
import { formatImageResult } from '../shared/image-result.js';
export async function listFolders(namespace) {
    const params = new URLSearchParams();
    if (namespace)
        params.set('namespace', namespace);
    const data = await apiRequest(`/api/folders?${params}`);
    return data.folders;
}
export async function createFolder(name) {
    return apiRequest('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}
export async function listNamespaces() {
    const data = await apiRequest('/api/namespaces');
    return data.namespaces;
}
export async function updateMetadata(imageId, updates) {
    const data = await apiRequest(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
    return formatImageResult(data);
}
export async function deleteImage(imageId) {
    return apiRequest(`/api/images/${imageId}`, {
        method: 'DELETE',
    });
}
export async function getExtras(imageId) {
    return apiRequest(`/api/images/${imageId}/extras`);
}
export async function updateExtras(imageId, updates) {
    return apiRequest(`/api/images/${imageId}/extras`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}
export async function rotateImage(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/rotate`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
export async function swapImageParent(imageId, options) {
    return apiRequest(`/api/images/${imageId}/swap-parent`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
export async function deleteImageFamily(imageId, options = {}) {
    return apiRequest(`/api/images/${imageId}/delete-family`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
export async function getDeleteFamilyJob(jobId) {
    return apiRequest(`/api/jobs/delete-family/${jobId}`);
}
