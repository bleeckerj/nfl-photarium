import { describe, expect, it } from 'vitest';

import {
  normalizePromptThisDetailLevel,
  normalizePromptThisNuance,
  PROMPT_THIS_NUANCE_MAX_LENGTH,
} from '@/server/promptThisOptions';

describe('Prompt This options', () => {
  it('defaults a missing detail level to Standard', () => {
    expect(normalizePromptThisDetailLevel(undefined)).toBe('standard');
    expect(normalizePromptThisDetailLevel('')).toBe('standard');
    expect(normalizePromptThisDetailLevel('high')).toBe('high');
  });

  it('rejects unsupported detail levels and nuance values', () => {
    expect(() => normalizePromptThisDetailLevel('extreme')).toThrow('Invalid detailLevel');
    expect(() => normalizePromptThisNuance(42)).toThrow('Invalid promptNuance');
    expect(() => normalizePromptThisNuance('x'.repeat(PROMPT_THIS_NUANCE_MAX_LENGTH + 1)))
      .toThrow(`${PROMPT_THIS_NUANCE_MAX_LENGTH} characters or fewer`);
  });

  it('trims optional nuance and treats blank input as absent', () => {
    expect(normalizePromptThisNuance('  emphasize the edge lighting  ')).toBe('emphasize the edge lighting');
    expect(normalizePromptThisNuance('   ')).toBeUndefined();
  });
});
