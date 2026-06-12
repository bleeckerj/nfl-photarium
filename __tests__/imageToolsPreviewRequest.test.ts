import { describe, expect, it } from 'vitest';

import { buildImageToolPreviewRequest } from '@/server/image-tools/previewRequest';
import type { ImageToolRequest } from '@/server/image-tools/types';

const baseRequest: ImageToolRequest = {
  effectId: 'vhs',
  paramPreset: undefined,
  params: { scanlineIntensity: 0.4 },
  output: { mode: 'still', format: 'png', preset: 'balanced' },
  timeline: { durationMs: 2400, fps: 12, loop: true },
  renderContext: { seed: 1337 },
};

describe('buildImageToolPreviewRequest', () => {
  it('keeps still previews on the still render path', () => {
    const previewRequest = buildImageToolPreviewRequest(baseRequest);

    expect(previewRequest.output).toEqual({
      mode: 'still',
      format: 'png',
      preset: 'preview',
    });
  });

  it('keeps paramPreset on preview requests', () => {
    const previewRequest = buildImageToolPreviewRequest({
      ...baseRequest,
      effectId: 'rgb-subpixel-display',
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
    });

    expect(previewRequest.paramPreset).toBe('diagonal-tear-hold-soft-wave-medium');
  });

  it('renders animated output selections as bounded animated WebP previews when MP4 is selected', () => {
    const previewRequest = buildImageToolPreviewRequest({
      ...baseRequest,
      output: { mode: 'animated', format: 'mp4', preset: 'balanced' },
    });

    expect(previewRequest.output).toEqual({
      mode: 'animated',
      format: 'webp',
      preset: 'preview',
    });
    expect(previewRequest.timeline).toEqual({
      durationMs: 1200,
      fps: 8,
      loop: true,
    });
  });

  it('keeps animated preview formats when previewing animated selections', () => {
    const previewRequest = buildImageToolPreviewRequest({
      ...baseRequest,
      output: { mode: 'animated', format: 'gif', preset: 'balanced' },
      timeline: { durationMs: 800, fps: 6, loop: false },
    });

    expect(previewRequest.output).toEqual({
      mode: 'animated',
      format: 'gif',
      preset: 'preview',
    });
    expect(previewRequest.timeline).toEqual({
      durationMs: 800,
      fps: 6,
      loop: false,
    });
  });
});
