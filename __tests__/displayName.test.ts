import { describe, expect, it } from 'vitest';
import {
  fallbackDisplayNameFromFilename,
  sanitizeSuggestedDisplayName,
  toCamelCaseDisplayName,
} from '@/utils/displayName';

describe('displayName utils', () => {
  it('converts words to CamelCase', () => {
    expect(toCamelCaseDisplayName('red sunset over lake')).toBe('RedSunsetOverLake');
  });

  it('prefixes with Image when the token starts with a digit', () => {
    expect(toCamelCaseDisplayName('123 product shot')).toBe('Image123ProductShot');
  });

  it('derives a fallback name from filename', () => {
    expect(fallbackDisplayNameFromFilename('/tmp/mood-board_v2-final.png')).toBe('MoodBoardV2Final');
  });

  it('sanitizes markdown-ish model output', () => {
    expect(sanitizeSuggestedDisplayName('```\n"red sunset over lake"\n```')).toBe('RedSunsetOverLake');
  });
});
