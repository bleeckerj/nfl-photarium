import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const demarkTools: Tool[] = [
  {
    name: 'photarium_demark_images',
    description:
      'Process one or more Photarium PNG or JPEG images through noai-watermark and upload each result as a demarked child variant. The default CtrlRegen profile chunks images to reduce peak VRAM use, preserves standard metadata, removes AI metadata, and never overwrites the source.',
    inputSchema: {
      type: 'object',
      properties: {
        imageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more Photarium source image IDs. Duplicate IDs are processed once in first-seen order.',
        },
        mode: {
          type: 'string',
          enum: ['demark', 'metadata'],
          default: 'demark',
          description: 'demark runs diffusion regeneration plus AI-metadata cleanup; metadata removes AI metadata without pixel regeneration. Defaults to demark.',
        },
        strength: {
          type: 'number',
          default: 0.04,
          description: 'Diffusion regeneration strength from 0 to 1. Defaults to 0.04 and is used in demark mode.',
        },
        steps: {
          type: 'integer',
          default: 50,
          description: 'Diffusion denoising steps. Defaults to 50 and is used in demark mode.',
        },
        modelProfile: {
          type: 'string',
          enum: ['default', 'ctrlregen'],
          default: 'ctrlregen',
          description: 'noai-watermark model profile. Defaults to ctrlregen for chunked processing and lower peak VRAM use.',
        },
        device: {
          type: 'string',
          enum: ['auto', 'cpu', 'mps', 'cuda'],
          default: 'auto',
          description: 'Inference device. Defaults to auto.',
        },
        removeAllMetadata: {
          type: 'boolean',
          default: false,
          description: 'Erase standard metadata as well as AI metadata. Defaults to false, preserving standard metadata.',
        },
      },
      required: ['imageIds'],
    },
  },
];
