import { describe, expect, it } from 'vitest';
import { createWholeWordMatcher } from '@/utils/wholeWordSearch';

describe('whole-word search', () => {
  it.each(['Turing', 'Alan TURING.', "Turing's portrait", 'alan_turing.jpg', 'alan-turing.jpg', '(Turing)'])('matches %s', (text) => {
    expect(createWholeWordMatcher(' turing ')(text)).toBe(true);
  });

  it.each(['featuring', 'Turington', 'Turing2', '2Turing', 'éTuring', 'Turingé', 'Turing\u0301'])('rejects partial word %s', (text) => {
    expect(createWholeWordMatcher('Turing')(text)).toBe(false);
  });

  it('supports accented words and case-sensitive matching', () => {
    expect(createWholeWordMatcher('café')('A CAFÉ.')).toBe(true);
    expect(createWholeWordMatcher('café')('caféteria')).toBe(false);
    expect(createWholeWordMatcher('Turing', true)('Alan Turing')).toBe(true);
    expect(createWholeWordMatcher('Turing', true)('Alan turing')).toBe(false);
  });

  it('keeps literal phrases and escapes regex characters', () => {
    expect(createWholeWordMatcher('Alan Turing')('Portrait of Alan Turing.')).toBe(true);
    expect(createWholeWordMatcher('Alan Turing')('Alan Turington')).toBe(false);
    expect(createWholeWordMatcher('Alan Turing')('Turing, Alan')).toBe(false);
    expect(createWholeWordMatcher('C++')('Written in C++.')).toBe(true);
    expect(createWholeWordMatcher('a.b')('aXb')).toBe(false);
    expect(createWholeWordMatcher('[Turing]')('[Turing]')).toBe(true);
    expect(createWholeWordMatcher('   ')('anything')).toBe(true);
  });
});
