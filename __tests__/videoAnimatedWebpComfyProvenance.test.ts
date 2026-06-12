import { describe, expect, it } from 'vitest';
import {
  applyVideoAnimatedWebpComfyProvenance,
  buildVideoAnimatedWebpComfyProvenanceMap,
} from '@/server/videoAnimatedWebpComfyProvenance';

describe('video animated WebP Comfy provenance', () => {
  it('maps Comfy video provenance to animated WebP image ids', () => {
    const provenance = buildVideoAnimatedWebpComfyProvenanceMap([
      {
        generatedBy: 'comfyui',
        comfyMetadataDetected: true,
        comfyMetadataSource: 'video:prompt',
        animatedWebpImageId: 'img-latest',
        animatedWebpVariants: [
          {
            imageId: 'img-variant',
            filename: 'clip.webp',
            bytes: 100,
            fps: 12,
            loop: true,
            maxWidth: 960,
            maxHeight: 960,
            maxOutputBytes: 10_000,
            timeoutMs: 45_000,
            createdAt: '2026-06-11T00:00:00.000Z',
          },
        ],
      },
      {
        animatedWebpImageId: 'plain-video-output',
        animatedWebpVariants: [],
      },
    ]);

    expect(provenance.get('img-latest')).toEqual({
      generatedBy: 'comfyui',
      comfyMetadataDetected: true,
      comfyMetadataSource: 'video:prompt',
    });
    expect(provenance.get('img-variant')).toEqual({
      generatedBy: 'comfyui',
      comfyMetadataDetected: true,
      comfyMetadataSource: 'video:prompt',
    });
    expect(provenance.has('plain-video-output')).toBe(false);
  });

  it('annotates derivative images without overwriting direct Comfy metadata', () => {
    const provenance = new Map([
      ['img-1', { generatedBy: 'comfyui', comfyMetadataDetected: true, comfyMetadataSource: 'video:prompt' }],
      ['img-2', { generatedBy: 'comfyui', comfyMetadataDetected: true, comfyMetadataSource: 'video:prompt' }],
    ]);

    expect(applyVideoAnimatedWebpComfyProvenance([
      { id: 'img-1', filename: 'clip.webp' },
      { id: 'img-2', filename: 'still.png', generatedBy: 'comfyui', comfyMetadataSource: 'png:tEXt' },
    ], provenance)).toEqual([
      {
        id: 'img-1',
        filename: 'clip.webp',
        generatedBy: 'comfyui',
        comfyMetadataDetected: true,
        comfyMetadataSource: 'video:prompt',
      },
      {
        id: 'img-2',
        filename: 'still.png',
        generatedBy: 'comfyui',
        comfyMetadataSource: 'png:tEXt',
      },
    ]);
  });
});
