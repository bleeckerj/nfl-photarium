import { describe, expect, it } from 'vitest';

import { applyComfyWorkflowOverrides, type ComfyWorkflow } from '@/server/aspectRatioExpansion/comfyAdapter';

describe('ComfyUI aspect-ratio workflow overrides', () => {
  it('maps source, ratio, prompts, seed, and output prefix into the configured nodes', () => {
    const workflow: ComfyWorkflow = {
      image: { inputs: {} },
      aspect: { inputs: { custom_ratio: true, custom_aspect_ratio: '' } },
      positive: { inputs: {} },
      negative: { inputs: {} },
      seed: { inputs: { seed: 1 } },
      output: { inputs: {} },
    };

    applyComfyWorkflowOverrides({
      workflow,
      imageFilename: 'source.png',
      imageNode: 'image',
      aspectNode: 'aspect',
      positiveNode: 'positive',
      negativeNode: 'negative',
      outputNode: 'output',
      seedNode: 'seed',
      request: {
        aspectRatio: '3:2',
        placement: 'right',
        instructions: 'Continue the street scene.',
        negativePrompt: 'No text.',
        seed: 42,
      },
    });

    expect(workflow.image.inputs?.image).toBe('source.png');
    expect(workflow.aspect.inputs).toMatchObject({
      aspect_ratio: '3:2 (Golden Landscape)',
      custom_ratio: false,
      custom_aspect_ratio: '3:2',
    });
    expect(workflow.positive.inputs?.prompt).toContain('Continue the street scene.');
    expect(workflow.positive.inputs?.prompt).toContain('Keep the main subject dominant');
    expect(workflow.positive.inputs?.prompt).toContain('reasonable close-to-camera presence');
    expect(workflow.positive.inputs?.prompt).toContain('prevents that diminishment');
    expect(workflow.positive.inputs?.prompt).toContain('positioned right');
    expect(workflow.negative.inputs?.prompt).toBe('No text.');
    expect(workflow.seed.inputs?.seed).toBe(42);
    expect(workflow.output.inputs?.filename_prefix).toBe('aspect_3x2');
  });
});
