/**
 * Photarium MCP Server
 * 
 * Exposes the Photarium image gallery API as MCP tools for AI agents.
 * This enables LLMs to browse, search, manage, and curate a Cloudflare Images catalog.
 * 
 * Tools - Discovery & Search:
 *   - photarium_search: Semantic text search using CLIP embeddings
 *   - photarium_search_color: Find images by dominant color
 *   - photarium_similar: Find visually similar images
 *   - photarium_antipode: Find semantic/color opposites
 *   - photarium_list: List images with filters
 *   - photarium_get: Get detailed image info
 * 
 * Tools - Organization:
 *   - photarium_list_folders: List available folders
 *   - photarium_create_folder: Create a new folder
 *   - photarium_list_namespaces: List namespaces
 *   - photarium_update_metadata: Update image metadata
 * 
 * Tools - Upload:
 *   - photarium_upload_url: Upload from URL
 * 
 * Tools - AI Features:
 *   - photarium_generate_alt: Generate alt text
 *   - photarium_generate_description: Generate description
 *   - photarium_generate_prompt: Generate text-to-image prompt
 *   - photarium_concepts: Get semantic concept scores
 * 
 * Tools - System:
 *   - photarium_vector_status: Check embedding/search system status
 *   - photarium_generate_embeddings: Generate embeddings for an image
 * 
 * Configuration:
 *   PHOTARIUM_BASE_URL - Base URL of Photarium instance (default: http://localhost:3000)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration
const BASE_URL = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';

// Types
interface ImageResult {
  id: string;
  filename: string;
  url: string;
  variants?: string[] | Record<string, string>;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  namespace?: string;
  parentId?: string;
  originalUrl?: string;
  sourceUrl?: string;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  score?: number;
  meta?: {
    folder?: string;
    tags?: string[];
    displayName?: string;
    altTag?: string;
    description?: string;
  };
}

interface SearchResult {
  results: ImageResult[];
  query: string;
  count: number;
}

interface ConceptScore {
  dimension: string;
  negative: string;
  positive: string;
  score: number;
}

// API Client
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
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

// Semantic search using CLIP embeddings - finds images by concept/meaning
async function semanticSearch(query: string, limit: number = 20): Promise<SearchResult> {
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'text', query, limit }),
  });

  return {
    results: data.results.map(formatImageResult),
    query,
    count: data.results.length,
  };
}

// Traditional text search - matches filename, folder, tags, description, alt text
async function textSearch(query: string, options: {
  folder?: string;
  namespace?: string;
  limit?: number;
} = {}): Promise<SearchResult> {
  const params = new URLSearchParams();
  params.set('search', query);
  if (options.folder) params.set('folder', options.folder);
  if (options.namespace) params.set('namespace', options.namespace);

  const data = await apiRequest<{ images: ImageResult[] }>(`/api/images?${params}`);
  
  let images = data.images;
  const limit = options.limit || 50;
  const limited = images.slice(0, limit);

  return {
    results: limited.map(formatImageResult),
    query,
    count: limited.length,
  };
}

async function searchByColor(hexColor: string, limit: number = 20): Promise<SearchResult> {
  // Normalize hex color
  const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
  
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'color', query: color, limit }),
  });

  return {
    results: data.results.map(formatImageResult),
    query: color,
    count: data.results.length,
  };
}

async function findSimilar(
  imageId: string,
  type: 'clip' | 'color' = 'clip',
  limit: number = 10
): Promise<SearchResult> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  const data = await apiRequest<{ similar: ImageResult[] }>(
    `/api/images/${imageId}/similar?${params}`
  );

  return {
    results: data.similar.map(formatImageResult),
    query: `similar to ${imageId}`,
    count: data.similar.length,
  };
}

async function listImages(options: {
  folder?: string;
  namespace?: string;
  limit?: number;
}): Promise<{ images: ImageResult[]; total: number }> {
  const params = new URLSearchParams();
  if (options.namespace) params.set('namespace', options.namespace);

  const data = await apiRequest<{ images: ImageResult[] }>(`/api/images?${params}`);
  
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

async function getImage(imageId: string): Promise<ImageResult | null> {
  try {
    const data = await apiRequest<{ image: ImageResult }>(`/api/images/${imageId}`);
    return formatImageResult(data.image);
  } catch {
    return null;
  }
}

async function uploadFromUrl(
  url: string,
  options: { folder?: string; tags?: string[]; namespace?: string } = {}
): Promise<{ success: boolean; imageId?: string; error?: string }> {
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
    if (options.folder) formData.append('folder', options.folder);
    if (options.tags) formData.append('tags', options.tags.join(','));
    if (options.namespace) formData.append('namespace', options.namespace);
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
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function listFolders(namespace?: string): Promise<string[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  const data = await apiRequest<{ folders: string[] }>(`/api/folders?${params}`);
  return data.folders;
}

async function createFolder(name: string): Promise<{ success: boolean; name: string }> {
  return apiRequest<{ success: boolean; name: string }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

async function listNamespaces(): Promise<string[]> {
  const data = await apiRequest<{ namespaces: string[] }>('/api/namespaces');
  return data.namespaces;
}

async function updateMetadata(
  imageId: string,
  updates: {
    folder?: string;
    tags?: string[];
    description?: string | null;
    altTag?: string;
    namespace?: string;
    parentId?: string;
  }
): Promise<ImageResult> {
  const data = await apiRequest<ImageResult>(`/api/images/${imageId}/update`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return formatImageResult(data);
}

async function deleteImage(imageId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/images/${imageId}`, {
    method: 'DELETE',
  });
}

async function findAntipode(
  imageId: string,
  options: {
    domain?: 'clip' | 'color';
    method?: string;
    limit?: number;
  } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (options.domain) params.set('domain', options.domain);
  if (options.method) params.set('method', options.method);
  if (options.limit) params.set('limit', String(options.limit));

  const data = await apiRequest<{ results: ImageResult[] }>(
    `/api/images/${imageId}/antipode?${params}`
  );

  return {
    results: data.results.map(formatImageResult),
    query: `antipode of ${imageId}`,
    count: data.results.length,
  };
}

async function generateAlt(imageId: string): Promise<{ altTag: string }> {
  const data = await apiRequest<{ altTag: string }>(`/api/images/${imageId}/alt`, {
    method: 'POST',
  });
  return data;
}

async function generateDescription(imageId: string): Promise<{ description: string }> {
  const data = await apiRequest<{ description: string }>(`/api/images/${imageId}/description`, {
    method: 'POST',
  });
  return data;
}

async function generatePrompt(imageId: string): Promise<{ prompt: string }> {
  const data = await apiRequest<{ prompt: string }>(`/api/images/${imageId}/prompt`, {
    method: 'POST',
  });
  return data;
}

async function getConcepts(imageId: string): Promise<{ concepts: ConceptScore[] }> {
  const data = await apiRequest<{ concepts: ConceptScore[] }>(`/api/images/${imageId}/concepts`, {
    method: 'POST',
  });
  return data;
}

async function getVectorStatus(): Promise<{
  available: boolean;
  stats?: {
    totalImages: number;
    withClipEmbedding: number;
    withColorEmbedding: number;
    clipProgress: string;
    colorProgress: string;
  };
  needsEmbedding?: number;
}> {
  return apiRequest('/api/images/vectors/status');
}

async function generateEmbeddings(
  imageId: string,
  options: { clip?: boolean; color?: boolean; force?: boolean } = {}
): Promise<{
  imageId: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
  clipGenerated?: boolean;
  colorGenerated?: boolean;
  skipped?: boolean;
}> {
  return apiRequest(`/api/images/${imageId}/embeddings`, {
    method: 'POST',
    body: JSON.stringify({
      clip: options.clip !== false,
      color: options.color !== false,
      force: options.force === true,
    }),
  });
}

interface BackupInfo {
  filename: string;
  timestamp: string;
  size: number;
  sizeHuman: string;
  type: 'rdb' | 'bundle';
  path: string;
}

interface BackupResult {
  success: boolean;
  backup?: {
    rdb: { filename: string; path: string; size: number; sizeHuman: string };
    bundle: { filename: string; path: string; size: number; sizeHuman: string; includesAof: boolean };
  };
  timestamp?: string;
  steps?: string[];
  dryRun?: boolean;
  wouldCreate?: { rdb: string; bundle: string };
}

interface ListBackupsResult {
  backups: BackupInfo[];
  grouped: Record<string, { rdb: BackupInfo | null; bundle: BackupInfo | null }>;
  count: number;
  backupDir: string;
  keepCount: number;
}

async function createBackup(options: { keepCount?: number; dryRun?: boolean } = {}): Promise<BackupResult> {
  return apiRequest('/api/backup', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

async function listBackups(): Promise<ListBackupsResult> {
  return apiRequest('/api/backup');
}

// Helpers
function formatImageResult(img: ImageResult): ImageResult {
  // Handle both array and object variants
  let publicUrl = '';
  if (Array.isArray(img.variants)) {
    publicUrl = img.variants.find((v) => v.includes('/public')) || img.variants[0] || '';
  } else if (img.variants && typeof img.variants === 'object') {
    publicUrl = img.variants.public || Object.values(img.variants)[0] || '';
  }

  return {
    id: img.id,
    filename: img.filename,
    url: publicUrl || img.url,
    variants: img.variants,
    folder: img.folder || img.meta?.folder,
    tags: img.tags || img.meta?.tags,
    description: img.description || img.meta?.description,
    altTag: img.altTag || img.meta?.altTag,
    namespace: img.namespace,
    parentId: img.parentId,
    originalUrl: img.originalUrl,
    sourceUrl: img.sourceUrl,
    hasClipEmbedding: img.hasClipEmbedding,
    hasColorEmbedding: img.hasColorEmbedding,
    dominantColors: img.dominantColors,
    averageColor: img.averageColor,
    aspectRatio: img.aspectRatio,
    dimensions: img.dimensions,
    score: img.score,
  };
}

function formatImageSummary(img: ImageResult): string {
  const parts = [`ID: ${img.id}`];
  if (img.filename) parts.push(`File: ${img.filename}`);
  if (img.folder || img.meta?.folder) parts.push(`Folder: ${img.folder || img.meta?.folder}`);
  if (img.description || img.meta?.description) {
    const desc = img.description || img.meta?.description || '';
    parts.push(`Desc: ${desc.slice(0, 100)}${desc.length > 100 ? '...' : ''}`);
  }
  if (img.tags?.length || img.meta?.tags?.length) {
    parts.push(`Tags: ${(img.tags || img.meta?.tags || []).join(', ')}`);
  }
  if (img.score !== undefined) parts.push(`Score: ${img.score.toFixed(3)}`);
  return parts.join(' | ');
}

// Tool definitions
const TOOLS: Tool[] = [
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
      },
      required: ['color'],
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
      },
    },
  },
  {
    name: 'photarium_get',
    description:
      'Get detailed information about a specific image by its ID, including metadata, dimensions, and variant URLs.',
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

  // ===== Organization =====
  {
    name: 'photarium_list_folders',
    description: 'List all available folders in the gallery, optionally filtered by namespace.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Filter folders by namespace',
        },
      },
    },
  },
  {
    name: 'photarium_create_folder',
    description: 'Create a new folder in the gallery for organizing images.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the folder to create',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'photarium_list_namespaces',
    description: 'List all registered namespaces. Namespaces allow multi-tenant image organization.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'photarium_update_metadata',
    description:
      'Update metadata for an image including folder, tags, description, alt text, and namespace. Can also set parent-child relationships for image variants.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to update',
        },
        folder: {
          type: 'string',
          description: 'Move image to this folder',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace tags with this array',
        },
        description: {
          type: 'string',
          description: 'Set description (use null to clear)',
        },
        altTag: {
          type: 'string',
          description: 'Set accessibility alt text',
        },
        namespace: {
          type: 'string',
          description: 'Move image to this namespace',
        },
        parentId: {
          type: 'string',
          description: 'Set as variant of another image (parent ID)',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_delete',
    description: 'Delete an image from the gallery. This action is permanent and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to delete',
        },
      },
      required: ['imageId'],
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
      },
      required: ['imageId'],
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

  // ===== System =====
  {
    name: 'photarium_vector_status',
    description:
      'Check the status of the vector search system, including Redis availability, embedding progress, and index statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'photarium_generate_embeddings',
    description:
      'Generate CLIP and/or color embeddings for an image, enabling it to be found via semantic search.',
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
    name: 'photarium_backup',
    description:
      'Trigger a Redis database backup. Creates both an RDB snapshot and a compressed bundle with AOF files. Automatically rotates old backups.',
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
    description:
      'List existing Redis backups with their timestamps, sizes, and types (RDB snapshots and compressed bundles).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Server setup
const server = new Server(
  {
    name: 'photarium-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ===== Discovery & Search =====
      case 'photarium_search': {
        const { query, limit } = args as { query: string; limit?: number };
        const result = await semanticSearch(query, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_search_text': {
        const { query, folder, namespace, limit } = args as {
          query: string;
          folder?: string;
          namespace?: string;
          limit?: number;
        };
        const result = await textSearch(query, { folder, namespace, limit });
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
        const { color, limit } = args as { color: string; limit?: number };
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
        const { imageId, type, limit } = args as {
          imageId: string;
          type?: 'clip' | 'color';
          limit?: number;
        };
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

      case 'photarium_antipode': {
        const { imageId, domain, method, limit } = args as {
          imageId: string;
          domain?: 'clip' | 'color';
          method?: string;
          limit?: number;
        };
        const result = await findAntipode(imageId, { domain, method, limit });
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
        const { folder, namespace, limit } = args as {
          folder?: string;
          namespace?: string;
          limit?: number;
        };
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
        const { imageId } = args as { imageId: string };
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

      // ===== Organization =====
      case 'photarium_list_folders': {
        const { namespace } = args as { namespace?: string };
        const folders = await listFolders(namespace);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ folders }, null, 2),
            },
          ],
        };
      }

      case 'photarium_create_folder': {
        const { name } = args as { name: string };
        const result = await createFolder(name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_list_namespaces': {
        const namespaces = await listNamespaces();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ namespaces }, null, 2),
            },
          ],
        };
      }

      case 'photarium_update_metadata': {
        const { imageId, folder, tags, description, altTag, namespace, parentId } = args as {
          imageId: string;
          folder?: string;
          tags?: string[];
          description?: string | null;
          altTag?: string;
          namespace?: string;
          parentId?: string;
        };
        const result = await updateMetadata(imageId, {
          folder,
          tags,
          description,
          altTag,
          namespace,
          parentId,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_delete': {
        const { imageId } = args as { imageId: string };
        const result = await deleteImage(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ===== Upload =====
      case 'photarium_upload_url': {
        const { url, folder, tags, namespace } = args as {
          url: string;
          folder?: string;
          tags?: string[];
          namespace?: string;
        };
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

      // ===== AI Features =====
      case 'photarium_generate_alt': {
        const { imageId } = args as { imageId: string };
        const result = await generateAlt(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_generate_description': {
        const { imageId } = args as { imageId: string };
        const result = await generateDescription(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_generate_prompt': {
        const { imageId } = args as { imageId: string };
        const result = await generatePrompt(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_concepts': {
        const { imageId } = args as { imageId: string };
        const result = await getConcepts(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ===== System =====
      case 'photarium_vector_status': {
        const result = await getVectorStatus();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_generate_embeddings': {
        const { imageId, clip, color, force } = args as {
          imageId: string;
          clip?: boolean;
          color?: boolean;
          force?: boolean;
        };
        const result = await generateEmbeddings(imageId, { clip, color, force });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_backup': {
        const { keepCount, dryRun } = args as { keepCount?: number; dryRun?: boolean };
        const result = await createBackup({ keepCount, dryRun });
        
        // Format a nice summary for the LLM
        let summary = '';
        if (result.dryRun) {
          summary = `[DRY RUN] Would create:\n- RDB: ${result.wouldCreate?.rdb}\n- Bundle: ${result.wouldCreate?.bundle}`;
        } else if (result.success && result.backup) {
          summary = `✓ Backup completed successfully!\n\n`;
          summary += `RDB Snapshot: ${result.backup.rdb.filename} (${result.backup.rdb.sizeHuman})\n`;
          summary += `Bundle: ${result.backup.bundle.filename} (${result.backup.bundle.sizeHuman})`;
          if (!result.backup.bundle.includesAof) {
            summary += ` [RDB only, no AOF]`;
          }
          summary += `\n\nTimestamp: ${result.timestamp}\n\nSteps:\n${result.steps?.map(s => `  - ${s}`).join('\n')}`;
        }

        return {
          content: [
            {
              type: 'text',
              text: summary || JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_list_backups': {
        const result = await listBackups();
        
        // Format a nice summary
        let summary = `📦 Redis Backups (${result.count} backup sets)\n`;
        summary += `Directory: ${result.backupDir}\n`;
        summary += `Retention: ${result.keepCount} backups\n\n`;
        
        if (result.count === 0) {
          summary += 'No backups found.';
        } else {
          const timestamps = Object.keys(result.grouped).sort().reverse();
          for (const ts of timestamps) {
            const group = result.grouped[ts];
            const date = ts.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
            summary += `📁 ${date}\n`;
            if (group.rdb) {
              summary += `   RDB: ${group.rdb.sizeHuman}\n`;
            }
            if (group.bundle) {
              summary += `   Bundle: ${group.bundle.sizeHuman}\n`;
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: summary,
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
  } catch (error) {
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
