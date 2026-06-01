import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/image-tools/route';
import { ImageToolManifestError, validateImageToolManifest } from '@/server/image-tools/registry';
import type { ImageToolManifest } from '@/server/image-tools/types';

const validManifest: ImageToolManifest = {
  id: 'test-tool',
  label: 'Test Tool',
  description: 'A test tool',
  adapterKind: 'grainrad-http',
  inputAssetTypes: ['image'],
  outputModes: ['still'],
  supportsAsync: false,
  presentation: {
    thumbnailUrl: '/image-tools/test.svg',
    shortDescription: 'Test plugin',
  },
  controls: [
    {
      id: 'effectId',
      label: 'Effect',
      type: 'select',
      options: [{ value: 'threshold', label: 'Threshold' }],
    },
  ],
  defaultRequest: {
    effectId: 'threshold',
    params: {},
    output: {
      mode: 'still',
      format: 'png',
    },
  },
};

describe('image tool manifest validation', () => {
  it('accepts a valid manifest', () => {
    expect(validateImageToolManifest(validManifest)).toBe(validManifest);
  });

  it('rejects missing required fields', () => {
    expect(() => validateImageToolManifest({ ...validManifest, label: '' })).toThrow(ImageToolManifestError);
  });

  it('rejects missing presentation metadata', () => {
    expect(() => validateImageToolManifest({ ...validManifest, presentation: undefined as never })).toThrow(/presentation/i);
  });

  it('rejects unsupported control types', () => {
    expect(() => validateImageToolManifest({
      ...validManifest,
      controls: [{ id: 'bad', label: 'Bad', type: 'unknown' as never }],
    })).toThrow(/unsupported control type/i);
  });

  it('rejects select controls without options', () => {
    expect(() => validateImageToolManifest({
      ...validManifest,
      controls: [{ id: 'empty', label: 'Empty', type: 'select' }],
    })).toThrow(/requires options/i);
  });
});

describe('GET /api/image-tools', () => {
  it('lists the Grainrad manifest', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'grainrad',
          adapterKind: 'grainrad-http',
          supportsAsync: true,
          presentation: expect.objectContaining({
            thumbnailUrl: expect.stringContaining('/image-tools/'),
          }),
          controls: expect.any(Array),
        }),
      ])
    );
  });
});
