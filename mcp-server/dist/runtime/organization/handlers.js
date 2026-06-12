import { buildShareUrl } from '../shared/image-result.js';
import { createFolder, deleteImage, deleteImageFamily, getDeleteFamilyJob, getExtras, listFolders, listNamespaces, rotateImage, swapImageParent, updateExtras, updateMetadata, } from './client.js';
export const organizationHandlers = {
    'photarium_list_folders': async (args) => {
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
    },
    'photarium_create_folder': async (args) => {
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
    },
    'photarium_list_namespaces': async () => {
        const namespaces = await listNamespaces();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ namespaces }, null, 2),
                },
            ],
        };
    },
    'photarium_update_metadata': async (args) => {
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
    },
    'photarium_extras_get': async (args) => {
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
    },
    'photarium_extras_update': async (args) => {
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
    },
    'photarium_swap_parent': async (args) => {
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
    },
    'photarium_delete_family': async (args) => {
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
    },
    'photarium_delete_family_job': async (args) => {
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
    },
    'photarium_share_url': async (args) => {
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
    },
    'photarium_rotate': async (args) => {
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
    },
    'photarium_delete': async (args) => {
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
    },
};
