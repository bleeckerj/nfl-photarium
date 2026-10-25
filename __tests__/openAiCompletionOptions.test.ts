import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenAiCompletionOptions } from '@/server/openAiCompletionOptions';
import {
  DEFAULT_OPENAI_IMAGE_METADATA_MODEL,
  getOpenAiAltModel,
  getOpenAiDescriptionModel,
  getOpenAiDisplayNameModel,
  getOpenAiPromptThisModel,
  getOpenAiTagsModel,
  getOpenAiHaikuModel,
} from '@/server/openAiGeneratorModels';

const generators = [
  ['OPENAI_ALT_MODEL', getOpenAiAltModel],
  ['OPENAI_DESCRIPTION_MODEL', getOpenAiDescriptionModel],
  ['OPENAI_DISPLAY_NAME_MODEL', getOpenAiDisplayNameModel],
  ['OPENAI_PROMPT_MODEL', getOpenAiPromptThisModel],
  ['OPENAI_TAGS_MODEL', getOpenAiTagsModel],
  ['OPENAI_HAIKU_MODEL', getOpenAiHaikuModel],
] as const;

afterEach(() => vi.unstubAllEnvs());

describe('OpenAI metadata model configuration', () => {
  it.each(generators)('resolves defaults and override precedence for %s', (name, resolve) => {
    for (const [envName] of generators) vi.stubEnv(envName, '');
    vi.stubEnv('OPENAI_IMAGE_METADATA_MODEL', '');
    expect(DEFAULT_OPENAI_IMAGE_METADATA_MODEL).toBe('gpt-5.6-luna');
    expect(resolve()).toBe('gpt-5.6-luna');
    vi.stubEnv('OPENAI_IMAGE_METADATA_MODEL', ' shared-model ');
    expect(resolve()).toBe('shared-model');
    vi.stubEnv(name, ' specific-model ');
    expect(resolve()).toBe('specific-model');
  });

  it('retains the display-name fallback for tags ahead of the shared override', () => {
    vi.stubEnv('OPENAI_TAGS_MODEL', ' ');
    vi.stubEnv('OPENAI_DISPLAY_NAME_MODEL', 'display-model');
    vi.stubEnv('OPENAI_IMAGE_METADATA_MODEL', 'shared-model');
    expect(getOpenAiTagsModel()).toBe('display-model');
  });
});

describe('OpenAI completion request options', () => {
  it.each(['gpt-5.6-luna', 'gpt-5.6-luna-2026-01-01'])('uses compatible non-reasoning options for %s', (model) => {
    expect(getOpenAiCompletionOptions({ model, maxTokens: 120, temperature: 0.2 })).toEqual({
      model, max_completion_tokens: 120, reasoning_effort: 'none',
    });
  });

  it('preserves explicit legacy overrides including their temperature', () => {
    expect(getOpenAiCompletionOptions({ model: 'gpt-4.1-mini', maxTokens: 100, temperature: 0.9 })).toEqual({
      model: 'gpt-4.1-mini', max_tokens: 100, temperature: 0.9,
    });
  });

  it('does not introduce a temperature when the caller omitted it', () => {
    expect(getOpenAiCompletionOptions({ model: 'prompt-model', maxTokens: 4000 })).toEqual({
      model: 'prompt-model', max_tokens: 4000,
    });
  });
});
