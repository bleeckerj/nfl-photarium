/**
 * Photarium MCP Server
 *
 * Exposes the Photarium image gallery API as MCP tools for AI agents.
 *
 * Tools:
 *   - photarium_search: Semantic text search for images
 *   - photarium_similar: Find visually similar images
 *   - photarium_list: List images with optional filters
 *   - photarium_get: Get details for a specific image
 *   - photarium_upload_url: Upload an image from a URL
 *   - photarium_list_folders: List available folders
 *
 * Configuration:
 *   PHOTARIUM_BASE_URL - Base URL of Photarium instance (default: http://localhost:3000)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
// Configuration
const BASE_URL = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
// API Client
async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }
    return response.json();
}
// Tool implementations
async function searchImages(query, limit = 20) {
    const data = await apiRequest('/api/images/search', {
        method: 'POST',
        body: JSON.stringify({ type: 'text', query, limit }),
    });
    return {
        results: data.results.map(formatImageResult),
        query,
        count: data.results.length,
    };
}
async function searchByColor(hexColor, limit = 20) {
    // Normalize hex color
    const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    const data = await apiRequest('/api/images/search', {
        method: 'POST',
        body: JSON.stringify({ type: 'color', query: color, limit }),
    });
    return {
        results: data.results.map(formatImageResult),
        query: color,
        count: data.results.length,
    };
}
async function findSimilar(imageId, type = 'clip', limit = 10) {
    const params = new URLSearchParams({ type, limit: String(limit) });
    const data = await apiRequest(`/api/images/${imageId}/similar?${params}`);
    return {
        results: data.similar.map(formatImageResult),
        query: `similar to ${imageId}`,
        count: data.similar.length,
    };
}
async function listImages(options) {
    const params = new URLSearchParams();
    if (options.namespace)
        params.set('namespace', options.namespace);
    const data = await apiRequest(`/api/images?${params}`);
    let images = data.images;
    // Filter by folder if specified
    if (options.folder) {
        images = images.filter((img) => img.meta?.folder === options.folder);
    }
    // Apply limit
    const limit = options.limit || 50;
    const limited = images.slice(0, limit);
    return {
        images: limited.map(formatImageResult),
        total: images.length,
    };
}
async function getImage(imageId) {
    try {
        const data = await apiRequest(`/api/images/${imageId}`);
        return formatImageResult(data.image);
    }
    catch {
        return null;
    }
}
async function uploadFromUrl(url, options = {}) {
    try {
        // Fetch the image
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
            return { success: false, error: `Failed to fetch image from URL: ${imageResponse.status}` };
        }
        const blob = await imageResponse.blob();
        const filename = url.split('/').pop() || 'uploaded-image';
        // Create form data
        const formData = new FormData();
        formData.append('file', blob, filename);
        if (options.folder)
            formData.append('folder', options.folder);
        if (options.tags)
            formData.append('tags', options.tags.join(','));
        if (options.namespace)
            formData.append('namespace', options.namespace);
        formData.append('originalUrl', url);
        const response = await fetch(`${BASE_URL}/api/upload/external`, {
            method: 'POST',
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) {
            return { success: false, error: result.error || 'Upload failed' };
        }
        return { success: true, imageId: result.id };
    }
    catch (error) {
        return { success: false, error: String(error) };
    }
}
async function listFolders() {
    const data = await apiRequest('/api/folders');
    return data.folders;
}
// Helpers
function formatImageResult(img) {
    return {
        id: img.id,
        filename: img.filename,
        url: img.variants?.public || img.url,
        variants: img.variants,
        meta: img.meta,
        dimensions: img.dimensions,
        score: img.score,
    };
}
// Tool definitions
const TOOLS = [
    {
        name: 'photarium_search',
        description: 'Search for images using natural language. Uses CLIP embeddings for semantic search. Good for finding images by concept, subject, mood, or visual characteristics.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Natural language search query (e.g., "sunset over mountains", "minimalist product photography")',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20, max: 100)',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'photarium_search_color',
        description: 'Search for images by dominant color. Finds images that prominently feature the specified color in their palette.',
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
            },
            required: ['color'],
        },
    },
    {
        name: 'photarium_similar',
        description: 'Find images visually similar to a given image. Can search by visual/semantic similarity (CLIP) or color palette similarity.',
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
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_list',
        description: 'List images from the gallery with optional filtering by folder or namespace.',
        inputSchema: {
            type: 'object',
            properties: {
                folder: {
                    type: 'string',
                    description: 'Filter by folder name',
                },
                namespace: {
                    type: 'string',
                    description: 'Filter by namespace (use "__all__" for all namespaces)',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 50)',
                },
            },
        },
    },
    {
        name: 'photarium_get',
        description: 'Get detailed information about a specific image by its ID, including metadata, dimensions, and variant URLs.',
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
        name: 'photarium_upload_url',
        description: 'Upload an image to the gallery from a URL. The image will be downloaded and stored in Cloudflare Images.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL of the image to upload',
                },
                folder: {
                    type: 'string',
                    description: 'Folder to organize the image in',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to apply to the image',
                },
                namespace: {
                    type: 'string',
                    description: 'Namespace to store the image in',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'photarium_list_folders',
        description: 'List all available folders in the gallery.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
// Server setup
const server = new Server({
    name: 'photarium-mcp',
    version: '0.1.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'photarium_search': {
                const { query, limit } = args;
                const result = await searchImages(query, limit);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_search_color': {
                const { color, limit } = args;
                const result = await searchByColor(color, limit);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_similar': {
                const { imageId, type, limit } = args;
                const result = await findSimilar(imageId, type, limit);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_list': {
                const { folder, namespace, limit } = args;
                const result = await listImages({ folder, namespace, limit });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_get': {
                const { imageId } = args;
                const result = await getImage(imageId);
                if (!result) {
                    return {
                        content: [{ type: 'text', text: 'Image not found' }],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_upload_url': {
                const { url, folder, tags, namespace } = args;
                const result = await uploadFromUrl(url, { folder, tags, namespace });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case 'photarium_list_folders': {
                const folders = await listFolders();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ folders }, null, 2),
                        },
                    ],
                };
            }
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Photarium MCP server running on stdio');
}
main().catch(console.error);
