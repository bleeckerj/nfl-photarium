import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const imageToolRequestSchema = {
  type: 'object',
  description:
    'Partial image-tool request override. Omitted fields are filled from the selected tool manifest defaultRequest.',
  properties: {
    effectId: {
      type: 'string',
      description: 'Effect identifier to run. Defaults to the selected tool manifest defaultRequest.effectId.',
    },
    paramPreset: {
      type: 'string',
      description: 'Optional preset name understood by the selected image tool.',
    },
    params: {
      type: 'object',
      description: 'Tool-specific parameter overrides merged into the manifest defaultRequest.params.',
      additionalProperties: true,
    },
    output: {
      type: 'object',
      description: 'Output overrides merged into the manifest defaultRequest.output.',
      properties: {
        mode: {
          type: 'string',
          enum: ['still', 'animated'],
          description: 'Output mode for the run or preview.',
        },
        format: {
          type: 'string',
          description: 'Output format such as png, webp, or jpg.',
        },
        preset: {
          type: 'string',
          description: 'Optional output preset understood by the selected image tool.',
        },
      },
    },
    timeline: {
      type: 'object',
      description: 'Optional timeline overrides for animated output.',
      properties: {
        durationMs: {
          type: 'number',
          description: 'Animation duration in milliseconds.',
        },
        fps: {
          type: 'number',
          description: 'Frames per second for animated output.',
        },
        loop: {
          type: 'boolean',
          description: 'Whether animated output should loop.',
        },
      },
    },
    renderContext: {
      type: 'object',
      description: 'Optional render context overrides for deterministic previews or animation frames.',
      properties: {
        seed: {
          type: 'number',
          description: 'Deterministic render seed.',
        },
        fps: {
          type: 'number',
          description: 'Frames per second available to the renderer.',
        },
        frameIndex: {
          type: 'number',
          description: 'Frame index to render for preview contexts.',
        },
        time: {
          type: 'number',
          description: 'Timeline time value available to the renderer.',
        },
      },
    },
  },
} as const;

export const imageToolTools: Tool[] = [
  {
    name: 'photarium_image_tools_list',
    description: 'List available Photarium image-tool manifests, including controls and default request shapes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'photarium_image_tool_run',
    description:
      'Start an asynchronous Photarium image-tool run for an image and return the created run record.',
    inputSchema: {
      type: 'object',
      properties: {
        toolId: {
          type: 'string',
          description: 'Image tool ID, such as grainrad.',
        },
        imageId: {
          type: 'string',
          description: 'Photarium image ID to transform.',
        },
        request: imageToolRequestSchema,
      },
      required: ['toolId', 'imageId'],
    },
  },
  {
    name: 'photarium_image_tool_preview',
    description:
      'Start an asynchronous Photarium image-tool preview for an image and return the created preview record.',
    inputSchema: {
      type: 'object',
      properties: {
        toolId: {
          type: 'string',
          description: 'Image tool ID, such as grainrad.',
        },
        imageId: {
          type: 'string',
          description: 'Photarium image ID to preview against.',
        },
        request: imageToolRequestSchema,
      },
      required: ['toolId', 'imageId'],
    },
  },
  {
    name: 'photarium_image_tool_run_get',
    description: 'Fetch a Photarium image-tool run record by run ID.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Run ID returned by photarium_image_tool_run.',
        },
      },
      required: ['runId'],
    },
  },
  {
    name: 'photarium_image_tool_preview_get',
    description: 'Fetch a Photarium image-tool preview record by preview ID.',
    inputSchema: {
      type: 'object',
      properties: {
        previewId: {
          type: 'string',
          description: 'Preview ID returned by photarium_image_tool_preview.',
        },
      },
      required: ['previewId'],
    },
  },
];
