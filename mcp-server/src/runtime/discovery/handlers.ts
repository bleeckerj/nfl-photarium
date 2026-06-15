import type { RuntimeToolHandler } from '../types.js';
import { saveBase64ToFile } from '../shared/files.js';
import { estimateBase64Bytes } from '../upload/filenames.js';
import { extractComfyMetadata } from './comfy-metadata.js';
import {
  downloadImageById,
  downloadOriginalImageById,
  findAntipode,
  findSimilar,
  getImage,
  getImageMetadata,
  listImages,
  metadataSearch,
  searchByColor,
  searchByImage,
  semanticSearch,
  textSearch,
} from './client.js';
import type { MetadataMatchMode, MetadataSearchField } from './client.js';

export const discoveryHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_search': async (args: Record<string, unknown>) => {
    const { query, limit, namespace } = args as { query: string; limit?: number; namespace?: string | null };
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

  'photarium_search_text': async (args: Record<string, unknown>) => {
    const { query, folder, namespace, limit, refresh } = args as {
      query: string;
      folder?: string;
      namespace?: string;
      limit?: number;
      refresh?: boolean;
    };
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

  'photarium_search_metadata': async (args: Record<string, unknown>) => {
    const { query, fields, match, caseSensitive, folder, namespace, limit, refresh } = args as {
      query: string;
      fields?: MetadataSearchField[];
      match?: MetadataMatchMode;
      caseSensitive?: boolean;
      folder?: string;
      namespace?: string;
      limit?: number;
      refresh?: boolean;
    };
    const result = await metadataSearch(query, { fields, match, caseSensitive, folder, namespace, limit, refresh });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_search_color': async (args: Record<string, unknown>) => {
    const { color, limit, namespace } = args as { color: string; limit?: number; namespace?: string | null };
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

  'photarium_search_image': async (args: Record<string, unknown>) => {
    const { imageId, limit, namespace } = args as { imageId: string; limit?: number; namespace?: string | null };
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

  'photarium_similar': async (args: Record<string, unknown>) => {
    const { imageId, type, limit, includeStrangers, offset, strangersLimit, strangersOffset, namespace } = args as {
      imageId: string;
      type?: 'clip' | 'color';
      limit?: number;
      includeStrangers?: boolean;
      offset?: number;
      strangersLimit?: number;
      strangersOffset?: number;
      namespace?: string | null;
    };
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

  'photarium_antipode': async (args: Record<string, unknown>) => {
    const { imageId, domain, method, limit, namespace } = args as {
      imageId: string;
      domain?: 'clip' | 'color';
      method?: string;
      limit?: number;
      namespace?: string | null;
    };
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

  'photarium_list': async (args: Record<string, unknown>) => {
    const { folder, namespace, limit, refresh, aspectRatioClass, aspectRatio } = args as {
      folder?: string;
      namespace?: string;
      limit?: number;
      refresh?: boolean;
      aspectRatioClass?: string;
      aspectRatio?: string;
    };
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

  'photarium_get': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_image_metadata': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_download_image': async (args: Record<string, unknown>) => {
    const { imageId, variant, savePath, includeBase64 } = args as { imageId: string; variant?: string; savePath?: string; includeBase64?: boolean };
    const result = await downloadImageById(imageId, variant);
    let savedPath: string | undefined;
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

  'photarium_download_original': async (args: Record<string, unknown>) => {
    const { imageId, savePath, includeBase64 } = args as {
      imageId: string;
      savePath?: string;
      includeBase64?: boolean;
    };
    const result = await downloadOriginalImageById(imageId);
    let savedPath: string | undefined;
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

  'photarium_extract_workflow': async (args: Record<string, unknown>) => {
    const { imageId, includeRawMetadata } = args as { imageId: string; includeRawMetadata?: boolean };
    const download = await downloadOriginalImageById(imageId);
    const decoded = Buffer.from(download.base64, 'base64');
    const extracted = extractComfyMetadata(decoded, download.contentType, download.filename);

    const response: Record<string, unknown> = {
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
