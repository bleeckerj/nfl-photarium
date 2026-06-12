import { saveBase64ToFile } from '../shared/files.js';
import { estimateBase64Bytes } from '../upload/filenames.js';
import { extractComfyMetadata } from './comfy-metadata.js';
import { downloadImageById, downloadOriginalImageById, findAntipode, findSimilar, getImage, getImageMetadata, listImages, searchByColor, searchByImage, semanticSearch, textSearch, } from './client.js';
export const discoveryHandlers = {
    'photarium_search': async (args) => {
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
    },
    'photarium_search_text': async (args) => {
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
    },
    'photarium_search_color': async (args) => {
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
    },
    'photarium_search_image': async (args) => {
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
    },
    'photarium_similar': async (args) => {
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
    },
    'photarium_antipode': async (args) => {
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
    },
    'photarium_list': async (args) => {
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
    },
    'photarium_get': async (args) => {
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
    },
    'photarium_image_metadata': async (args) => {
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
    },
    'photarium_download_image': async (args) => {
        const { imageId, variant, savePath, includeBase64 } = args;
        const result = await downloadImageById(imageId, variant);
        let savedPath;
        if (savePath) {
            const fallbackFilename = result.filename || `${imageId}${variant ? `_${variant}` : ''}.bin`;
            savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
        }
        const includeRaw = includeBase64 === true;
        const response = includeRaw
            ? { ...result, savedPath }
            : {
                ...result,
                base64: undefined,
                base64Omitted: true,
                base64Bytes: estimateBase64Bytes(result.base64),
                savedPath,
            };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                },
            ],
        };
    },
    'photarium_download_original': async (args) => {
        const { imageId, savePath, includeBase64 } = args;
        const result = await downloadOriginalImageById(imageId);
        let savedPath;
        if (savePath) {
            const fallbackFilename = result.filename || `${imageId}_original.bin`;
            savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
        }
        const includeRaw = includeBase64 === true;
        const response = includeRaw
            ? { ...result, savedPath }
            : {
                ...result,
                base64: undefined,
                base64Omitted: true,
                base64Bytes: estimateBase64Bytes(result.base64),
                savedPath,
            };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                },
            ],
        };
    },
    'photarium_extract_workflow': async (args) => {
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
    },
};
