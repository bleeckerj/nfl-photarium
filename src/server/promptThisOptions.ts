export const PROMPT_THIS_DETAIL_LEVELS = ['standard', 'high'] as const;
export type PromptThisDetailLevel = (typeof PROMPT_THIS_DETAIL_LEVELS)[number];

export const PROMPT_THIS_NUANCE_MAX_LENGTH = 2000;

export function normalizePromptThisDetailLevel(value: unknown): PromptThisDetailLevel {
  if (value === undefined || value === null || value === '') return 'standard';
  if (value === 'standard' || value === 'high') return value;
  throw new Error('Invalid detailLevel. Expected "standard" or "high".');
}

export function normalizePromptThisNuance(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid promptNuance. Expected a string.');

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > PROMPT_THIS_NUANCE_MAX_LENGTH) {
    throw new Error(`promptNuance must be ${PROMPT_THIS_NUANCE_MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
}
