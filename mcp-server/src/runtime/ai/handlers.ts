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
import { enrichCreativeBriefImage } from './creative-brief-enrichment.js';

type ImageRecord = Record<string, unknown>;

function positiveDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : undefined;
}

function ratioFromDimensions(dimensions: { width: number; height: number }): string {
  const gcd = (left: number, right: number): number => {
    let a = left;
    let b = right;
    while (b !== 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return a;
  };
  const divisor = gcd(dimensions.width, dimensions.height);
  return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function stringField(record: ImageRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function verifyCreativeBriefChild(
  sourceImageId: string,
  generatedImageId: string,
  actualDimensions?: { width: number; height: number },
  actualAspectRatio?: string,
): Promise<{
  child: ImageRecord;
  dimensions: { width: number; height: number };
  actualAspectRatio: string;
}> {
  const [source, child] = await Promise.all([getImage(sourceImageId), getImage(generatedImageId)]);
  if (!source) throw new Error(`Source image was not found: ${sourceImageId}`);
  if (!child) throw new Error(`Generated Photarium child was not found: ${generatedImageId}`);

  const sourceRootId = stringField(source, 'parentId') || sourceImageId;
  const childParentId = stringField(child, 'parentId');
  if (childParentId !== sourceImageId && childParentId !== sourceRootId) {
    throw new Error(`Generated image ${generatedImageId} is not linked to source ${sourceImageId} or its family root ${sourceRootId}`);
  }

  const dimensions = actualDimensions || positiveDimensions(child.dimensions);
  if (!dimensions) throw new Error(`Generated image ${generatedImageId} has no verified dimensions`);
  const derivedRatio = ratioFromDimensions(dimensions);
  if (actualAspectRatio && actualAspectRatio !== derivedRatio) {
    throw new Error(`Actual aspect ratio ${actualAspectRatio} does not match dimensions ${derivedRatio}`);
  }
  return { child, dimensions, actualAspectRatio: derivedRatio };
}

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
      generatedImageId: string;
      externalJobId?: string;
      actualDimensions?: { width: number; height: number };
      actualAspectRatio?: string;
    };
    if (!generatedImageId?.trim()) {
      throw new Error('generatedImageId is required: upload the generated image to Photarium before recording the result');
    }
    const verified = await verifyCreativeBriefChild(imageId, generatedImageId, actualDimensions, actualAspectRatio);
    const metadataEnrichment = await enrichCreativeBriefImage(generatedImageId);
    const result = await recordPromptDerivationResult(imageId, {
      derivationId,
      provider,
      generatedImageId,
      externalJobId,
      actualDimensions: verified.dimensions,
      actualAspectRatio: verified.actualAspectRatio,
      metadataEnrichment: {
        status: metadataEnrichment.status,
        descriptionSaved: metadataEnrichment.descriptionSaved,
        altTextSaved: metadataEnrichment.altTextSaved,
      },
    });
    const hostedUrl = stringField(verified.child, 'url');
    if (!hostedUrl) throw new Error(`Generated image ${generatedImageId} has no hosted Photarium URL`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          completion: {
            sourceImageId: imageId,
            derivationId,
            generatedImageId,
            provider,
            hostedUrl,
            promptPersisted: true,
            parentVerified: true,
            dimensionsVerified: true,
            metadataEnrichment: {
              status: metadataEnrichment.status,
              descriptionSaved: metadataEnrichment.descriptionSaved,
              altTextSaved: metadataEnrichment.altTextSaved,
            },
          },
        }, null, 2),
      }],
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

    const { tags: ignoredTags, ...creativeBriefSettings } = settings as unknown as ImageGenerationSettings;
    void ignoredTags;
    const generationSettings = creativeBriefSettings as Omit<ImageGenerationSettings, 'prompt'>;
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
    const generatedImageId = typeof result.imageId === 'string' ? result.imageId : undefined;
    let metadataEnrichment;
    if (!dryRun && generatedImageId) {
      const verified = await verifyCreativeBriefChild(
        imageId,
        generatedImageId,
        dimensionsFromSize(outputSize),
        prepared.plan.aspectRatio,
      );
      metadataEnrichment = await enrichCreativeBriefImage(generatedImageId);
      await recordPromptDerivationResult(imageId, {
        derivationId: prepared.plan.derivationId,
        provider: 'photarium_openai',
        generatedImageId,
        actualDimensions: verified.dimensions,
        actualAspectRatio: verified.actualAspectRatio,
        metadataEnrichment: {
          status: metadataEnrichment.status,
          descriptionSaved: metadataEnrichment.descriptionSaved,
          altTextSaved: metadataEnrichment.altTextSaved,
        },
      });
    }
    if (!metadataEnrichment) metadataEnrichment = await enrichCreativeBriefImage(generatedImageId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          plan: { ...prepared.plan, provider },
          derivation: prepared.derivation,
          result,
          metadataEnrichment,
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
