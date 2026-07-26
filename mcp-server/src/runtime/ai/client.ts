import { apiRequest } from '../shared/api-client.js';
import type { ConceptScore } from '../types.js';

export const SOURCE_RELATIONSHIPS = ['brief_led', 'faithful_adaptation', 'related_design', 'inspired_concept'] as const;
export type SourceRelationship = (typeof SOURCE_RELATIONSHIPS)[number];
export const GENERATION_PROVIDERS = ['codex_imagegen', 'comfyui', 'photarium_openai'] as const;
export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number];

export type CreativeBriefReference = {
  imageId: string;
  role: 'subject_reference' | 'brand_reference' | 'logo_reference';
};

export type CreativeBriefGenerationPlan = {
  derivationId: string;
  sourceImageId: string;
  creativeBrief: string;
  prompt: string;
  sourceRelationship: SourceRelationship;
  aspectRatio?: string;
  provider?: GenerationProvider;
  references: CreativeBriefReference[];
};

export type PromptDerivationRecord = CreativeBriefGenerationPlan & {
  generatedImageId?: string;
  externalJobId?: string;
  actualDimensions?: { width: number; height: number };
  actualAspectRatio?: string;
  createdAt: string;
  updatedAt: string;
};

export function aspectRatioToSize(aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  const [width, height] = aspectRatio.split(':').map(Number);
  const base = 1024;
  if (width === height) return `${base}x${base}`;
  if (width < height) return `${base}x${Math.max(1, Math.round(base * height / width))}`;
  return `${Math.max(1, Math.round(base * width / height))}x${base}`;
}

export async function generateAlt(imageId: string): Promise<{ altTag: string }> {
  const data = await apiRequest<{ altTag: string }>(`/api/images/${imageId}/alt`, {
    method: 'POST',
  });
  return data;
}

export async function generateDescription(
  imageId: string,
  options: { existingDescription?: string } = {}
): Promise<{ description: string }> {
  const data = await apiRequest<{ description: string }>(`/api/images/${imageId}/description`, {
    method: 'POST',
    body: options.existingDescription ? JSON.stringify({ existingDescription: options.existingDescription }) : undefined,
  });
  return data;
}

export async function generateTags(
  imageId: string,
  options: { count?: number } = {}
): Promise<{ tags: string[]; model?: string }> {
  return apiRequest(`/api/images/${encodeURIComponent(imageId)}/tags`, {
    method: 'POST',
    body: JSON.stringify({ count: options.count ?? 8 }),
  });
}

export async function generatePrompt(
  imageId: string,
  options: {
    force?: boolean;
    existingPrompt?: string;
    creativeBrief?: string;
    sourceRelationship?: SourceRelationship;
    aspectRatio?: string;
    saveAsCurrent?: boolean;
  } = {}
): Promise<{ prompt?: string; record?: unknown; derivation?: PromptDerivationRecord; plan?: CreativeBriefGenerationPlan; generated?: boolean; saved?: boolean }> {
  const params = new URLSearchParams();
  if (options.force) params.set('force', '1');
  const query = params.toString();
  const data = await apiRequest<{ prompt?: string; record?: unknown; generated?: boolean; saved?: boolean }>(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      force: options.force,
      existingPrompt: options.existingPrompt,
      creativeBrief: options.creativeBrief,
      sourceRelationship: options.sourceRelationship,
      aspectRatio: options.aspectRatio,
      saveAsCurrent: options.saveAsCurrent,
    }),
  });
  return data;
}

export async function getPromptDerivations(imageId: string): Promise<{ imageId: string; derivations: PromptDerivationRecord[] }> {
  return apiRequest(`/api/images/${encodeURIComponent(imageId)}/prompt/derivations`);
}

export async function recordPromptDerivationResult(
  imageId: string,
  payload: {
    derivationId: string;
    provider: GenerationProvider;
    generatedImageId?: string;
    externalJobId?: string;
    actualDimensions?: { width: number; height: number };
    actualAspectRatio?: string;
  },
): Promise<{ imageId: string; derivation: PromptDerivationRecord }> {
  return apiRequest(`/api/images/${encodeURIComponent(imageId)}/prompt/derivations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getConcepts(imageId: string): Promise<{ concepts: ConceptScore[] }> {
  const data = await apiRequest<{ concepts: ConceptScore[] }>(`/api/images/${imageId}/concepts`, {
    method: 'POST',
  });
  return data;
}

export async function getPromptsBulk(imageIds: string[]): Promise<Record<string, string | null>> {
  const params = new URLSearchParams();
  params.set('ids', imageIds.join(','));
  const data = await apiRequest<{ prompts: Record<string, string | null> }>(`/api/images/prompts?${params}`);
  return data.prompts;
}

export async function getPromptRecord(imageId: string): Promise<{ imageId: string; record: unknown | null }> {
  return apiRequest(`/api/images/${imageId}/prompt`);
}

export async function getHaiku(imageId: string): Promise<{ imageId: string; haiku: string; lines: string[] }> {
  return apiRequest(`/api/images/${imageId}/haiku`, { method: 'POST' });
}
