import { describe, expect, it } from 'vitest';

import {
  matchesAspectRatioClass,
  resolveAspectRatioClass,
} from '@/utils/aspectRatioClass';

describe('aspect ratio class resolution', () => {
  it('uses dimensions when they are present', () => {
    expect(resolveAspectRatioClass({ dimensions: { width: 1000, height: 1000 } })).toBe('square');
    expect(resolveAspectRatioClass({ dimensions: { width: 1200, height: 800 } })).toBe('horizontal');
    expect(resolveAspectRatioClass({ dimensions: { width: 800, height: 1200 } })).toBe('vertical');
  });

  it('falls back to aspect ratio strings when dimensions are missing', () => {
    expect(resolveAspectRatioClass({ aspectRatio: '1:1' })).toBe('square');
    expect(resolveAspectRatioClass({ aspectRatio: '16:9' })).toBe('horizontal');
    expect(resolveAspectRatioClass({ aspectRatio: '4:5' })).toBe('vertical');
  });

  it('falls back to persisted aspect ratio classes', () => {
    expect(resolveAspectRatioClass({ aspectRatioClass: 'square' })).toBe('square');
    expect(matchesAspectRatioClass({ aspectRatioClass: 'horizontal' }, ['horizontal'])).toBe(true);
    expect(matchesAspectRatioClass({ aspectRatioClass: 'vertical' }, ['square'])).toBe(false);
  });
});
