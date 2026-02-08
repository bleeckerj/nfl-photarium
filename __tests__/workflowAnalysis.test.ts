import { describe, expect, it } from 'vitest';

import {
  analyzeWorkflowIntent,
  buildWorkflowIntentText,
  extractNodeSettingSignatures,
  extractNodeTypeSignatures,
  extractPromptCandidates,
  normalizeWorkflowNodes,
} from '@/server/comfy/workflowAnalysis';

describe('normalizeWorkflowNodes', () => {
  it('normalizes API node-map workflows in stable node order', () => {
    const workflow = {
      '12': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } },
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'golden retriever in snow' } },
      '2': { class_type: 'KSampler', inputs: { steps: 30, cfg: 7.5, seed: 42 } },
    };

    const nodes = normalizeWorkflowNodes(workflow);

    expect(nodes.map((node) => node.id)).toEqual(['1', '2', '12']);
    expect(nodes[0].classType).toBe('CLIPTextEncode');
  });

  it('normalizes UI workflow arrays with id/type fields', () => {
    const workflow = {
      nodes: [
        { id: 5, type: 'KSampler', inputs: { steps: 25, cfg: 6 } },
        { id: 3, type: 'CLIPTextEncode', inputs: { text: 'moody editorial portrait' } },
      ],
    };

    const nodes = normalizeWorkflowNodes(workflow);

    expect(nodes.map((node) => node.id)).toEqual(['3', '5']);
    expect(nodes.map((node) => node.classType)).toEqual(['CLIPTextEncode', 'KSampler']);
  });
});

describe('prompt candidate heuristics', () => {
  it('extracts prompt-like strings from likely text fields and deduplicates them', () => {
    const nodes = normalizeWorkflowNodes({
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'cinematic neon alley, rainy, cyberpunk',
          description: 'cinematic neon alley, rainy, cyberpunk',
        },
      },
      '2': {
        class_type: 'SomeCustomPromptNode',
        inputs: {
          prompt: {
            positive: 'high detail, 35mm still',
            negative: 'blurry, lowres',
          },
        },
      },
      '3': {
        class_type: 'NotPromptNode',
        inputs: { width: 1024 },
      },
    });

    const candidates = extractPromptCandidates(nodes);

    expect(candidates).toEqual([
      'cinematic neon alley, rainy, cyberpunk',
      'high detail, 35mm still',
      'blurry, lowres',
    ]);
  });
});

describe('node signatures', () => {
  it('extracts deterministic node types and setting signatures', () => {
    const nodes = normalizeWorkflowNodes({
      '2': {
        class_type: 'KSampler',
        inputs: { steps: 35, cfg: 8, sampler_name: 'euler', seed: 12345 },
      },
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'dreamshaper_v8.safetensors' },
      },
      '3': {
        class_type: 'KSampler',
        inputs: { steps: 20, cfg: 6 },
      },
    });

    const nodeTypes = extractNodeTypeSignatures(nodes);
    const nodeSettings = extractNodeSettingSignatures(nodes);

    expect(nodeTypes).toEqual(['CheckpointLoaderSimple', 'KSampler']);
    expect(nodeSettings).toEqual([
      'CheckpointLoaderSimple(ckpt_name=dreamshaper_v8.safetensors)',
      'KSampler(steps=20,cfg=6)',
      'KSampler(steps=35,cfg=8,seed=12345,sampler_name=euler)',
    ]);
  });
});

describe('workflow intent text', () => {
  it('builds deterministic intent text from prompts, description, and node signatures', () => {
    const workflow = {
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'futuristic train station, volumetric lighting',
        },
      },
      '2': {
        class_type: 'KSampler',
        inputs: {
          steps: 28,
          cfg: 7,
          sampler_name: 'dpmpp_2m',
        },
      },
    };

    const analysis = analyzeWorkflowIntent({
      workflowJson: workflow,
      imageDescription: {
        altText: 'Wide shot of people waiting in a futuristic transit hall',
        description: 'Steel architecture and cinematic fog',
      },
    });

    expect(analysis.workflowIntentText).toContain('prompt_candidates: futuristic train station, volumetric lighting');
    expect(analysis.workflowIntentText).toContain(
      'image_description: Wide shot of people waiting in a futuristic transit hall | Steel architecture and cinematic fog'
    );
    expect(analysis.workflowIntentText).toContain('node_types: CLIPTextEncode, KSampler');
    expect(analysis.workflowIntentText).toContain('KSampler(steps=28,cfg=7,sampler_name=dpmpp_2m)');

    const secondPass = analyzeWorkflowIntent({
      workflowJson: workflow,
      imageDescription: {
        altText: 'Wide shot of people waiting in a futuristic transit hall',
        description: 'Steel architecture and cinematic fog',
      },
    });

    expect(secondPass.workflowIntentText).toBe(analysis.workflowIntentText);
  });

  it('clamps overly long intent text to max length', () => {
    const longText = 'x'.repeat(500);
    const intent = buildWorkflowIntentText({
      promptCandidates: [longText],
      nodeTypeSignatures: ['CLIPTextEncode'],
      nodeSettingSignatures: [],
      maxLength: 120,
    });

    expect(intent.length).toBeLessThanOrEqual(120);
    expect(intent.endsWith('...')).toBe(true);
  });
});
