import { describe, expect, it } from 'vitest';
import { looksLikeTrackingOrUtilityAsset } from '@/server/pageImportFilters';

describe('page import media filters', () => {
  it('filters Archive.org telemetry GIFs', () => {
    expect(
      looksLikeTrackingOrUtilityAsset(
        'https://athena.archive.org/0.gif?kind=pageview&service=ao_2'
      )
    ).toBe(true);
  });

  it('keeps ordinary GIF media eligible for review', () => {
    expect(
      looksLikeTrackingOrUtilityAsset('https://example.org/images/portrait.gif')
    ).toBe(false);
  });
});
