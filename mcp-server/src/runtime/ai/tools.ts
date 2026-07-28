import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const aiTools: Tool[] = [
  // ===== AI Features =====
  {
    name: 'photarium_generate_alt',
    description:
      'Generate accessibility alt text for an image using AI vision. The alt text is saved to the image metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to generate alt text for',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_generate_description',
    description:
      'Generate a detailed description of an image using AI vision. The description is saved to the image metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to describe',
        },
        existingDescription: {
          type: 'string',
          description: 'Optional existing description to provide additional context',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_generate_tags',
    description:
      'Generate semantic tags for an image using AI vision, merge them with existing tags, and save the complete tag set to Photarium.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to tag',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 8,
          description: 'Number of semantic tags to generate. Defaults to 8.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_generate_prompt',
    description:
      'Generate a text-to-image prompt that could recreate the given image. Useful for understanding visual style and for prompt engineering.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to analyze',
        },
        force: {
          type: 'boolean',
          description: 'If true, regenerate prompt even if one exists',
        },
        existingPrompt: {
          type: 'string',
          description: 'Optional existing prompt draft to refine',
        },
        creativeBrief: {
          type: 'string',
          description: 'Optional freeform transformation direction, such as changing the brand, era, materials, product aesthetic, or visual medium.',
        },
        sourceRelationship: {
          type: 'string',
          enum: ['brief_led', 'faithful_adaptation', 'related_design', 'inspired_concept'],
          description: 'Optional relationship to the source. Defaults to brief_led, which adds no hidden distinctness rule.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Optional target aspect ratio such as 1:1, 4:5, 16:9, or 9:16.',
        },
        saveAsCurrent: {
          type: 'boolean',
          description: 'If true, save a creative-brief result as the current Prompt This value. Defaults to false.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_prompt_history',
    description: 'Retrieve creative-brief prompt derivations and any generated child image records for a Photarium image.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: 'The source Photarium image ID.' },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_prepare_creative_brief_generation',
    description: 'Derive and persist a provider-neutral creative-brief generation plan without generating an image.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: 'The source Photarium image ID.' },
        creativeBrief: { type: 'string', description: 'Freeform transformation direction for the source image.' },
        sourceRelationship: {
          type: 'string',
          enum: ['brief_led', 'faithful_adaptation', 'related_design', 'inspired_concept'],
          description: 'Relationship to the source. Defaults to brief_led.',
        },
        aspectRatio: { type: 'string', description: 'Optional target aspect ratio such as 4:5.' },
        existingPrompt: { type: 'string', description: 'Optional prompt draft to revise under the brief.' },
      },
      required: ['imageId', 'creativeBrief'],
    },
  },
  {
    name: 'photarium_record_creative_brief_result',
    description: 'Record a Codex imagegen or ComfyUI result against a previously prepared creative-brief derivation, then generate and save description and alt text for the uploaded child.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: 'The source Photarium image ID.' },
        derivationId: { type: 'string', description: 'The prepared creative-brief derivation ID.' },
        provider: { type: 'string', enum: ['codex_imagegen', 'comfyui', 'photarium_openai'], description: 'Provider that created the result.' },
        generatedImageId: { type: 'string', description: 'Required Photarium ID of the generated child image, after upload and before recording.' },
        externalJobId: { type: 'string', description: 'External provider job ID, if available.' },
        actualDimensions: {
          type: 'object',
          properties: {
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 },
          },
          description: 'Actual generated image dimensions.',
        },
        actualAspectRatio: { type: 'string', description: 'Actual output aspect ratio.' },
      },
      required: ['imageId', 'derivationId', 'provider', 'generatedImageId'],
    },
  },
  {
    name: 'photarium_generate_image',
    description:
      'Generate an image from a text prompt using OpenAI image generation, upload the result to Photarium, and store prompt provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text-to-image prompt.' },
        model: { type: 'string', description: 'OpenAI image model. Defaults to PHOTARIUM_OPENAI_IMAGE_MODEL or gpt-image-2.' },
        size: { type: 'string', description: 'Image size, e.g. 1024x1024, 1536x1024, 1024x1536, or auto when supported.' },
        quality: { type: 'string', description: 'Image quality, e.g. low, medium, high, or auto.' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp'], description: 'Output image format. Defaults to png.' },
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background behavior for GPT image models.' },
        filename: { type: 'string', description: 'Optional filename for the uploaded generated image.' },
        namespace: { type: 'string', description: 'Photarium namespace for the generated image.' },
        folder: { type: 'string', description: 'Photarium folder for the generated image.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply to the generated image.' },
        description: { type: 'string', description: 'Description to store on the generated image.' },
        displayName: { type: 'string', description: 'Display name hint for the generated image filename.' },
        dryRun: { type: 'boolean', description: 'If true, return the planned OpenAI/upload request without generating or uploading.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'photarium_generate_from_references',
    description:
      'Generate a new image from a prompt and one or more Photarium images or URLs used as visual references. This is generative reference use, not exact compositing.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Prompt describing the desired generated image.' },
        references: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'string', description: 'Photarium image ID to use as a reference.' },
              url: { type: 'string', description: 'Direct image URL to use as a reference.' },
              role: {
                type: 'string',
                enum: ['style_reference', 'subject_reference', 'composition_reference', 'brand_reference', 'logo_reference', 'semantic_source'],
                description: 'How the reference image should guide generation.',
              },
              instructions: { type: 'string', description: 'Reference-specific instructions.' },
            },
          },
          description: 'Reference images. Each entry must include imageId or url.',
        },
        model: { type: 'string', description: 'OpenAI image model. Defaults to PHOTARIUM_OPENAI_IMAGE_MODEL or gpt-image-2.' },
        size: { type: 'string', description: 'Image size, e.g. 1024x1024, 1536x1024, 1024x1536, or auto when supported.' },
        quality: { type: 'string', description: 'Image quality, e.g. low, medium, high, or auto.' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp'], description: 'Output image format. Defaults to png.' },
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background behavior for GPT image models.' },
        filename: { type: 'string', description: 'Optional filename for the uploaded generated image.' },
        namespace: { type: 'string', description: 'Photarium namespace for the generated image.' },
        folder: { type: 'string', description: 'Photarium folder for the generated image.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply to the generated image.' },
        description: { type: 'string', description: 'Description to store on the generated image.' },
        displayName: { type: 'string', description: 'Display name hint for the generated image filename.' },
        dryRun: { type: 'boolean', description: 'If true, return the planned OpenAI/upload request without generating or uploading.' },
      },
      required: ['prompt', 'references'],
    },
  },
  {
    name: 'photarium_generate_from_creative_brief',
    description: 'Derive a creative-brief prompt from a Photarium source image and generate with Photarium OpenAI, or return an agent handoff plan for Codex imagegen or ComfyUI.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: 'The primary Photarium source image ID.' },
        creativeBrief: { type: 'string', description: 'Freeform transformation direction.' },
        sourceRelationship: {
          type: 'string',
          enum: ['brief_led', 'faithful_adaptation', 'related_design', 'inspired_concept'],
          description: 'Relationship to the source. Defaults to brief_led.',
        },
        aspectRatio: { type: 'string', description: 'Optional target aspect ratio such as 4:5.' },
        provider: {
          type: 'string',
          enum: ['codex_imagegen', 'comfyui', 'photarium_openai'],
          description: 'Generation provider. Defaults to codex_imagegen for agent handoff; photarium_openai executes inside Photarium MCP.',
        },
        existingPrompt: { type: 'string', description: 'Optional prompt draft to revise under the brief.' },
        model: { type: 'string', description: 'Photarium OpenAI image model when provider is photarium_openai.' },
        size: { type: 'string', description: 'Optional output size override for Photarium OpenAI.' },
        quality: { type: 'string', description: 'Image quality for Photarium OpenAI.' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp'] },
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'] },
        filename: { type: 'string' },
        namespace: { type: 'string' },
        folder: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        displayName: { type: 'string' },
        dryRun: { type: 'boolean', description: 'Return the derived plan and, for Photarium OpenAI, the planned image request without generating.' },
      },
      required: ['imageId', 'creativeBrief'],
    },
  },
  {
    name: 'photarium_aspect_ratio_variant',
    description:
      'Use OpenAI image editing to change a Photarium image ID or direct image URL to a target aspect ratio without cropping, stretching, or padding, then upload the result as a variant when a source image ID is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'Photarium image ID to use as the edit target. Exactly one of imageId or imageUrl is required.',
        },
        imageUrl: {
          type: 'string',
          description: 'Direct image URL to use as the edit target when the source is not already in Photarium. Exactly one of imageId or imageUrl is required.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Target aspect ratio such as 4:5, 1:1, 9:16, or 16:9. Default: 4:5.',
        },
        prompt: {
          type: 'string',
          description: 'Optional extra image-editing instructions. The preservation prompt is always included.',
        },
        model: { type: 'string', description: 'OpenAI image model. Defaults to PHOTARIUM_OPENAI_IMAGE_MODEL or gpt-image-2.' },
        size: {
          type: 'string',
          description: 'Optional OpenAI output size. Defaults to a pixel size matching aspectRatio, e.g. 1024x1280 for 4:5.',
        },
        quality: { type: 'string', description: 'Image quality, e.g. low, medium, high, or auto.' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp'], description: 'Output image format. Defaults to png.' },
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background behavior for GPT image models.' },
        filename: { type: 'string', description: 'Optional filename for the uploaded generated variant.' },
        namespace: { type: 'string', description: 'Photarium namespace for the generated variant. Defaults to the source image namespace when imageId is used.' },
        folder: { type: 'string', description: 'Photarium folder for the generated variant.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply. Defaults to the source image tags when imageId is used.' },
        description: { type: 'string', description: 'Description to store on the generated variant.' },
        displayName: { type: 'string', description: 'Display name hint for the generated variant filename.' },
        parentId: { type: 'string', description: 'Parent image ID for variant relationship. Defaults to imageId when imageId is used.' },
        originalUrl: { type: 'string', description: 'Original URL for provenance. Defaults to the source image originalUrl when available.' },
        sourceUrl: { type: 'string', description: 'Source page URL for provenance. Defaults to the source image sourceUrl when available.' },
        dryRun: { type: 'boolean', description: 'If true, return the planned OpenAI/upload request without generating or uploading.' },
      },
    },
  },
  {
    name: 'photarium_semantic_merge',
    description:
      'Generate a new image by semantically merging multiple Photarium images or URLs. This synthesizes visual/conceptual traits and does not preserve exact placement, exact logos, or pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        mergeBrief: { type: 'string', description: 'Description of how the source images should be semantically merged.' },
        prompt: { type: 'string', description: 'Optional additional output prompt or constraints.' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'string', description: 'Photarium image ID to use as a semantic source.' },
              url: { type: 'string', description: 'Direct image URL to use as a semantic source.' },
              role: {
                type: 'string',
                enum: ['style_reference', 'subject_reference', 'composition_reference', 'brand_reference', 'logo_reference', 'semantic_source'],
                description: 'How the source should guide the semantic merge.',
              },
              instructions: { type: 'string', description: 'Source-specific semantic merge instructions.' },
            },
          },
          description: 'Source images. Each entry must include imageId or url.',
        },
        model: { type: 'string', description: 'OpenAI image model. Defaults to PHOTARIUM_OPENAI_IMAGE_MODEL or gpt-image-2.' },
        size: { type: 'string', description: 'Image size, e.g. 1024x1024, 1536x1024, 1024x1536, or auto when supported.' },
        quality: { type: 'string', description: 'Image quality, e.g. low, medium, high, or auto.' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp'], description: 'Output image format. Defaults to png.' },
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background behavior for GPT image models.' },
        filename: { type: 'string', description: 'Optional filename for the uploaded generated image.' },
        namespace: { type: 'string', description: 'Photarium namespace for the generated image.' },
        folder: { type: 'string', description: 'Photarium folder for the generated image.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply to the generated image.' },
        description: { type: 'string', description: 'Description to store on the generated image.' },
        displayName: { type: 'string', description: 'Display name hint for the generated image filename.' },
        dryRun: { type: 'boolean', description: 'If true, return the planned OpenAI/upload request without generating or uploading.' },
      },
      required: ['mergeBrief', 'sources'],
    },
  },
  {
    name: 'photarium_prompt_get',
    description: 'Get the stored PromptThis record (if any) for an image.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to fetch prompt data for',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_prompts_bulk',
    description: 'Fetch stored prompts for multiple images in a single request.',
    inputSchema: {
      type: 'object',
      properties: {
        imageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of image IDs to fetch prompts for',
        },
      },
      required: ['imageIds'],
    },
  },
  {
    name: 'photarium_concepts',
    description:
      'Get semantic concept scores for an image, showing how the AI interprets its visual qualities along dimensions like warm/cold, minimal/complex, playful/serious, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to analyze',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_haiku',
    description: 'Generate a haiku inspired by the image’s semantic qualities (CLIP embedding).',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to generate a haiku for',
        },
      },
      required: ['imageId'],
    },
  },
];
