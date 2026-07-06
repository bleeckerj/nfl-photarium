import type { RuntimeToolHandler } from '../types.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import { downloadOriginalImageById, getImage } from '../discovery/client.js';
import { uploadFileBase64 } from '../upload/client.js';
import {
  generateAlt,
  generateDescription,
  generatePrompt,
  getConcepts,
  getHaiku,
  getPromptRecord,
  getPromptsBulk,
} from './client.js';
import {
  generatePhotariumImage,
  generatePhotariumAspectRatioVariant,
  generatePhotariumImageFromReferences,
  type AspectRatioVariantSettings,
  type ImageGenerationSettings,
  type ImageReferenceInput,
} from './image-generation.js';

export const aiHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_generate_alt': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_generate_description': async (args: Record<string, unknown>) => {
    const { imageId, existingDescription } = args as { imageId: string; existingDescription?: string };
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

  'photarium_generate_prompt': async (args: Record<string, unknown>) => {
    const { imageId, force, existingPrompt } = args as { imageId: string; force?: boolean; existingPrompt?: string };
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

  'photarium_generate_image': async (args: Record<string, unknown>) => {
    const result = await generatePhotariumImage(
      { downloadOriginalImageById, uploadFileBase64 },
      args as unknown as ImageGenerationSettings
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_generate_from_references': async (args: Record<string, unknown>) => {
    const { references, ...settings } = args as unknown as ImageGenerationSettings & { references: ImageReferenceInput[] };
    const result = await generatePhotariumImageFromReferences(
      { downloadOriginalImageById, uploadFileBase64 },
      settings,
      references,
      'reference_generate'
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_aspect_ratio_variant': async (args: Record<string, unknown>) => {
    const result = await generatePhotariumAspectRatioVariant(
      { downloadOriginalImageById, getImage, uploadFileBase64 },
      args as unknown as AspectRatioVariantSettings
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_semantic_merge': async (args: Record<string, unknown>) => {
    const { sources, mergeBrief, prompt, ...settings } = args as unknown as ImageGenerationSettings & {
      sources: ImageReferenceInput[];
      mergeBrief: string;
    };
    const mergedPrompt = [mergeBrief, normalizeManualPrompt(prompt)].filter(Boolean).join('\n\n');
    const result = await generatePhotariumImageFromReferences(
      { downloadOriginalImageById, uploadFileBase64 },
      { ...settings, prompt: mergedPrompt },
      sources.map((source) => ({ role: 'semantic_source', ...source })),
      'semantic_merge'
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_prompt_get': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_prompts_bulk': async (args: Record<string, unknown>) => {
    const { imageIds } = args as { imageIds: string[] };
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

  'photarium_concepts': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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

  'photarium_haiku': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
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
