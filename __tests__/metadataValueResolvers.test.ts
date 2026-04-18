import { describe, expect, it } from 'vitest';

import {
  resolveInitialAltText,
  resolveInitialDescription,
} from '@/components/image-detail/metadataValueResolvers';

describe('metadataValueResolvers', () => {
  it('prefers extras description even when it is an empty string', () => {
    expect(
      resolveInitialDescription(
        { description: '' },
        { description: 'Cloudflare fallback' }
      )
    ).toBe('');
  });

  it('prefers extras alt text even when it is an empty string', () => {
    expect(
      resolveInitialAltText(
        { altText: '' },
        { altTag: 'Cloudflare fallback' }
      )
    ).toBe('');
  });

  it('falls back to image metadata when extras are missing', () => {
    expect(resolveInitialDescription(null, { description: 'Image description' })).toBe('Image description');
    expect(resolveInitialAltText(null, { altTag: 'Image alt text' })).toBe('Image alt text');
  });
});
