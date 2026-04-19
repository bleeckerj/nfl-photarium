import { describe, expect, it } from 'vitest';

import {
  hasDirtyTextMetadata,
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

  it('does not mark extras-backed alt text as dirty when the input matches the initial value', () => {
    expect(
      hasDirtyTextMetadata(
        {
          descriptionInput: 'Cloudflare description',
          altTextInput: 'Extras alt text',
        },
        { altText: 'Extras alt text' },
        {
          description: 'Cloudflare description',
          altTag: 'Cloudflare alt fallback',
        }
      )
    ).toBe(false);
  });

  it('marks text metadata dirty when the input differs from the persisted extras-backed values', () => {
    expect(
      hasDirtyTextMetadata(
        {
          descriptionInput: 'Changed description',
          altTextInput: 'Extras alt text',
        },
        {
          description: 'Persisted description',
          altText: 'Persisted alt text',
        },
        {
          description: 'Cloudflare description',
          altTag: 'Cloudflare alt fallback',
        }
      )
    ).toBe(true);
  });
});
