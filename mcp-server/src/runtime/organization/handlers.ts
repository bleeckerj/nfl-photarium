import type { RuntimeToolHandler } from '../types.js';
import { buildShareUrl } from '../shared/image-result.js';
import {
  createFolder,
  deleteNamespace,
  deleteImage,
  deleteImageFamily,
  getDeleteFamilyJob,
  getExtras,
  listFolders,
  listNamespaces,
  renameNamespace,
  rotateImage,
  swapImageParent,
  updateExtras,
  updateMetadata,
} from './client.js';

export const organizationHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_list_folders': async (args: Record<string, unknown>) => {
    const { namespace } = args as { namespace?: string };
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

  'photarium_create_folder': async (args: Record<string, unknown>) => {
    const { name } = args as { name: string };
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

  'photarium_rename_namespace': async (args: Record<string, unknown>) => {
    const { namespace, targetNamespace, dryRun, confirm } = args as {
      namespace: string;
      targetNamespace: string;
      dryRun?: boolean;
      confirm?: string;
    };
    const shouldDryRun = dryRun !== false;
    if (!shouldDryRun && confirm !== 'RENAME_NAMESPACE') {
      throw new Error('Live namespace rename requires confirm="RENAME_NAMESPACE".');
    }
    const result = await renameNamespace({ namespace, targetNamespace, dryRun: shouldDryRun });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_delete_namespace': async (args: Record<string, unknown>) => {
    const { namespace, dryRun, confirm } = args as {
      namespace: string;
      dryRun?: boolean;
      confirm?: string;
    };
    const shouldDryRun = dryRun !== false;
    if (!shouldDryRun && confirm !== 'DELETE_NAMESPACE') {
      throw new Error('Live namespace delete requires confirm="DELETE_NAMESPACE".');
    }
    const result = await deleteNamespace({ namespace, dryRun: shouldDryRun });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_update_metadata': async (args: Record<string, unknown>) => {
    const { imageId, folder, tags, description, displayName, altTag, originalUrl, sourceUrl, namespace, parentId, variationSort, clearExif } = args as {
      imageId: string;
      folder?: string;
      tags?: string[];
      description?: string | null;
      displayName?: string | null;
      altTag?: string;
      originalUrl?: string | null;
      sourceUrl?: string | null;
      namespace?: string;
      parentId?: string;
      variationSort?: number;
      clearExif?: boolean;
    };
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

  'photarium_extras_get': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_extras_update': async (args: Record<string, unknown>) => {
    const { imageId, description, altText } = args as {
      imageId: string;
      description?: string | null;
      altText?: string | null;
    };
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

  'photarium_swap_parent': async (args: Record<string, unknown>) => {
    const { imageId, newParentId, concurrency, dryRun } = args as {
      imageId: string;
      newParentId: string;
      concurrency?: number;
      dryRun?: boolean;
    };
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

  'photarium_delete_family': async (args: Record<string, unknown>) => {
    const { imageId, confirm, dryRun, concurrency, async } = args as {
      imageId: string;
      confirm?: string;
      dryRun?: boolean;
      concurrency?: number;
      async?: boolean;
    };
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

  'photarium_delete_family_job': async (args: Record<string, unknown>) => {
    const { jobId } = args as { jobId: string };
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

  'photarium_share_url': async (args: Record<string, unknown>) => {
    const { imageId, variant } = args as { imageId: string; variant?: string };
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

  'photarium_rotate': async (args: Record<string, unknown>) => {
    const { imageId, direction, degrees, auto } = args as {
      imageId: string;
      direction?: 'left' | 'right';
      degrees?: number;
      auto?: boolean;
    };
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

  'photarium_delete': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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
