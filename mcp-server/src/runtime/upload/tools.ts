import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const semanticTagProperties = {
  generateSemanticTags: {
    type: 'boolean',
    description: 'Enable semantic tagging after upload. Defaults to true; set false only for an explicit opt-out.',
  },
  semanticTagCount: {
    type: 'number',
    description: 'Requested number of generated semantic tags. Uses the server default when omitted.',
  },
};

export const uploadTools: Tool[] = [
  {
    name: 'photarium_tag_enrichment_status',
    description: 'Read the durable semantic-tag enrichment job status for an upload.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The semantic-tag job ID returned by an upload.' },
      },
      required: ['jobId'],
    },
  },
  // ===== Upload =====
  {
    name: 'photarium_upload_url',
    description:
      'Upload an image to the gallery from a URL. The image will be downloaded and stored in Cloudflare Images.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the image to upload',
        },
        folder: {
          type: 'string',
          description:
            'Existing folder to file the image in. Normalized to lowercase kebab-case. Filing into a folder that does not exist is rejected unless createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description:
            'Operator authorization to create the folder named in `folder` when it does not already exist. Defaults to false. Do not set this on your own initiative: if an upload is rejected for an unknown folder, file into one of the existing folders the error suggests, or ask the operator whether a new folder is warranted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply to the image',
        },
        description: {
          type: 'string',
          description: 'Optional description for the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload',
        },
        displayName: {
          type: 'string',
          description: 'Optional semantic display name. If omitted, a clean CamelCase name is generated pre-upload.',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for duplicate detection',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL for provenance',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the image in',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent image ID to set variant relationship',
        },
        ...semanticTagProperties,
      },
      required: ['url'],
    },
  },
  {
    name: 'photarium_import_url',
    description:
      'Import a remote image URL and return base64 data + metadata for client-side upload workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the image to import',
        },
        includeData: {
          type: 'boolean',
          description: 'Include base64 image data in response (default: false).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'photarium_upload_file',
    description:
      'Upload a file (base64) to the internal upload endpoint. Supports zip/keynote bundles and metadata fields.',
    inputSchema: {
      type: 'object',
      properties: {
        base64: {
          type: 'string',
          description: 'Base64-encoded file data (optionally a data URL)',
        },
        filename: {
          type: 'string',
          description: 'Filename for the upload (e.g., "image.png" or "bundle.zip")',
        },
        contentType: {
          type: 'string',
          description: 'Optional MIME type override (e.g., image/png)',
        },
        folder: {
          type: 'string',
          description:
            'Existing folder to file the image in. Normalized to lowercase kebab-case. Filing into a folder that does not exist is rejected unless createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description:
            'Operator authorization to create the folder named in `folder` when it does not already exist. Defaults to false. Do not set this on your own initiative: if an upload is rejected for an unknown folder, file into one of the existing folders the error suggests, or ask the operator whether a new folder is warranted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply',
        },
        description: {
          type: 'string',
          description: 'Description to store with the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for duplicate detection',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL for provenance',
        },
        sourcePath: {
          type: 'string',
          description: 'Optional source path for Keynote archives',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the image in',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent image ID to set variant relationship',
        },
        ...semanticTagProperties,
      },
      required: ['base64', 'filename'],
    },
  },
  {
    name: 'photarium_upload_image',
    description:
      'Convenience upload for base64 image data using the canonical upload workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        base64: {
          type: 'string',
          description: 'Base64-encoded image data (optionally a data URL)',
        },
        filename: {
          type: 'string',
          description: 'Filename for the upload (e.g., "image.png")',
        },
        contentType: {
          type: 'string',
          description: 'Optional MIME type override (e.g., image/png)',
        },
        folder: {
          type: 'string',
          description:
            'Existing folder to file the image in. Normalized to lowercase kebab-case. Filing into a folder that does not exist is rejected unless createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description:
            'Operator authorization to create the folder named in `folder` when it does not already exist. Defaults to false. Do not set this on your own initiative: if an upload is rejected for an unknown folder, file into one of the existing folders the error suggests, or ask the operator whether a new folder is warranted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply',
        },
        description: {
          type: 'string',
          description: 'Description to store with the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for duplicate detection',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL for provenance',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the image in',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent image ID to set variant relationship',
        },
        useExternalApi: {
          type: 'boolean',
          description: 'Compatibility override. The canonical /api/upload route is used by default; set true only for legacy external-route callers.',
        },
        ...semanticTagProperties,
      },
      required: ['base64', 'filename'],
    },
  },
  {
    name: 'photarium_upload_external_file',
    description:
      'Upload a file (base64) to the external upload endpoint. Intended for lightweight external tools.',
    inputSchema: {
      type: 'object',
      properties: {
        base64: {
          type: 'string',
          description: 'Base64-encoded image data (optionally a data URL)',
        },
        filename: {
          type: 'string',
          description: 'Filename for the upload (e.g., "image.png")',
        },
        contentType: {
          type: 'string',
          description: 'Optional MIME type override (e.g., image/png)',
        },
        folder: {
          type: 'string',
          description:
            'Existing folder to file the image in. Normalized to lowercase kebab-case. Filing into a folder that does not exist is rejected unless createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description:
            'Operator authorization to create the folder named in `folder` when it does not already exist. Defaults to false. Do not set this on your own initiative: if an upload is rejected for an unknown folder, file into one of the existing folders the error suggests, or ask the operator whether a new folder is warranted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply',
        },
        description: {
          type: 'string',
          description: 'Description to store with the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for duplicate detection',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL for provenance',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the image in',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent image ID to set variant relationship',
        },
        ...semanticTagProperties,
      },
      required: ['base64', 'filename'],
    },
  },
  {
    name: 'photarium_upload_from_path',
    description:
      'Upload a file directly from a file path using multipart form data. No base64 encoding needed. Fast and efficient for local files.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute file path to the image file (e.g., /Users/username/Desktop/image.png)',
        },
        filename: {
          type: 'string',
          description: 'Optional filename override. If not provided, uses the filename from the path.',
        },
        folder: {
          type: 'string',
          description:
            'Existing folder to file the image in. Normalized to lowercase kebab-case. Filing into a folder that does not exist is rejected unless createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description:
            'Operator authorization to create the folder named in `folder` when it does not already exist. Defaults to false. Do not set this on your own initiative: if an upload is rejected for an unknown folder, file into one of the existing folders the error suggests, or ask the operator whether a new folder is warranted.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply',
        },
        description: {
          type: 'string',
          description: 'Description to store with the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for duplicate detection',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL for provenance',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the image in',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent image ID to set variant relationship',
        },
        ...semanticTagProperties,
      },
      required: ['filePath'],
    },
  },
  {
    name: 'photarium_animate',
    description:
      'Create an animated WebP from a sequence of frames (URLs or base64). Uploads the result to Cloudflare Images.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: {
          type: 'array',
          description: 'Array of frames to animate',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['url', 'base64'] },
              url: { type: 'string' },
              data: { type: 'string', description: 'Base64 data for base64 frames (optionally a data URL)' },
              filename: { type: 'string', description: 'Filename for base64 frames' },
              contentType: { type: 'string', description: 'Optional MIME type for base64 frames' },
            },
            required: ['kind'],
          },
        },
        fps: { type: 'number', description: 'Frames per second (default: 1)' },
        loop: { type: 'boolean', description: 'Whether the animation should loop (default: true)' },
        folder: { type: 'string', description: 'Existing folder to file the animation in. Rejected unless it exists or createFolder is set.' },
        createFolder: { type: 'boolean', description: 'Operator authorization to create the folder if missing. Defaults to false; do not set on your own initiative.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' },
        description: { type: 'string', description: 'Description to store with the animation' },
        originalUrl: { type: 'string', description: 'Original URL for provenance' },
        sourceUrl: { type: 'string', description: 'Source page URL' },
        namespace: { type: 'string', description: 'Namespace to store the animation in' },
        parentId: { type: 'string', description: 'Optional parent image ID' },
        filename: { type: 'string', description: 'Optional filename for the resulting animation' },
      },
      required: ['frames'],
    },
  },
  {
    name: 'photarium_crop_variant',
    description:
      'Create a width-preserving aspect-ratio crop from a Photarium image original and upload it as a variant. Supports still images and animated WebP/GIF sources; outputs WebP.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'Photarium image ID to crop from the original uploaded artifact.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Target aspect ratio such as 4:5, 1:1, or 9:16. Default: 4:5.',
        },
        anchor: {
          type: 'string',
          enum: ['top', 'center', 'bottom'],
          description: 'Vertical crop anchor. Default: bottom.',
        },
        quality: {
          type: 'number',
          description: 'WebP output quality from 1 to 100. Default: 90.',
        },
        filename: {
          type: 'string',
          description: 'Optional output filename. The uploaded crop is always encoded as .webp.',
        },
        folder: {
          type: 'string',
          description: 'Existing folder to file the cropped variant in. Rejected unless it exists or createFolder is set.',
        },
        createFolder: {
          type: 'boolean',
          description: 'Operator authorization to create the folder if missing. Defaults to false; do not set on your own initiative.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply. Defaults to the source image tags when omitted.',
        },
        description: {
          type: 'string',
          description: 'Description to store with the cropped variant.',
        },
        prompt: {
          type: 'string',
          description: 'Optional manual prompt text to save to the image PromptThis record after upload.',
        },
        originalUrl: {
          type: 'string',
          description: 'Original URL for provenance. Defaults to the source image originalUrl when available.',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source page URL. Defaults to the source image sourceUrl when available.',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to store the cropped variant in. Defaults to the source image namespace when available.',
        },
        parentId: {
          type: 'string',
          description: 'Parent image ID for variant relationship. Defaults to imageId.',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_uploads_list',
    description: 'List paginated uploads with canonical Cloudflare URLs and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number (default: 1)' },
        pageSize: { type: 'number', description: 'Page size (default: 50)' },
        folder: { type: 'string', description: 'Optional folder filter' },
      },
    },
  },
  {
    name: 'photarium_upload_download',
    description: 'Download an upload by ID and return base64 data + metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        uploadId: { type: 'string', description: 'Upload ID to download' },
      },
      required: ['uploadId'],
    },
  },
  {
    name: 'photarium_fs_ingest',
    description:
      'Recursively ingest local image/video files from a directory tree into a specific namespace via Photarium. Includes subdirectory path in descriptions and can optionally generate image display names/tags with AI.',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string', description: 'Directory to scan recursively' },
        namespace: { type: 'string', description: 'Target namespace (required, must be specific)' },
        apiBase: { type: 'string', description: 'Photarium base URL override (default: PHOTARIUM_BASE_URL)' },
        folder: { type: 'string', description: 'Optional existing folder applied to all uploads. Rejected unless it exists or createFolder is set.' },
        createFolder: { type: 'boolean', description: 'Operator authorization to create the folder if missing. Defaults to false; do not set on your own initiative.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Base tags for all files' },
        descriptionPrefix: { type: 'string', description: 'Optional prefix prepended to generated descriptions' },
        includeFilename: { type: 'boolean', description: 'Include filename in generated description' },
        includePathTags: { type: 'boolean', description: 'Add subdirectory names as tags' },
        aiMetadata: { type: 'boolean', description: 'Generate both displayName and tags for images using AI' },
        aiDisplayName: { type: 'boolean', description: 'Generate image displayName using AI' },
        aiTags: { type: 'boolean', description: 'Generate image tags using AI' },
        generateSemanticTags: { type: 'boolean', description: 'Enable upload-time semantic tagging. Defaults to true; set false only for an explicit opt-out.' },
        tagCount: { type: 'number', description: 'AI tag count target (default: 4)' },
        concurrency: { type: 'number', description: 'Parallel upload concurrency (default: 2)' },
        throttleMs: { type: 'number', description: 'Minimum delay between upload requests in milliseconds (global throttle)' },
        limit: { type: 'number', description: 'Stop after N matching files' },
        dryRun: { type: 'boolean', description: 'Scan only; do not upload' },
        verbose: { type: 'boolean', description: 'Print detailed per-file logs' },
      },
      required: ['rootPath', 'namespace'],
    },
  },
  {
    name: 'photarium_discord_refresh_and_ingest',
    description:
      'Refresh local Discord image exports (newest channel content), then ingest those files into Photarium via fs:ingest. Use this when you need a fresh pull + upload pass.',
    inputSchema: {
      type: 'object',
      properties: {
        discordRepo: { type: 'string', description: 'Path to the local Discord download repo (defaults to /Users/julian/Code/chester-downloads-discord-images)' },
        imagesRoot: { type: 'string', description: 'Directory containing per-channel image subdirectories' },
        namespace: { type: 'string', description: 'Default namespace for ingested assets' },
        visuallyNamespace: { type: 'string', description: 'Namespace for channels containing "visually"' },
        autotraderNamespace: { type: 'string', description: 'Namespace for channels containing "autotrader"' },
        apiBase: { type: 'string', description: 'Base URL for Photarium ingest endpoint' },
        checkpointFile: { type: 'string', description: 'Shared checkpoint file path used by fs:ingest' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Base tags applied during ingest' },
        appendImageTag: { type: 'string', description: 'Extra tag appended per ingest run' },
        descriptionPrefix: { type: 'string', description: 'Prefix prepended to generated descriptions' },
        tagCount: { type: 'number', description: 'AI tag count target passed through to fs:ingest' },
        concurrency: { type: 'number', description: 'Upload concurrency passed through to fs:ingest (default 2)' },
        throttleMs: { type: 'number', description: 'Delay in milliseconds between upload requests in fs:ingest' },
        noAiMetadata: { type: 'boolean', description: 'Disable AI metadata generation' },
        includePathTags: { type: 'boolean', description: 'Add subdirectory names as tags in fs:ingest' },
        includeFilename: { type: 'boolean', description: 'Include filename in generated description in fs:ingest' },
        hashCacheBackfillOnly: { type: 'boolean', description: 'Run fs:ingest in hash-cache-only mode' },
        reportCache: { type: 'boolean', description: 'Run fs:ingest with --report-cache and print checkpoint-hit ratio before uploads' },
        assumeUploaded: { type: 'boolean', description: 'Run fs:ingest with --assume-uploaded (requires hash-cache backfill mode)' },
        skipDiscordRefresh: { type: 'boolean', description: 'Skip Discord download step and only run ingestion' },
        skipIngest: { type: 'boolean', description: 'Skip ingestion step and only run Discord refresh scripts' },
        dryRun: { type: 'boolean', description: 'Forwarded to fs:ingest as dry-run' },
        verbose: { type: 'boolean', description: 'Print detailed logs' },
      },
    },
  },
];
