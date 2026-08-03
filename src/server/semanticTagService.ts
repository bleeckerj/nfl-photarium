import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { patchCloudflareImageMetadata } from '@/server/cloudflareImageMetadata';
import { syncMetadataImageById } from '@/server/metadataSearchIndex';
import { resolveVisionImageUrl } from '@/server/visionImageSource';
import { sanitizeSingleWordSuggestedTags } from '@/server/aiTagParsing';
import { getOpenAiTagsModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { mergeUserTagsPreservingSystemTags } from '@/utils/systemTags';

export const DEFAULT_SEMANTIC_TAG_COUNT = 6;
export const MIN_SEMANTIC_TAG_COUNT = 1;
export const MAX_SEMANTIC_TAG_COUNT = 12;

export class SemanticTagGenerationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'SemanticTagGenerationError';
    this.status = status;
  }
}

export type GeneratedSemanticTags = {
  tags: string[];
  model: string;
};

export type PersistedSemanticTags = GeneratedSemanticTags & {
  appendedTags: string[];
  saved: boolean;
};

export const clampSemanticTagCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MAX_SEMANTIC_TAG_COUNT, Math.max(MIN_SEMANTIC_TAG_COUNT, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_SEMANTIC_TAG_COUNT, Math.max(MIN_SEMANTIC_TAG_COUNT, parsed));
    }
  }
  return DEFAULT_SEMANTIC_TAG_COUNT;
};

const extractMessageText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const merged = content
    .map((chunk) => (chunk && typeof chunk === 'object' ? (chunk as { text?: string }).text || '' : ''))
    .join(' ')
    .trim();
  return merged || undefined;
};

const buildSemanticTagPrompt = (existingTags: string[], requestedCount: number): string => [
  'Analyze this image and return only a comma-separated list of semantic tags.',
  `Return exactly ${requestedCount} tags.`,
  'Separate every tag with a comma.',
  'Each tag must be a single word; represent a multi-word brand or trademark as one lowercase hyphenated tag.',
  'Use lowercase ASCII words and hyphens only.',
  'Describe visible scene, subject, object, mood, material, or setting content.',
  'Include every visible named brand, trademark, logo, slogan, product line, retailer, corporate symbol, or other recognizable commercial sign or signal when it is legible or confidently identifiable.',
  'Prefer the recognizable brand or trademark name over a generic category term when both are visible.',
  'Do not invent or infer a brand, trademark, or commercial entity that is not visible or confidently recognizable.',
  'Never tag the workflow, tool, provider, model, prompt, pipeline, provenance, filename, folder, or any other process that produced the image.',
  'Never use color names or color descriptions; CLIP and other vector embeddings handle color.',
  'No phrases, no punctuation, no numbering, no explanation, no markdown.',
  'Do not collapse multiple tags into one hyphenated slug.',
  existingTags.length ? `Existing tags for context: ${existingTags.join(', ')}` : null,
].filter(Boolean).join('\n');

export async function generateSemanticTags(params: {
  imageId: string;
  count?: number;
}): Promise<GeneratedSemanticTags> {
  const credentials = getCloudflareCredentials();
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) {
    throw new SemanticTagGenerationError('OpenAI API key not configured');
  }

  const image = await fetchCloudflareImage(params.imageId, credentials);
  const imageUrl = await resolveVisionImageUrl(image, credentials);
  if (!imageUrl) {
    throw new SemanticTagGenerationError('No accessible image variant found', 422);
  }

  const parsedMeta = parseCloudflareMetadata(image.meta);
  const existingTags = Array.isArray(parsedMeta.tags)
    ? parsedMeta.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 12)
    : [];
  const requestedCount = clampSemanticTagCount(params.count);
  const prompt = buildSemanticTagPrompt(existingTags, requestedCount);
  const model = getOpenAiTagsModel();

  const openAiResponse = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: 'You create compact semantic tags for image content. Use single words, with one lowercase hyphenated tag allowed for a multi-word brand or trademark. Include visible named brands, trademarks, and other recognizable commercial signs and signals. Exclude workflow/provenance terms and all color terms.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  const openAiPayload = await openAiResponse.json();
  if (!openAiResponse.ok) {
    throw new SemanticTagGenerationError(
      openAiPayload?.error?.message || 'Failed to generate tags',
      openAiResponse.status
    );
  }

  const raw = extractMessageText(openAiPayload?.choices?.[0]?.message?.content);
  const tags = sanitizeSingleWordSuggestedTags(raw, requestedCount);
  if (tags.length === 0) {
    throw new SemanticTagGenerationError('OpenAI response did not contain usable tags', 422);
  }

  return { tags, model };
}

export const mergeSemanticTags = (
  existingTags: string[] | undefined,
  generatedTags: string[]
): { tags: string[]; appendedTags: string[] } => {
  const currentTags = Array.isArray(existingTags) ? existingTags : [];
  const knownTags = new Set(currentTags.map((tag) => tag.trim().toLocaleLowerCase()));
  const appendedTags: string[] = [];

  for (const generatedTag of generatedTags) {
    const normalizedTag = generatedTag.trim();
    const lookupKey = normalizedTag.toLocaleLowerCase();
    if (!normalizedTag || knownTags.has(lookupKey)) continue;
    knownTags.add(lookupKey);
    appendedTags.push(normalizedTag);
  }

  return {
    tags: mergeUserTagsPreservingSystemTags(currentTags, [...currentTags, ...appendedTags]),
    appendedTags,
  };
};

export async function generateAndPersistSemanticTags(params: {
  imageId: string;
  count?: number;
}): Promise<PersistedSemanticTags> {
  const generated = await generateSemanticTags(params);
  let appendedTags: string[] = [];

  await patchCloudflareImageMetadata(params.imageId, (existingMeta) => {
    const merged = mergeSemanticTags(
      Array.isArray(existingMeta.tags) ? existingMeta.tags : [],
      generated.tags
    );
    appendedTags = merged.appendedTags;
    return {
      ...existingMeta,
      tags: merged.tags,
    };
  }, { requiredKeys: ['tags'] });
  await syncMetadataImageById(params.imageId);

  return {
    ...generated,
    appendedTags,
    saved: true,
  };
}
