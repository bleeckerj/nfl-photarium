import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const discoveryTools: Tool[] = [
  // ===== Discovery & Search =====
  {
    name: 'photarium_search',
    description:
      'Semantic search for images using natural language and CLIP embeddings. Finds images by concept, subject, mood, or visual characteristics. Best for finding images that "look like" or "feel like" the query, even if they don\'t contain exact matching text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "sunset over mountains", "minimalist product photography", "vibe coding illustration")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20, max: 100)',
        },
        namespace: {
          type: ['string', 'null'],
          description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'photarium_search_text',
    description:
      'Traditional text search that matches against image metadata: filename, folder name, tags, description, and alt text. Use this when looking for specific files by name or when you know the exact tags/folder.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for in filenames, folders, tags, descriptions (e.g., "hero", "landing-page", "blog-posts")',
        },
        folder: {
          type: 'string',
          description: 'Optional: limit search to a specific folder',
        },
        namespace: {
          type: 'string',
          description: 'Optional: limit search to a specific namespace',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
        refresh: {
          type: 'boolean',
          description: 'If true, refresh the Cloudflare cache before searching',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'photarium_search_metadata',
    description:
      'Field-aware metadata search across image fields: filename, folder, tags, description, alt text, namespace, and source/original URLs. Unlike photarium_search_text (which substring-scans every field at once), this lets you target specific fields, pick a match mode (contains, exact, prefix, regex), toggle case sensitivity, and see which fields matched each result. Best for precise filename or field-scoped lookups (e.g., files whose filename starts with "hero-", or an exact tag).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term or pattern. For match="regex" this is a JavaScript regular expression source (e.g., "^hero-\\d+").',
        },
        fields: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['filename', 'folder', 'tags', 'description', 'altText', 'namespace', 'sourceUrl', 'originalUrl'],
          },
          description: 'Which metadata fields to search. Defaults to all searchable fields.',
        },
        match: {
          type: 'string',
          enum: ['contains', 'exact', 'prefix', 'regex'],
          description: 'Match mode (default: contains). "contains" = substring, "exact" = whole-value equality, "prefix" = startsWith, "regex" = JavaScript RegExp.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive matching (default: false).',
        },
        folder: {
          type: 'string',
          description: 'Optional: limit search to a specific folder',
        },
        namespace: {
          type: 'string',
          description: 'Optional: limit search to a specific namespace',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
        refresh: {
          type: 'boolean',
          description: 'If true, refresh the Cloudflare cache before searching',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'photarium_search_color',
    description:
      'Search for images by dominant color. Finds images that prominently feature the specified color in their palette. Uses color embeddings for accurate color matching.',
    inputSchema: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'Hex color code (e.g., "#3B82F6", "FF5733", "red"). Common colors: #FF0000 (red), #00FF00 (green), #0000FF (blue), #FFFF00 (yellow), #FFA500 (orange), #800080 (purple)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20, max: 100)',
        },
        namespace: {
          type: ['string', 'null'],
          description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
        },
      },
      required: ['color'],
    },
  },
  {
    name: 'photarium_search_image',
    description:
      'Search for images similar to a given image using its CLIP embedding. Useful for quickly finding look-alike images without specifying a text query.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the source image to search from',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20, max: 100)',
        },
        namespace: {
          type: ['string', 'null'],
          description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_similar',
    description:
      'Find images visually similar to a given image. Can search by visual/semantic similarity (CLIP) or color palette similarity.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the source image to find similar images for',
        },
        type: {
          type: 'string',
          enum: ['clip', 'color'],
          description: 'Search type: "clip" for semantic/visual similarity, "color" for color palette similarity (default: clip)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10, max: 50)',
        },
        includeStrangers: {
          type: 'boolean',
          description: 'If true, also return semantically distant images (CLIP-only)',
        },
        offset: {
          type: 'number',
          description: 'Offset for similar results (default: 0)',
        },
        strangersLimit: {
          type: 'number',
          description: 'Maximum strangers to return (default: limit/2)',
        },
        strangersOffset: {
          type: 'number',
          description: 'Offset for strangers results (default: 0)',
        },
        namespace: {
          type: ['string', 'null'],
          description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_antipode',
    description:
      'Find images that are semantic or color opposites of a given image. Useful for finding contrasting images or exploring the opposite end of the visual spectrum.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the source image',
        },
        domain: {
          type: 'string',
          enum: ['clip', 'color'],
          description: 'Search domain: "clip" for semantic opposites, "color" for color opposites (default: clip)',
        },
        method: {
          type: 'string',
          description: 'Search method. CLIP: "negate", "stranger", "otherwise", "reflectroid". Color: "complementary", "histogram", "lightness", "negative"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 8, max: 20)',
        },
        namespace: {
          type: ['string', 'null'],
          description: 'Optional namespace filter. Use "__all__" for all namespaces, "__none__" for no namespace, or a specific namespace string.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_list',
    description:
      'List images from the gallery with optional filtering by folder or namespace. Returns a paginated list of images.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Filter by folder name',
        },
        namespace: {
          type: 'string',
          description: 'Filter by namespace (use "__all__" for all namespaces, "__none__" for images without namespace)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
        page: {
          type: 'number',
          description: 'One-based result page (default: 1)',
        },
        refresh: {
          type: 'boolean',
          description: 'If true, refresh the Cloudflare cache before listing',
        },
        aspectRatioClass: {
          type: 'string',
          description: 'Filter by aspect ratio class: square, horizontal, or vertical',
        },
        aspectRatio: {
          type: 'string',
          description: 'Filter by a specific aspect ratio label (e.g., "4:3", "16:9")',
        },
      },
    },
  },
  {
    name: 'photarium_get',
    description:
      'Get detailed information about a specific image by its ID, including full metadata, folder/tags, aspect ratio/dimensions, file size/type, and variant URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to retrieve',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_image_metadata',
    description:
      'Get normalized metadata for a specific image by ID, including folder, tags, uploaded date, variant/family info, description, alt description, prompt, and dimensions.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to inspect',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_download_image',
    description:
      'Download an image by ID and return base64 data plus metadata. Useful for piping into ComfyUI or other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to download',
        },
        variant: {
          type: 'string',
          description: 'Optional variant (public, full, small, etc.)',
        },
        savePath: {
          type: 'string',
          description: 'Optional path to save the file locally (relative to MCP server working directory or absolute). If a directory, the filename from headers or imageId is used.',
        },
        includeBase64: {
          type: 'boolean',
          description: 'Include base64 in the response (default: false). Set true only when raw bytes are required.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_download_original',
    description:
      'Download the original uploaded artifact bytes for an image ID (preferred when you need embedded metadata like Comfy workflow data).',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to download',
        },
        savePath: {
          type: 'string',
          description: 'Optional path to save the file locally (relative or absolute). If directory-like, the original filename is used.',
        },
        includeBase64: {
          type: 'boolean',
          description: 'Include base64 in the response (default: false). Set true only when raw bytes are required.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_extract_workflow',
    description:
      'Download the original image artifact and extract embedded Comfy workflow/prompt metadata (currently PNG text-chunk extraction).',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to inspect for embedded workflow metadata',
        },
        includeRawMetadata: {
          type: 'boolean',
          description: 'If true, include all extracted PNG text metadata in the response (default: false).',
        },
      },
      required: ['imageId'],
    },
  },
];
