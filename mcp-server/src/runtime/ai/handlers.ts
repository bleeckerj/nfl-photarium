import type { RuntimeToolHandler } from '../types.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import { downloadOriginalImageById, getImage } from '../discovery/client.js';
import { updateMetadata } from '../organization/client.js';
import { uploadFileBase64 } from '../upload/client.js';
import {
  generateAlt,
  generateDescription,
  generateTags,
  generatePrompt,
  getConcepts,
  getHaiku,
  getPromptRecord,
  getPromptsBulk,
  getPromptDerivations,
  recordPromptDerivationResult,
  aspectRatioToSize,
  type GenerationProvider,
  type SourceRelationship,
} from './client.js';

function mergeTags(existingTags: string[], generatedTags: string[]): { appendedTags: string[]; tags: string[] } {
  const tags = [...existingTags];
  const knownTags = new Set(existingTags.map((tag) => tag.toLocaleLowerCase()));
  const appendedTags: string[] = [];

  for (const tag of generatedTags) {
    const normalizedTag = tag.trim();
    const lookupKey = normalizedTag.toLocaleLowerCase();
    if (!normalizedTag || knownTags.has(lookupKey)) continue;
    knownTags.add(lookupKey);
    appendedTags.push(normalizedTag);
    tags.push(normalizedTag);
  }

  return { appendedTags, tags };
}

function readTags(image: Record<string, unknown> | null): string[] {
  if (!image) throw new Error('Image not found');
  return Array.isArray(image.tags)
    ? image.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
}
import {
  generatePhotariumImage,
  generatePhotariumAspectRatioVariant,
  generatePhotariumImageFromReferences,
  type AspectRatioVariantSettings,
  type ImageGenerationSettings,
  type ImageReferenceInput,
} from './image-generation.js';

function dimensionsFromSize(size?: string): { width: number; height: number } | undefined {
  if (!size) return undefined;
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

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

  'photarium_generate_tags': async (args: Record<string, unknown>) => {
    const { imageId, count } = args as { imageId: string; count?: number };
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

  'photarium_generate_prompt': async (args: Record<string, unknown>) => {
    const { imageId, force, existingPrompt, creativeBrief, sourceRelationship, aspectRatio, saveAsCurrent } = args as {
      imageId: string;
      force?: boolean;
      existingPrompt?: string;
      creativeBrief?: string;
      sourceRelationship?: SourceRelationship;
      aspectRatio?: string;
      saveAsCurrent?: boolean;
    };
    const result = await generatePrompt(imageId, { force, existingPrompt, creativeBrief, sourceRelationship, aspectRatio, saveAsCurrent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_prompt_history': async (args: Record<string, unknown>) => {
    const { imageId } = args as { imageId: string };
    const result = await getPromptDerivations(imageId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },

  'photarium_prepare_creative_brief_generation': async (args: Record<string, unknown>) => {
    const { imageId, creativeBrief, sourceRelationship, aspectRatio, existingPrompt } = args as {
      imageId: string;
      creativeBrief: string;
      sourceRelationship?: SourceRelationship;
      aspectRatio?: string;
      existingPrompt?: string;
    };
    const result = await generatePrompt(imageId, {
      creativeBrief,
      sourceRelationship,
      aspectRatio,
      existingPrompt,
      force: true,
      saveAsCurrent: false,
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ plan: result.plan, derivation: result.derivation, prompt: result.prompt }, null, 2),
      }],
    };
  },

  'photarium_record_creative_brief_result': async (args: Record<string, unknown>) => {
    const { imageId, derivationId, provider, generatedImageId, externalJobId, actualDimensions, actualAspectRatio } = args as {
      imageId: string;
      derivationId: string;
      provider: GenerationProvider;
      generatedImageId?: string;
      externalJobId?: string;
      actualDimensions?: { width: number; height: number };
      actualAspectRatio?: string;
    };
    const result = await recordPromptDerivationResult(imageId, {
      derivationId,
      provider,
      generatedImageId,
      externalJobId,
      actualDimensions,
      actualAspectRatio,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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

  'photarium_generate_from_creative_brief': async (args: Record<string, unknown>) => {
    const {
      imageId,
      creativeBrief,
      sourceRelationship,
      aspectRatio,
      provider = 'codex_imagegen',
      existingPrompt,
      dryRun,
      ...settings
    } = args as unknown as {
      imageId: string;
      creativeBrief: string;
      sourceRelationship?: SourceRelationship;
      aspectRatio?: string;
      provider?: GenerationProvider;
      existingPrompt?: string;
      dryRun?: boolean;
      [key: string]: unknown;
    };
    const prepared = await generatePrompt(imageId, {
      creativeBrief,
      sourceRelationship,
      aspectRatio,
      existingPrompt,
      force: true,
      saveAsCurrent: false,
    });
    if (!prepared.plan || !prepared.prompt) throw new Error('Creative brief prompt generation did not return a plan');

    if (provider !== 'photarium_openai') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            handoffRequired: true,
            provider,
            plan: { ...prepared.plan, provider },
            derivation: prepared.derivation,
            dryRun: Boolean(dryRun),
          }, null, 2),
        }],
      };
    }

    const generationSettings = settings as unknown as Omit<ImageGenerationSettings, 'prompt'>;
    const outputSize = generationSettings.size || aspectRatioToSize(prepared.plan.aspectRatio);
    const result = await generatePhotariumImageFromReferences(
      { downloadOriginalImageById, uploadFileBase64 },
      {
        ...generationSettings,
        prompt: prepared.prompt,
        size: outputSize,
        dryRun,
      },
      [{ imageId, role: 'subject_reference' }],
      'creative_brief',
    );
    if (!dryRun && result.imageId) {
      await recordPromptDerivationResult(imageId, {
        derivationId: prepared.plan.derivationId,
        provider: 'photarium_openai',
        generatedImageId: String(result.imageId),
        actualDimensions: dimensionsFromSize(outputSize),
        actualAspectRatio: prepared.plan.aspectRatio,
      });
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          plan: { ...prepared.plan, provider },
          derivation: prepared.derivation,
          result,
        }, null, 2),
      }],
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
