const vocabulary: Record<string, string[]> = {
  trust: ['identity', 'privacy', 'security', 'safety', 'reliability', 'verification', 'reputation'],
  trusted: ['identity', 'privacy', 'security', 'safety', 'reliability', 'verification', 'reputation'],
  identity: ['trust', 'privacy', 'security', 'authentication', 'reputation'],
  privacy: ['trust', 'identity', 'security', 'consent', 'data'],
  security: ['trust', 'privacy', 'safety', 'identity', 'verification'],
  nokia: ['mobile', 'phone', 'telecom', 'research', 'design'],
  design: ['prototype', 'research', 'product', 'interface', 'strategy']
};

export function expandTerms(query: string): string[] {
  const additions = new Set<string>();
  for (const token of query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    for (const term of vocabulary[token] ?? []) additions.add(term);
  }
  return [...additions];
}
