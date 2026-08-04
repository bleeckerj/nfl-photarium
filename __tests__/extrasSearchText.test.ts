import { describe, expect, it } from 'vitest';
import { buildExtrasSearchText, type ImageExtrasRecord } from '@/server/imageExtras';

const record = (overrides: Partial<ImageExtrasRecord>): ImageExtrasRecord => ({
  schemaVersion: 1,
  imageId: 'img-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('buildExtrasSearchText', () => {
  it('projects description, alt text, and Prompt This into one lowercased blob', () => {
    const text = buildExtrasSearchText(record({
      description: 'A Red Lighthouse at dawn',
      altText: 'Lighthouse silhouette',
      promptThis: {
        prompt: 'Wide shot of a lighthouse, storm clouds',
        creativeBrief: 'Coastal isolation series',
        model: 'gpt-image-1',
        provider: 'openai',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }));

    expect(text).toContain('a red lighthouse at dawn');
    expect(text).toContain('lighthouse silhouette');
    expect(text).toContain('storm clouds');
    expect(text).toContain('coastal isolation series');
  });

  it('keeps phrase-shaped Comfy prompt candidates and drops bare tokens', () => {
    const text = buildExtrasSearchText(record({
      comfyWorkflow: {
        workflowJson: {},
        promptCandidates: ['neon alleyway in the rain', 'flux', '42'],
        workflowIntentText: 'intent',
        nodeTypeSignatures: [],
        nodeSettingSignatures: [],
        intentTextVersion: 'v1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }));

    expect(text).toContain('neon alleyway in the rain');
    expect(text).not.toContain('flux');
    expect(text).not.toContain('42');
  });

  it('returns an empty string when no searchable extras fields are present', () => {
    expect(buildExtrasSearchText(record({ folder: 'clients' }))).toBe('');
    expect(buildExtrasSearchText(null)).toBe('');
  });
});
