import { describe, expect, it, vi } from 'vitest';

import { enrichCreativeBriefImage } from '../mcp-server/src/runtime/ai/creative-brief-enrichment.js';

describe('creative brief metadata enrichment', () => {
  it('generates and returns description and alt text for the generated child', async () => {
    const generateDescription = vi.fn().mockResolvedValue({ description: 'A beige agricultural robot in a field.' });
    const generateAlt = vi.fn().mockResolvedValue({ altTag: 'Beige Apple II-era agricultural robot among crop rows' });

    await expect(enrichCreativeBriefImage('child-1', { generateDescription, generateAlt })).resolves.toEqual({
      status: 'completed',
      imageId: 'child-1',
      description: 'A beige agricultural robot in a field.',
      altText: 'Beige Apple II-era agricultural robot among crop rows',
    });
    expect(generateDescription).toHaveBeenCalledWith('child-1');
    expect(generateAlt).toHaveBeenCalledWith('child-1');
  });

  it('returns partial status when one metadata call fails', async () => {
    const generateDescription = vi.fn().mockRejectedValue(new Error('description service unavailable'));
    const generateAlt = vi.fn().mockResolvedValue({ altTag: 'Agricultural robot in a field' });

    await expect(enrichCreativeBriefImage('child-2', { generateDescription, generateAlt })).resolves.toEqual({
      status: 'partial',
      imageId: 'child-2',
      altText: 'Agricultural robot in a field',
      errors: [{ field: 'description', message: 'description service unavailable' }],
    });
  });

  it('skips enrichment when there is no generated child', async () => {
    const generateDescription = vi.fn();
    const generateAlt = vi.fn();

    await expect(enrichCreativeBriefImage(undefined, { generateDescription, generateAlt })).resolves.toEqual({
      status: 'skipped',
      reason: 'generatedImageId is required before metadata enrichment can run',
    });
    expect(generateDescription).not.toHaveBeenCalled();
    expect(generateAlt).not.toHaveBeenCalled();
  });
});
