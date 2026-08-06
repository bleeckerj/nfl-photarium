import { describe, expect, it } from 'vitest';

import {
  getCorpusSemanticTags,
  getTagSuggestions,
  parseTagDraft,
  serializeTagDraft,
  submitTag,
} from '@/components/image-detail/tagEditor';

describe('tagEditor', () => {
  it('normalizes, sorts, deduplicates, and hides system tags from pills', () => {
    expect(parseTagDraft('zulu, repair-manual, alpha, REPAIR MANUAL, x-search, _favorite_')).toEqual({
      semanticTags: ['alpha', 'repair manual', 'zulu'],
      controlTags: ['x-search'],
    });
  });

  it('serializes semantic pills before preserved control tags', () => {
    expect(serializeTagDraft({
      semanticTags: ['zulu', 'alpha'],
      controlTags: ['x-search', 'x-clip'],
    })).toBe('alpha, zulu, x-clip, x-search');
  });

  it('filters controls, system tags, and operational corpus values', () => {
    expect(getCorpusSemanticTags([
      { value: 'portrait', count: 3 },
      { value: 'x-search', count: 50 },
      { value: '_favorite_', count: 40 },
      { value: 'provider:comfy', count: 20 },
    ])).toEqual([{ value: 'portrait', count: 3 }]);
  });

  it('ranks prefix suggestions before substring suggestions and excludes existing tags', () => {
    const corpus = [
      { value: 'manual repair', count: 100 },
      { value: 'repair manual', count: 1 },
      { value: 'repair kit', count: 2 },
    ];
    expect(getTagSuggestions('repair', corpus, ['repair kit'])).toEqual([
      { value: 'repair manual', count: 1 },
      { value: 'manual repair', count: 100 },
    ]);
  });

  it('applies a unique close corpus match and normalizes custom hyphenated tags', () => {
    expect(submitTag('reflectve', [], [{ value: 'reflective', count: 12 }])).toEqual({
      ok: true,
      tag: 'reflective',
      source: 'corrected',
    });
    expect(submitTag('repair-manual', [], [])).toEqual({
      ok: true,
      tag: 'repair manual',
      source: 'custom',
    });
    expect(submitTag('repair, manual', [], [])).toMatchObject({ ok: false, reason: 'comma' });
    expect(submitTag('repair manual', ['repair manual'], [])).toMatchObject({ ok: false, reason: 'duplicate' });
  });
});
