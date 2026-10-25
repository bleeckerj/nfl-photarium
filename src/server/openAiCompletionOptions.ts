type CompletionOptions = {
  model: string;
  maxTokens: number;
  temperature?: number;
};

type CompletionRequestOptions =
  | { model: string; max_completion_tokens: number; reasoning_effort: 'none' }
  | { model: string; max_tokens: number; temperature?: number };

export function getOpenAiCompletionOptions(options: CompletionOptions): CompletionRequestOptions {
  const { model, maxTokens, temperature } = options;
  // Keep reasoning out of the small output budgets used by metadata generators.
  // Other explicit model overrides retain their existing request contract.
  if (model === 'gpt-5.6-luna' || model.startsWith('gpt-5.6-luna-')) {
    return { model, max_completion_tokens: maxTokens, reasoning_effort: 'none' };
  }
  return { model, max_tokens: maxTokens, ...(temperature === undefined ? {} : { temperature }) };
}
