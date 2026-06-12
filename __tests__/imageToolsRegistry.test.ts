import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/image-tools/route';
import { mergeImageToolRequest } from '@/server/image-tools/manifest';
import { ImageToolManifestError, validateImageToolManifest } from '@/server/image-tools/registry';
import type { ImageToolManifest } from '@/server/image-tools/types';

const findControl = (manifest: ImageToolManifest, id: string) =>
  manifest.controls.find((control) => control.id === id);

const validManifest: ImageToolManifest = {
  id: 'test-tool',
  label: 'Test Tool',
  description: 'A test tool',
  adapterKind: 'grainrad-inproc',
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
          adapterKind: 'grainrad-inproc',
          supportsAsync: true,
          presentation: expect.objectContaining({
            thumbnailUrl: expect.stringContaining('/image-tools/'),
          }),
          controls: expect.any(Array),
        }),
      ])
    );
  });

  it('lists implemented Grainrad effects and restored VHS controls', async () => {
    const response = await GET();
    const payload = await response.json();
    const grainrad = (payload.tools as ImageToolManifest[]).find((tool) => tool.id === 'grainrad');
    const effectControl = grainrad ? findControl(grainrad, 'effectId') : undefined;
    const effectIds = effectControl?.options?.map((option) => option.value) ?? [];

    expect(grainrad?.defaultRequest.effectId).toBe('vhs');
    expect(effectIds).toEqual(expect.arrayContaining([
      'vhs',
      'threshold',
      'dithering',
      'halftone',
      'bit-glitch',
      'rgb-subpixel-display',
    ]));
    expect(effectIds).not.toContain('ascii');
    expect(findControl(grainrad!, 'params.jitterAmount')).toEqual(expect.objectContaining({
      effectIds: expect.arrayContaining(['vhs']),
    }));
    expect(findControl(grainrad!, 'params.jitterFrequency')).toBeTruthy();
    expect(findControl(grainrad!, 'params.jitterSpeed')).toBeTruthy();
    expect(findControl(grainrad!, 'params.blur')).toBeTruthy();
    expect(findControl(grainrad!, 'params.desaturation')).toBeTruthy();
    expect(findControl(grainrad!, 'params.contrast')).toBeTruthy();
    expect(findControl(grainrad!, 'params.brightness')).toBeTruthy();
    expect(findControl(grainrad!, 'params.scanlineIntensity')).toBeTruthy();
  });
});

describe('mergeImageToolRequest', () => {
  it('preserves paramPreset when normalizing image tool requests', () => {
    const request = mergeImageToolRequest(validManifest.defaultRequest, {
      effectId: 'rgb-subpixel-display',
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
      params: { waveAmount: 3 },
    });

    expect(request.paramPreset).toBe('diagonal-tear-hold-soft-wave-medium');
    expect(request.effectId).toBe('rgb-subpixel-display');
    expect(request.params).toEqual({ waveAmount: 3 });
  });
});
