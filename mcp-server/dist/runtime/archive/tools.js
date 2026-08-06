export const archiveTools = [
    {
        name: 'archive_catalog_status',
        description: 'Show the status of the offline Lightroom archive catalog, including indexed assets, cached previews, source availability, and the last sync.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'archive_list_catalogs',
        description: 'List Lightroom catalogs imported into the offline archive catalog.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'archive_search',
        description: 'Search Lightroom metadata and archive annotations across the offline photography catalog. Text matches filenames, folders, keywords, captions, collections, and annotations. Trust-related searches may include local semantic expansions such as identity, privacy, security, safety, and reliability.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Words or a phrase to search.' },
                from: { type: 'string', description: 'Optional inclusive capture date or ISO timestamp.' },
                to: { type: 'string', description: 'Optional inclusive capture date or ISO timestamp.' },
                minRating: { type: 'number', description: 'Minimum Lightroom star rating.' },
                pick: { type: 'number', description: 'Lightroom pick flag value.' },
                catalogId: { type: 'string', description: 'Limit to one imported catalog ID.' },
                path: { type: 'string', description: 'Substring filter for folder or source path.' },
                keyword: { type: 'string', description: 'Exact-ish keyword name filter.' },
                collection: { type: 'string', description: 'Collection name filter.' },
                limit: { type: 'number', description: 'Maximum results, capped at 200.' },
                offset: { type: 'number', description: 'Result offset.' },
                expandQuery: { type: 'boolean', description: 'Use the local curated related-term vocabulary (default true).' },
                includePreviews: { type: 'boolean', description: 'Attach cached/generated thumbnails for up to 12 results.' },
            },
        },
    },
    {
        name: 'archive_get_asset',
        description: 'Return the complete indexed metadata for one Lightroom archive asset, including source availability and catalog provenance.',
        inputSchema: { type: 'object', properties: { assetId: { type: 'string' } }, required: ['assetId'] },
    },
    {
        name: 'archive_get_preview',
        description: 'Return one archive thumbnail as an image attachment plus its asset metadata. Cached previews remain available while the NAS is offline.',
        inputSchema: { type: 'object', properties: { assetId: { type: 'string' } }, required: ['assetId'] },
    },
    {
        name: 'archive_list_keywords',
        description: 'List Lightroom keyword terms and the number of indexed archive assets using each term.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
        name: 'archive_list_collections',
        description: 'List Lightroom collections and the number of indexed archive assets in each collection.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
        name: 'archive_save_annotation',
        description: 'Save a separate archive annotation, tag list, or shortlist flag without modifying the Lightroom catalog or source image.',
        inputSchema: {
            type: 'object',
            properties: {
                assetId: { type: 'string' },
                note: { type: ['string', 'null'] },
                tags: { type: 'array', items: { type: 'string' } },
                shortlist: { type: 'boolean' },
            },
            required: ['assetId'],
        },
    },
];
