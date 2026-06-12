import { apiRequest } from '../shared/api-client.js';
export async function generateAlt(imageId) {
    const data = await apiRequest(`/api/images/${imageId}/alt`, {
        method: 'POST',
    });
    return data;
}
export async function generateDescription(imageId, options = {}) {
    const data = await apiRequest(`/api/images/${imageId}/description`, {
        method: 'POST',
        body: options.existingDescription ? JSON.stringify({ existingDescription: options.existingDescription }) : undefined,
    });
    return data;
}
export async function generatePrompt(imageId, options = {}) {
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
export async function getConcepts(imageId) {
    const data = await apiRequest(`/api/images/${imageId}/concepts`, {
        method: 'POST',
    });
    return data;
}
export async function getPromptsBulk(imageIds) {
    const params = new URLSearchParams();
    params.set('ids', imageIds.join(','));
    const data = await apiRequest(`/api/images/prompts?${params}`);
    return data.prompts;
}
export async function getPromptRecord(imageId) {
    return apiRequest(`/api/images/${imageId}/prompt`);
}
export async function getHaiku(imageId) {
    return apiRequest(`/api/images/${imageId}/haiku`, { method: 'POST' });
}
