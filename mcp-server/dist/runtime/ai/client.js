import { apiRequest } from '../shared/api-client.js';
export const SOURCE_RELATIONSHIPS = ['brief_led', 'faithful_adaptation', 'related_design', 'inspired_concept'];
export const GENERATION_PROVIDERS = ['codex_imagegen', 'comfyui', 'photarium_openai'];
export function aspectRatioToSize(aspectRatio) {
    if (!aspectRatio)
        return undefined;
    const [width, height] = aspectRatio.split(':').map(Number);
    const base = 1024;
    if (width === height)
        return `${base}x${base}`;
    if (width < height)
        return `${base}x${Math.max(1, Math.round(base * height / width))}`;
    return `${Math.max(1, Math.round(base * width / height))}x${base}`;
}
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
export async function generateTags(imageId, options = {}) {
    return apiRequest(`/api/images/${encodeURIComponent(imageId)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ count: options.count ?? 8 }),
    });
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
            creativeBrief: options.creativeBrief,
            sourceRelationship: options.sourceRelationship,
            aspectRatio: options.aspectRatio,
            saveAsCurrent: options.saveAsCurrent,
        }),
    });
    return data;
}
export async function getPromptDerivations(imageId) {
    return apiRequest(`/api/images/${encodeURIComponent(imageId)}/prompt/derivations`);
}
export async function recordPromptDerivationResult(imageId, payload) {
    return apiRequest(`/api/images/${encodeURIComponent(imageId)}/prompt/derivations`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
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
