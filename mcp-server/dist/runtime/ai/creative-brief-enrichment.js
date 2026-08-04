import { generateAlt, generateDescription } from './client.js';
const defaultDependencies = {
    generateDescription,
    generateAlt,
};
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Metadata generation failed';
}
export async function enrichCreativeBriefImage(imageId, dependencies = defaultDependencies) {
    if (!imageId) {
        return {
            status: 'failed',
            descriptionSaved: false,
            altTextSaved: false,
            reason: 'generatedImageId is required before metadata enrichment can run',
        };
    }
    const [descriptionResult, altResult] = await Promise.allSettled([
        dependencies.generateDescription(imageId),
        dependencies.generateAlt(imageId),
    ]);
    const errors = [];
    const result = {
        status: 'completed',
        imageId,
        descriptionSaved: false,
        altTextSaved: false,
    };
    if (descriptionResult.status === 'fulfilled') {
        result.description = descriptionResult.value.description;
        result.descriptionSaved = true;
    }
    else {
        errors.push({ field: 'description', message: errorMessage(descriptionResult.reason) });
    }
    if (altResult.status === 'fulfilled') {
        result.altText = altResult.value.altTag;
        result.altTextSaved = true;
    }
    else {
        errors.push({ field: 'altText', message: errorMessage(altResult.reason) });
    }
    if (errors.length > 0) {
        result.status = errors.length === 2 ? 'failed' : 'partial';
        result.errors = errors;
    }
    return result;
}
