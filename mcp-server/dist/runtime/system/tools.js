export const systemTools = [
    // ===== System =====
    {
        name: 'photarium_vector_status',
        description: 'Check the status of the vector search system, including Redis availability, embedding progress, and index statistics.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_vector_index',
        description: 'Ensure the vector index exists (creates if missing).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_generate_embeddings',
        description: 'Generate CLIP and/or color embeddings for an image, enabling it to be found via semantic search.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to generate embeddings for',
                },
                clip: {
                    type: 'boolean',
                    description: 'Generate CLIP embedding for semantic search (default: true)',
                },
                color: {
                    type: 'boolean',
                    description: 'Generate color embedding for color search (default: true)',
                },
                force: {
                    type: 'boolean',
                    description: 'Regenerate even if embeddings already exist (default: false)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_embedding_status',
        description: 'Get embedding status (CLIP/color) for a specific image.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to check',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_embeddings_batch',
        description: 'Generate embeddings for multiple images in a single batch request.',
        inputSchema: {
            type: 'object',
            properties: {
                imageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image IDs to process',
                },
                clip: {
                    type: 'boolean',
                    description: 'Generate CLIP embeddings (default: true)',
                },
                color: {
                    type: 'boolean',
                    description: 'Generate color embeddings (default: true)',
                },
                force: {
                    type: 'boolean',
                    description: 'Regenerate even if embeddings already exist',
                },
            },
            required: ['imageIds'],
        },
    },
    {
        name: 'photarium_colors_bulk',
        description: 'Fetch color metadata (dominant colors, average color) for multiple images.',
        inputSchema: {
            type: 'object',
            properties: {
                imageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of image IDs',
                },
            },
            required: ['imageIds'],
        },
    },
    {
        name: 'photarium_audit',
        description: 'Audit CDN URLs and report broken or failing image variants.',
        inputSchema: {
            type: 'object',
            properties: {
                refresh: { type: 'boolean', description: 'Refresh cache before auditing' },
                limit: { type: 'number', description: 'Number of images to check (0 = all)' },
                offset: { type: 'number', description: 'Offset into the image list' },
                concurrency: { type: 'number', description: 'Number of concurrent checks (default: 8)' },
                variant: { type: 'string', description: 'Variant to check (default: public)' },
                verbose: { type: 'boolean', description: 'Include all checks in results' },
            },
        },
    },
    {
        name: 'photarium_backup',
        description: 'Trigger a Redis database backup. Creates both an RDB snapshot and a compressed bundle with AOF files. Automatically rotates old backups.',
        inputSchema: {
            type: 'object',
            properties: {
                keepCount: {
                    type: 'number',
                    description: 'Number of backups to retain (default: 10)',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, show what would be done without actually backing up (default: false)',
                },
            },
        },
    },
    {
        name: 'photarium_list_backups',
        description: 'List existing Redis backups with their timestamps, sizes, and types (RDB snapshots and compressed bundles).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_debug_raw',
        description: 'Fetch raw Cloudflare Images API data for debugging.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
