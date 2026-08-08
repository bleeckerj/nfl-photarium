import { describe, expect, it } from 'vitest';

import { sanitizeGeneratedSemanticTags } from '@/server/aiTagParsing';

describe('generated semantic tag parsing', () => {
  it('stores generated multi-word tags as readable phrases', () => {
    expect(sanitizeGeneratedSemanticTags(
      'book-promotion, repair-manual, home-server, cable-spool',
      6,
    )).toEqual(['book promotion', 'repair manual', 'home server', 'cable spool']);
  });

  it('still separates a collapsed multi-tag response', () => {
    expect(sanitizeGeneratedSemanticTags(
      'apple-logo-rainbow-colors-fruit-technology-vintage',
      6,
    )).toEqual(['apple', 'logo', 'rainbow', 'colors', 'fruit', 'technology']);
  });

  it('keeps one requested multi-word tag as one phrase', () => {
    expect(sanitizeGeneratedSemanticTags('repair-manual', 1)).toEqual(['repair manual']);
  });
});
