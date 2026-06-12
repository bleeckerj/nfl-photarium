import { describe, expect, it } from 'vitest';

import { ImageToolsPanel } from '@/components/image-detail/image-tools/ImageToolsPanel';
import {
  buildInitialValues,
  buildRequest,
  groupVisibleControls,
  updateToolValues,
} from '@/components/image-detail/image-tools/controlModel';
import { resolveImageToolPreviewMedia } from '@/components/image-detail/image-tools/previewMedia';
import {
  IMAGE_TOOL_STATUS_TIMEOUT_MESSAGE,
  isImageToolTransientStatusError,
  type ImageToolControl,
  type ImageToolManifest,
} from '@/services/imageToolsService';

const tool = {
  label: 'Grainrad Effects',
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    previewUrl: '/image-tools/grainrad-preview.svg',
  },
} as ImageToolManifest;

const richTool = {
  id: 'grainrad',
  label: 'Grainrad Effects',
  description: 'Render effects',
  adapterKind: 'grainrad-inproc',
  inputAssetTypes: ['image'],
  outputModes: ['still', 'animated'],
  supportsAsync: true,
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    previewUrl: '/image-tools/grainrad-preview.svg',
  },
  controls: [
    {
      id: 'effectId',
      label: 'Effect',
      type: 'select',
      defaultValue: 'vhs',
      group: 'output',
      options: [
        { value: 'vhs', label: 'VHS' },
        { value: 'rgb-subpixel-display', label: 'RGB Display' },
      ],
    },
    {
      id: 'paramPreset',
      label: 'Parameter Preset',
      type: 'select',
      defaultValue: '',
      group: 'presets',
      options: [
        { value: '', label: 'Custom' },
        { value: 'diagonal-tear-hold-soft-wave-medium', label: 'Diagonal Tear', effectId: 'rgb-subpixel-display' },
      ],
    },
    {
      id: 'output.mode',
      label: 'Output',
      type: 'select',
      defaultValue: 'still',
      group: 'output',
      options: [
        { value: 'still', label: 'Still image' },
        { value: 'animated', label: 'Animated export' },
      ],
    },
    {
      id: 'output.format',
      label: 'Format',
      type: 'select',
      defaultValue: 'png',
      group: 'output',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WebP' },
        { value: 'jpg', label: 'JPEG' },
        { value: 'gif', label: 'GIF' },
        { value: 'mp4', label: 'MP4' },
      ],
    },
    {
      id: 'params.jitterAmount',
      label: 'Jitter Amount',
      type: 'slider',
      defaultValue: 0.5,
      min: 0,
      max: 1,
      group: 'general',
      effectIds: ['vhs'],
    },
    {
      id: 'params.verticalHoldAmount',
      label: 'Vertical Hold Amount',
      type: 'slider',
      defaultValue: 0.28,
      min: 0,
      max: 1,
      group: 'vertical-hold',
      effectIds: ['rgb-subpixel-display'],
      advanced: true,
    },
  ],
  defaultRequest: {
    effectId: 'vhs',
    params: {
      jitterAmount: 0.5,
      verticalHoldAmount: 0.28,
    },
    output: { mode: 'still', format: 'png', preset: 'balanced' },
    timeline: { durationMs: 2400, fps: 12, loop: true },
    renderContext: { seed: 1337 },
  },
} satisfies ImageToolManifest;

const controlById = (id: string) => richTool.controls.find((control) => control.id === id) as ImageToolControl;

describe('ImageToolsPanel', () => {
  it('exports the image tools catalog component', () => {
    expect(typeof ImageToolsPanel).toBe('function');
  });

  it('shows generated preview artifacts before source or sample imagery', () => {
    expect(resolveImageToolPreviewMedia({
      tool,
      preview: { artifactUrl: '/api/image-tools/previews/preview-1/artifact' },
      sourcePreviewUrl: 'https://imagedelivery.net/hash/source/public',
    })).toEqual({
      src: '/api/image-tools/previews/preview-1/artifact',
      alt: 'Grainrad Effects generated preview',
      objectFit: 'contain',
      badge: 'Generated preview',
      kind: 'image',
    });
  });

  it('marks generated video preview artifacts as video media', () => {
    expect(resolveImageToolPreviewMedia({
      tool,
      preview: {
        artifactUrl: '/api/image-tools/previews/preview-2/artifact',
        contentType: 'video/mp4',
      },
      sourcePreviewUrl: 'https://imagedelivery.net/hash/source/public',
    })).toEqual({
      src: '/api/image-tools/previews/preview-2/artifact',
      alt: 'Grainrad Effects generated preview',
      objectFit: 'contain',
      badge: 'Generated preview',
      kind: 'video',
    });
  });

  it('keeps animated image preview artifacts on the image renderer', () => {
    expect(resolveImageToolPreviewMedia({
      tool,
      preview: {
        artifactUrl: '/api/image-tools/previews/preview-3/artifact',
        contentType: 'image/webp',
      },
    })).toEqual({
      src: '/api/image-tools/previews/preview-3/artifact',
      alt: 'Grainrad Effects generated preview',
      objectFit: 'contain',
      badge: 'Generated preview',
      kind: 'image',
    });
  });

  it('uses the selected source image before a generated preview exists', () => {
    expect(resolveImageToolPreviewMedia({
      tool,
      sourcePreviewUrl: 'https://imagedelivery.net/hash/source/public',
      sourceLabel: 'source.png',
    })).toEqual({
      src: 'https://imagedelivery.net/hash/source/public',
      alt: 'source.png source image',
      objectFit: 'contain',
      badge: 'Source image',
      kind: 'image',
    });
  });

  it('falls back to the tool sample only when no source image is available', () => {
    expect(resolveImageToolPreviewMedia({ tool })).toEqual({
      src: '/image-tools/grainrad-preview.svg',
      alt: 'Grainrad Effects sample preview',
      objectFit: 'cover',
      badge: 'Tool sample',
      kind: 'image',
    });
  });

  it('builds initial VHS values from the tool default request', () => {
    const values = buildInitialValues(richTool);

    expect(values.effectId).toBe('vhs');
    expect(values['params.jitterAmount']).toBe(0.5);
  });

  it('groups controls for the selected effect and hides unrelated effect controls', () => {
    const values = buildInitialValues(richTool);
    const groups = groupVisibleControls(richTool, values);
    const controlIds = groups.flatMap((group) => group.controls.map((control) => control.id));

    expect(controlIds).toContain('params.jitterAmount');
    expect(controlIds).not.toContain('params.verticalHoldAmount');
    expect(controlIds).not.toContain('paramPreset');
  });

  it('shows preset and advanced RGB display controls after changing effects', () => {
    const values = updateToolValues(richTool, buildInitialValues(richTool), controlById('effectId'), 'rgb-subpixel-display');
    const groups = groupVisibleControls(richTool, values);
    const controlIds = groups.flatMap((group) => group.controls.map((control) => control.id));

    expect(controlIds).toContain('paramPreset');
    expect(controlIds).toContain('params.verticalHoldAmount');
    expect(controlIds).not.toContain('params.jitterAmount');
    expect(groups.find((group) => group.id === 'vertical-hold')?.advanced).toBe(true);
  });

  it('includes paramPreset when building image tool requests', () => {
    const values = {
      ...updateToolValues(richTool, buildInitialValues(richTool), controlById('effectId'), 'rgb-subpixel-display'),
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
    };
    const request = buildRequest(richTool, values);

    expect(request.effectId).toBe('rgb-subpixel-display');
    expect(request.paramPreset).toBe('diagonal-tear-hold-soft-wave-medium');
    expect(request.params).not.toHaveProperty('verticalHoldAmount');
  });

  it('sends changed parameter values as preset overrides', () => {
    const values = {
      ...updateToolValues(richTool, buildInitialValues(richTool), controlById('effectId'), 'rgb-subpixel-display'),
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
      'params.verticalHoldAmount': 0.5,
    };
    const request = buildRequest(richTool, values);

    expect(request.params).toEqual({ verticalHoldAmount: 0.5 });
  });

  it('switches still-only formats to WebP when animated output is selected', () => {
    const values = updateToolValues(richTool, buildInitialValues(richTool), controlById('output.mode'), 'animated');

    expect(values['output.mode']).toBe('animated');
    expect(values['output.format']).toBe('webp');
  });

  it('switches animated-only formats to PNG when still output is selected', () => {
    const animatedValues = {
      ...buildInitialValues(richTool),
      'output.mode': 'animated',
      'output.format': 'mp4',
    };
    const values = updateToolValues(richTool, animatedValues, controlById('output.mode'), 'still');

    expect(values['output.mode']).toBe('still');
    expect(values['output.format']).toBe('png');
  });

  it('treats image tool status timeouts as transient polling errors', () => {
    expect(isImageToolTransientStatusError(new Error(IMAGE_TOOL_STATUS_TIMEOUT_MESSAGE))).toBe(true);
    expect(isImageToolTransientStatusError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isImageToolTransientStatusError(new Error('Image tool preview not found'))).toBe(false);
  });
});
