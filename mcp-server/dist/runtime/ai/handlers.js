import { normalizeManualPrompt } from '../shared/prompts.js';
import { downloadOriginalImageById, getImage } from '../discovery/client.js';
import { updateMetadata } from '../organization/client.js';
import { uploadFileBase64 } from '../upload/client.js';
import { generateAlt, generateDescription, generateTags, generatePrompt, getConcepts, getHaiku, getPromptRecord, getPromptsBulk, } from './client.js';
function mergeTags(existingTags, generatedTags) {
    const tags = [...existingTags];
    const knownTags = new Set(existingTags.map((tag) => tag.toLocaleLowerCase()));
    const appendedTags = [];
    for (const tag of generatedTags) {
        const normalizedTag = tag.trim();
        const lookupKey = normalizedTag.toLocaleLowerCase();
        if (!normalizedTag || knownTags.has(lookupKey))
            continue;
        knownTags.add(lookupKey);
        appendedTags.push(normalizedTag);
        tags.push(normalizedTag);
    }
    return { appendedTags, tags };
}
function readTags(image) {
    if (!image)
        throw new Error('Image not found');
    return Array.isArray(image.tags)
        ? image.tags.filter((tag) => typeof tag === 'string')
        : [];
}
import { generatePhotariumImage, generatePhotariumAspectRatioVariant, generatePhotariumImageFromReferences, } from './image-generation.js';
export const aiHandlers = {
    'photarium_generate_alt': async (args) => {
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
    },
    'photarium_generate_description': async (args) => {
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
    },
    'photarium_generate_tags': async (args) => {
        const { imageId, count } = args;
        const [image, generated] = await Promise.all([
            getImage(imageId),
            generateTags(imageId, { count }),
        ]);
        const merged = mergeTags(readTags(image), generated.tags);
        const savedImage = await updateMetadata(imageId, { tags: merged.tags });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        imageId,
                        generatedTags: generated.tags,
                        appendedTags: merged.appendedTags,
                        tags: savedImage.tags || merged.tags,
                        model: generated.model,
                        saved: true,
                    }, null, 2),
                },
            ],
        };
    },
    'photarium_generate_prompt': async (args) => {
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
    },
    'photarium_generate_image': async (args) => {
        const result = await generatePhotariumImage({ downloadOriginalImageById, uploadFileBase64 }, args);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_generate_from_references': async (args) => {
        const { references, ...settings } = args;
        const result = await generatePhotariumImageFromReferences({ downloadOriginalImageById, uploadFileBase64 }, settings, references, 'reference_generate');
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_aspect_ratio_variant': async (args) => {
        const result = await generatePhotariumAspectRatioVariant({ downloadOriginalImageById, getImage, uploadFileBase64 }, args);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_semantic_merge': async (args) => {
        const { sources, mergeBrief, prompt, ...settings } = args;
        const mergedPrompt = [mergeBrief, normalizeManualPrompt(prompt)].filter(Boolean).join('\n\n');
        const result = await generatePhotariumImageFromReferences({ downloadOriginalImageById, uploadFileBase64 }, { ...settings, prompt: mergedPrompt }, sources.map((source) => ({ role: 'semantic_source', ...source })), 'semantic_merge');
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_prompt_get': async (args) => {
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
    },
    'photarium_prompts_bulk': async (args) => {
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
    },
    'photarium_concepts': async (args) => {
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
    },
    'photarium_haiku': async (args) => {
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
    },
};
