import { randomUUID } from 'node:crypto';

import { getExtrasStorage } from '@/server/extrasStorage';

export const SOURCE_RELATIONSHIPS = [
  'brief_led',
  'faithful_adaptation',
  'related_design',
  'inspired_concept',
] as const;

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
  provider?: GenerationProvider;
  generatedImageId?: string;
  externalJobId?: string;
  actualDimensions?: {
    width: number;
    height: number;
  };
  actualAspectRatio?: string;
  createdAt: string;
  updatedAt: string;
};

const DERIVATION_KEY_PREFIX = 'prompt-derivations:';

function formatRatioNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
}

export function normalizeAspectRatio(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('aspectRatio must be a string such as 4:5 or 16:9');

  const match = value.trim().match(/^(\d+(?:\.\d+)?)[\s:/x]+(\d+(?:\.\d+)?)$/i);
  if (!match) throw new Error(`Invalid aspectRatio "${value}". Use a ratio like "4:5", "1:1", or "16:9".`);

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid aspectRatio "${value}". Ratio numbers must be positive.`);
  }

  return `${formatRatioNumber(width)}:${formatRatioNumber(height)}`;
}

export function aspectRatioToSize(aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  const [width, height] = aspectRatio.split(':').map(Number);
  const base = 1024;
  if (width === height) return `${base}x${base}`;
  if (width < height) return `${base}x${Math.max(1, Math.round(base * height / width))}`;
  return `${Math.max(1, Math.round(base * width / height))}x${base}`;
}

export function normalizeSourceRelationship(value: unknown): SourceRelationship {
  if (value === undefined || value === null || value === '') return 'brief_led';
  if (typeof value !== 'string' || !SOURCE_RELATIONSHIPS.includes(value as SourceRelationship)) {
    throw new Error(`Invalid sourceRelationship. Use one of: ${SOURCE_RELATIONSHIPS.join(', ')}.`);
  }
  return value as SourceRelationship;
}

export function normalizeGenerationProvider(value: unknown): GenerationProvider | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !GENERATION_PROVIDERS.includes(value as GenerationProvider)) {
    throw new Error(`Invalid provider. Use one of: ${GENERATION_PROVIDERS.join(', ')}.`);
  }
  return value as GenerationProvider;
}

export function createCreativeBriefPlan(params: {
  sourceImageId: string;
  creativeBrief: string;
  prompt: string;
  sourceRelationship?: SourceRelationship;
  aspectRatio?: string;
  provider?: GenerationProvider;
  references?: CreativeBriefReference[];
  derivationId?: string;
}): CreativeBriefGenerationPlan {
  return {
    derivationId: params.derivationId || randomUUID(),
    sourceImageId: params.sourceImageId,
    creativeBrief: params.creativeBrief,
    prompt: params.prompt,
    sourceRelationship: params.sourceRelationship || 'brief_led',
    ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    references: params.references || [{ imageId: params.sourceImageId, role: 'subject_reference' }],
  };
}

function derivationKey(imageId: string): string {
  return `${DERIVATION_KEY_PREFIX}${imageId}`;
}

export async function getPromptDerivations(imageId: string): Promise<PromptDerivationRecord[]> {
  const storage = getExtrasStorage();
  const records = await storage.get<PromptDerivationRecord[]>(derivationKey(imageId));
  return Array.isArray(records) ? records : [];
}

export async function appendPromptDerivation(record: PromptDerivationRecord): Promise<void> {
  const storage = getExtrasStorage();
  const existing = await getPromptDerivations(record.sourceImageId);
  await storage.set(derivationKey(record.sourceImageId), [...existing, record]);
}

export async function updatePromptDerivation(
  sourceImageId: string,
  derivationId: string,
  patch: Partial<Pick<PromptDerivationRecord, 'provider' | 'generatedImageId' | 'externalJobId' | 'actualDimensions' | 'actualAspectRatio'>>,
): Promise<PromptDerivationRecord> {
  const storage = getExtrasStorage();
  const records = await getPromptDerivations(sourceImageId);
  const index = records.findIndex((record) => record.derivationId === derivationId);
  if (index < 0) throw new Error(`Creative brief derivation not found: ${derivationId}`);

  const next = {
    ...records[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  records[index] = next;
  await storage.set(derivationKey(sourceImageId), records);
  return next;
}
