import {
  appendPromptDerivation,
  createCreativeBriefPlan,
  normalizeAspectRatio,
  normalizeGenerationProvider,
  normalizeSourceRelationship,
  type PromptDerivationRecord,
} from '@/server/creativeBrief';

export type DirectCreativeBriefHandoffInput = {
  prompt: string;
  sourceRelationship?: unknown;
  aspectRatio?: unknown;
  provider?: unknown;
};

export async function prepareDirectCreativeBriefHandoff(
  sourceImageId: string,
  input: DirectCreativeBriefHandoffInput,
) {
  if (!sourceImageId.trim()) throw new Error('Source image ID is required');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('Prompt is required');

  const prompt = input.prompt;
  const provider = normalizeGenerationProvider(input.provider) || 'codex_imagegen';
  const plan = {
    ...createCreativeBriefPlan({
      sourceImageId,
      // Keep the legacy field populated while promptMode identifies direct handoffs.
      creativeBrief: prompt,
      prompt,
      sourceRelationship: normalizeSourceRelationship(input.sourceRelationship),
      aspectRatio: normalizeAspectRatio(input.aspectRatio),
      provider,
      references: [{ imageId: sourceImageId, role: 'subject_reference' as const }],
    }),
    promptMode: 'direct' as const,
    sourceVariant: 'original' as const,
  };
  const timestamp = new Date().toISOString();
  const derivation: PromptDerivationRecord = { ...plan, createdAt: timestamp, updatedAt: timestamp };
  await appendPromptDerivation(derivation);
  return { prompt, plan, derivation };
}
