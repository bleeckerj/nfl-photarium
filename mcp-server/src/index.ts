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
 *   - (plus uploads, prompts, extras, audits, batch ops, and family management)
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
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
  strangers?: ImageResult[];
  strangersCount?: number;
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

async function apiRequestRaw(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error (${response.status}): ${error}`);
  }

  return response;
}

function parseDataUrl(value: string): { mimeType?: string; data: string } {
  if (!value.startsWith('data:')) {
    return { data: value };
  }
  const [header, data] = value.split(',', 2);
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  return { mimeType: mimeMatch?.[1], data: data || '' };
}

function decodeBase64(value: string): { buffer: Buffer; mimeType?: string } {
  const { mimeType, data } = parseDataUrl(value);
  const buffer = Buffer.from(data, 'base64');
  return { buffer, mimeType };
}

// Tool implementations

// Semantic search using CLIP embeddings - finds images by concept/meaning
async function semanticSearch(
  query: string,
  limit: number = 20,
  namespace?: string | null
): Promise<SearchResult> {
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'text', query, limit, namespace }),
  });

  return {
    results: data.results.map(formatImageResult),
    query,
    count: data.results.length,
  };
}

// Traditional text search - matches filename, folder, tags, description, alt text
async function textSearch(
  query: string,
  options: {
    folder?: string;
    namespace?: string;
    limit?: number;
    refresh?: boolean;
  } = {}
): Promise<SearchResult> {
  const { images } = await listImages({
    folder: options.folder,
    namespace: options.namespace,
    limit: 0,
    refresh: options.refresh,
  });

  const needle = query.toLowerCase();
  const matchesText = (value?: string) => (value || '').toLowerCase().includes(needle);
  const matchesTags = (tags?: string[]) => (tags || []).some((tag) => matchesText(tag));

  const filtered = images.filter((img) => {
    return (
      matchesText(img.filename) ||
      matchesText(img.folder || img.meta?.folder) ||
      matchesText(img.description || img.meta?.description) ||
      matchesText(img.altTag || img.meta?.altTag) ||
      matchesText(img.originalUrl) ||
      matchesText(img.sourceUrl) ||
      matchesTags(img.tags || img.meta?.tags)
    );
  });

  const limit = options.limit || 50;
  const limited = filtered.slice(0, limit);

  return {
    results: limited.map(formatImageResult),
    query,
    count: limited.length,
  };
}

async function searchByColor(
  hexColor: string,
  limit: number = 20,
  namespace?: string | null
): Promise<SearchResult> {
  // Normalize hex color
  const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
  
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'color', query: color, limit, namespace }),
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
  limit: number = 10,
  options: {
    includeStrangers?: boolean;
    offset?: number;
    strangersLimit?: number;
    strangersOffset?: number;
    namespace?: string | null;
  } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (options.includeStrangers) params.set('includeStrangers', 'true');
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.strangersLimit !== undefined) params.set('strangersLimit', String(options.strangersLimit));
  if (options.strangersOffset !== undefined) params.set('strangersOffset', String(options.strangersOffset));
  if (options.namespace !== undefined) params.set('namespace', String(options.namespace));
  const data = await apiRequest<{ results: ImageResult[]; strangers?: ImageResult[] }>(
    `/api/images/${imageId}/similar?${params}`
  );

  const strangers = data.strangers?.map(formatImageResult);
  return {
    results: data.results.map(formatImageResult),
    query: `similar to ${imageId}`,
    count: data.results.length,
    strangers,
    strangersCount: strangers?.length,
  };
}

async function listImages(options: {
  folder?: string;
  namespace?: string;
  limit?: number;
  refresh?: boolean;
  aspectRatioClass?: string;
  aspectRatio?: string;
}): Promise<{ images: ImageResult[]; total: number }> {
  const params = new URLSearchParams();
  if (options.namespace) params.set('namespace', options.namespace);
  if (options.refresh) params.set('refresh', '1');
  if (options.aspectRatioClass) params.set('aspectRatioClass', options.aspectRatioClass);
  if (options.aspectRatio) params.set('aspectRatio', options.aspectRatio);

  const data = await apiRequest<{ images: ImageResult[] }>(`/api/images?${params}`);
  
  let images = data.images;
  
  // Filter by folder if specified
  if (options.folder) {
    images = images.filter((img) => img.meta?.folder === options.folder);
  }

  // Apply limit
  const limit = options.limit ?? 50;
  const limited = limit > 0 ? images.slice(0, limit) : images;

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
  options: {
    folder?: string;
    tags?: string[];
    namespace?: string;
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    parentId?: string;
  } = {}
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
    if (options.description) formData.append('description', options.description);
    formData.append('originalUrl', options.originalUrl || url);
    if (options.sourceUrl) formData.append('sourceUrl', options.sourceUrl);
    if (options.parentId) formData.append('parentId', options.parentId);

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
    displayName?: string | null;
    altTag?: string;
    originalUrl?: string | null;
    sourceUrl?: string | null;
    namespace?: string;
    parentId?: string;
    variationSort?: number;
    clearExif?: boolean;
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
    namespace?: string | null;
  } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (options.domain) params.set('domain', options.domain);
  if (options.method) params.set('method', options.method);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.namespace !== undefined) params.set('namespace', String(options.namespace));

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

async function searchByImage(imageId: string, limit: number = 20, namespace?: string | null): Promise<SearchResult> {
  const data = await apiRequest<{ results: ImageResult[]; count: number }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'image', imageId, limit, namespace }),
  });

  return {
    results: data.results.map(formatImageResult),
    query: `image:${imageId}`,
    count: data.results.length,
  };
}

async function generateDescription(
  imageId: string,
  options: { existingDescription?: string } = {}
): Promise<{ description: string }> {
  const data = await apiRequest<{ description: string }>(`/api/images/${imageId}/description`, {
    method: 'POST',
    body: options.existingDescription ? JSON.stringify({ existingDescription: options.existingDescription }) : undefined,
  });
  return data;
}

async function generatePrompt(
  imageId: string,
  options: { force?: boolean; existingPrompt?: string } = {}
): Promise<{ prompt?: string; record?: unknown; generated?: boolean; saved?: boolean }> {
  const params = new URLSearchParams();
  if (options.force) params.set('force', '1');
  const query = params.toString();
  const data = await apiRequest<{ prompt?: string; record?: unknown; generated?: boolean; saved?: boolean }>(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      force: options.force,
      existingPrompt: options.existingPrompt,
    }),
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

async function getEmbeddingStatus(imageId: string): Promise<{
  imageId: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
  dominantColors?: string[];
  averageColor?: string;
}> {
  return apiRequest(`/api/images/${imageId}/embeddings`);
}

async function batchGenerateEmbeddings(options: {
  imageIds: string[];
  clip?: boolean;
  color?: boolean;
  force?: boolean;
}): Promise<{
  total: number;
  success: number;
  skipped: number;
  errors: number;
  results: Array<{
    imageId: string;
    success: boolean;
    clipGenerated?: boolean;
    colorGenerated?: boolean;
    skipped?: boolean;
    error?: string;
  }>;
}> {
  return apiRequest('/api/images/embeddings/batch', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

async function ensureVectorIndex(): Promise<{ success: boolean; message?: string }> {
  return apiRequest('/api/images/vectors/status', { method: 'POST' });
}

async function getColorsBulk(imageIds: string[]): Promise<Record<string, {
  dominantColors?: string[];
  averageColor?: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
}>> {
  const params = new URLSearchParams();
  params.set('ids', imageIds.join(','));
  const data = await apiRequest<{ colors: Record<string, {
    dominantColors?: string[];
    averageColor?: string;
    hasClipEmbedding: boolean;
    hasColorEmbedding: boolean;
  }> }>(`/api/images/colors?${params}`);
  return data.colors;
}

async function getPromptsBulk(imageIds: string[]): Promise<Record<string, string | null>> {
  const params = new URLSearchParams();
  params.set('ids', imageIds.join(','));
  const data = await apiRequest<{ prompts: Record<string, string | null> }>(`/api/images/prompts?${params}`);
  return data.prompts;
}

async function getPromptRecord(imageId: string): Promise<{ imageId: string; record: unknown | null }> {
  return apiRequest(`/api/images/${imageId}/prompt`);
}

async function generatePromptRecord(imageId: string, options: {
  force?: boolean;
  existingPrompt?: string;
} = {}): Promise<{ imageId: string; record?: unknown; generated?: boolean; saved?: boolean; prompt?: string }> {
  const params = new URLSearchParams();
  if (options.force) params.set('force', '1');
  const query = params.toString();
  return apiRequest(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      force: options.force,
      existingPrompt: options.existingPrompt,
    }),
  });
}

async function getExtras(imageId: string): Promise<{ imageId: string; record: { description?: string; altText?: string } | null }> {
  return apiRequest(`/api/images/${imageId}/extras`);
}

async function updateExtras(imageId: string, updates: { description?: string | null; altText?: string | null }): Promise<{ imageId: string; record: { description?: string; altText?: string } | null }> {
  return apiRequest(`/api/images/${imageId}/extras`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

async function rotateImage(imageId: string, options: { direction?: 'left' | 'right'; degrees?: number; auto?: boolean } = {}): Promise<{
  id: string;
  url: string;
  variants: string[];
  rotatedFromId: string;
  message?: string;
}> {
  return apiRequest(`/api/images/${imageId}/rotate`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

async function getHaiku(imageId: string): Promise<{ imageId: string; haiku: string; lines: string[] }> {
  return apiRequest(`/api/images/${imageId}/haiku`, { method: 'POST' });
}

async function listUploads(options: { page?: number; pageSize?: number; folder?: string } = {}): Promise<{
  page: number;
  pageSize: number;
  hasMore: boolean;
  uploads: Array<{
    uploadId: string;
    cloudflareUrl: string;
    folder?: string;
    filename?: string;
    originalUrl?: string;
    bytes?: number;
    contentHash?: string;
    createdAt?: string;
  }>;
}> {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set('page', String(options.page));
  if (options.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
  if (options.folder) params.set('folder', options.folder);
  return apiRequest(`/api/uploads?${params}`);
}

async function downloadUpload(uploadId: string): Promise<{ filename?: string; contentType?: string; size?: number; base64: string }> {
  const response = await apiRequestRaw(`/api/uploads/${uploadId}/download`, { method: 'GET' });
  const contentType = response.headers.get('content-type') || undefined;
  const disposition = response.headers.get('content-disposition') || undefined;
  const sizeHeader = response.headers.get('content-length') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    filename: filenameMatch?.[1],
    contentType,
    size: sizeHeader ? Number(sizeHeader) : undefined,
    base64,
  };
}

async function downloadImageById(imageId: string, variant?: string): Promise<{ filename?: string; contentType?: string; size?: number; base64: string }> {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
  const contentType = response.headers.get('content-type') || undefined;
  const disposition = response.headers.get('content-disposition') || undefined;
  const sizeHeader = response.headers.get('content-length') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    filename: filenameMatch?.[1],
    contentType,
    size: sizeHeader ? Number(sizeHeader) : undefined,
    base64,
  };
}

async function resolveSavePath(savePath: string, fallbackFilename: string): Promise<string> {
  const resolved = path.isAbsolute(savePath) ? savePath : path.resolve(process.cwd(), savePath);
  const endsWithSeparator = savePath.endsWith(path.sep) || savePath.endsWith('/');
  const hasExtension = Boolean(path.extname(resolved));
  if (endsWithSeparator || !hasExtension) {
    return path.join(resolved, fallbackFilename);
  }
  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      return path.join(resolved, fallbackFilename);
    }
  } catch {
    // path doesn't exist; treat as file path
  }
  return resolved;
}

async function saveBase64ToFile(base64: string, savePath: string, fallbackFilename: string): Promise<string> {
  const targetPath = await resolveSavePath(savePath, fallbackFilename);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(base64, 'base64'));
  return targetPath;
}

async function importFromUrl(url: string): Promise<{
  name: string;
  type: string;
  size: number;
  data: string;
  originalUrl: string;
  captureDate?: string;
  snagxMetadata?: Record<string, unknown>;
  snagxDescription?: string;
}> {
  return apiRequest('/api/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

async function uploadFileBase64(
  endpoint: '/api/upload' | '/api/upload/external',
  payload: {
    base64: string;
    filename: string;
    contentType?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    sourcePath?: string;
    namespace?: string;
    parentId?: string;
  }
): Promise<Record<string, unknown>> {
  const { buffer, mimeType } = decodeBase64(payload.base64);
  const contentType = payload.contentType || mimeType || 'application/octet-stream';
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), payload.filename);
  if (payload.folder) formData.append('folder', payload.folder);
  if (payload.tags?.length) formData.append('tags', payload.tags.join(','));
  if (payload.description) formData.append('description', payload.description);
  if (payload.originalUrl) formData.append('originalUrl', payload.originalUrl);
  if (payload.sourceUrl) formData.append('sourceUrl', payload.sourceUrl);
  if (payload.sourcePath) formData.append('sourcePath', payload.sourcePath);
  if (payload.namespace) formData.append('namespace', payload.namespace);
  if (payload.parentId) formData.append('parentId', payload.parentId);

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Upload failed (${response.status})`);
  }
  return result as Record<string, unknown>;
}

async function createAnimation(options: {
  frames: Array<{ kind: 'url'; url: string } | { kind: 'base64'; data: string; filename: string; contentType?: string }>;
  fps?: number;
  loop?: boolean;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  filename?: string;
}): Promise<Record<string, unknown>> {
  const items: Array<{ kind: 'file'; fileIndex: number } | { kind: 'url'; url: string }> = [];
  const files: Array<{ buffer: Buffer; filename: string; contentType?: string }> = [];

  options.frames.forEach((frame) => {
    if (frame.kind === 'url') {
      items.push({ kind: 'url', url: frame.url });
    } else {
      const { buffer, mimeType } = decodeBase64(frame.data);
      const contentType = frame.contentType || mimeType || 'application/octet-stream';
      const fileIndex = files.length;
      files.push({ buffer, filename: frame.filename, contentType });
      items.push({ kind: 'file', fileIndex });
    }
  });

  const formData = new FormData();
  formData.append('items', JSON.stringify(items));
  if (options.fps !== undefined) formData.append('fps', String(options.fps));
  if (options.loop !== undefined) formData.append('loop', options.loop ? 'true' : 'false');
  if (options.folder) formData.append('folder', options.folder);
  if (options.tags?.length) formData.append('tags', options.tags.join(','));
  if (options.description) formData.append('description', options.description);
  if (options.originalUrl) formData.append('originalUrl', options.originalUrl);
  if (options.sourceUrl) formData.append('sourceUrl', options.sourceUrl);
  if (options.namespace) formData.append('namespace', options.namespace);
  if (options.parentId) formData.append('parentId', options.parentId);
  if (options.filename) formData.append('filename', options.filename);

  files.forEach((file) => {
    formData.append('files', new Blob([new Uint8Array(file.buffer)], { type: file.contentType || 'application/octet-stream' }), file.filename);
  });

  const response = await fetch(`${BASE_URL}/api/animate`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Animation upload failed (${response.status})`);
  }
  return result as Record<string, unknown>;
}

async function auditImages(options: {
  refresh?: boolean;
  limit?: number;
  offset?: number;
  concurrency?: number;
  variant?: string;
  verbose?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', '1');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.concurrency !== undefined) params.set('concurrency', String(options.concurrency));
  if (options.variant) params.set('variant', options.variant);
  if (options.verbose) params.set('verbose', '1');
  return apiRequest(`/api/images/audit?${params}`);
}

async function swapImageParent(imageId: string, options: { newParentId: string; concurrency?: number; dryRun?: boolean }): Promise<Record<string, unknown>> {
  return apiRequest(`/api/images/${imageId}/swap-parent`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

async function deleteImageFamily(imageId: string, options: { confirm?: string; dryRun?: boolean; concurrency?: number; async?: boolean } = {}): Promise<Record<string, unknown>> {
  return apiRequest(`/api/images/${imageId}/delete-family`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

async function getDeleteFamilyJob(jobId: string): Promise<Record<string, unknown>> {
  return apiRequest(`/api/jobs/delete-family/${jobId}`);
}

async function getDebugRaw(): Promise<Record<string, unknown>> {
  return apiRequest('/api/debug');
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

function buildShareUrl(imageId: string, variant?: string): string {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  return `${BASE_URL}/api/images/${imageId}/share${params.toString() ? `?${params}` : ''}`;
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
          description: 'If false and savePath is provided, omit base64 from the response (default: true).',
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
          type: ['string', 'null'],
          description: 'Set description (use null to clear)',
        },
        displayName: {
          type: ['string', 'null'],
          description: 'Set display name (use null or empty to clear)',
        },
        altTag: {
          type: 'string',
          description: 'Set accessibility alt text',
        },
        originalUrl: {
          type: ['string', 'null'],
          description: 'Set the original source URL (use null or empty to clear)',
        },
        sourceUrl: {
          type: ['string', 'null'],
          description: 'Set the page/source URL (use null or empty to clear)',
        },
        namespace: {
          type: 'string',
          description: 'Move image to this namespace',
        },
        parentId: {
          type: 'string',
          description: 'Set as variant of another image (parent ID)',
        },
        variationSort: {
          type: 'number',
          description: 'Set ordering value for variants within a family',
        },
        clearExif: {
          type: 'boolean',
          description: 'If true, remove stored EXIF metadata',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_extras_get',
    description: 'Get additional image extras (stored outside Cloudflare metadata), such as custom descriptions or alt text overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to retrieve extras for',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_extras_update',
    description: 'Update image extras (stored outside Cloudflare metadata). Set description/altText to null to clear.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to update',
        },
        description: {
          type: ['string', 'null'],
          description: 'Override description (null clears)',
        },
        altText: {
          type: ['string', 'null'],
          description: 'Override alt text (null clears)',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_swap_parent',
    description: 'Swap the parent image for a family of variants. New parent must be in the same family.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'Any image ID in the family (the requested target)',
        },
        newParentId: {
          type: 'string',
          description: 'The image ID that should become the new parent',
        },
        concurrency: {
          type: 'number',
          description: 'Max concurrent Cloudflare updates (default: 3, max: 8)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, returns planned updates without applying changes',
        },
      },
      required: ['imageId', 'newParentId'],
    },
  },
  {
    name: 'photarium_delete_family',
    description: 'Delete an image family (parent + variants). Can run async and returns a jobId for polling.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'Image ID belonging to the family to delete',
        },
        confirm: {
          type: 'string',
          description: 'Required unless dryRun=true. Must be "DELETE_FAMILY"',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, returns which IDs would be deleted without deleting',
        },
        concurrency: {
          type: 'number',
          description: 'Max concurrent Cloudflare deletes (default: 3, max: 8)',
        },
        async: {
          type: 'boolean',
          description: 'If true, run in background and return a jobId',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_delete_family_job',
    description: 'Fetch status for an async delete-family job by jobId.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID returned from photarium_delete_family with async=true',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'photarium_share_url',
    description: 'Get a share URL for an image and variant size (redirect endpoint).',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The image ID to share',
        },
        variant: {
          type: 'string',
          description: 'Variant to use (e.g., public, thumbnail, small, medium, large, xlarge)',
        },
      },
      required: ['imageId'],
    },
  },
  {
    name: 'photarium_rotate',
    description: 'Rotate an image server-side and re-upload it as a new Cloudflare image.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The image ID to rotate',
        },
        direction: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Rotate 90° left or right',
        },
        degrees: {
          type: 'number',
          description: 'Custom rotation degrees (overrides direction)',
        },
        auto: {
          type: 'boolean',
          description: 'If true, auto-rotate based on EXIF orientation',
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
        description: {
          type: 'string',
          description: 'Optional description for the image',
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
          description: 'Folder to organize the image in',
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
      },
      required: ['base64', 'filename'],
    },
  },
  {
    name: 'photarium_upload_image',
    description:
      'Convenience upload for base64 image data (defaults to external upload API).',
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
          description: 'Folder to organize the image in',
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
          description: 'If true (default), use /api/upload/external; if false, use /api/upload',
        },
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
          description: 'Folder to organize the image in',
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
      },
      required: ['base64', 'filename'],
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
        folder: { type: 'string', description: 'Folder to organize the image in' },
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
      },
      required: ['imageId'],
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
    name: 'photarium_vector_index',
    description: 'Ensure the vector index exists (creates if missing).',
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
  {
    name: 'photarium_debug_raw',
    description: 'Fetch raw Cloudflare Images API data for debugging.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Server setup
const server = new Server(
  {
    name: 'photarium-mcp-server',
    version: '0.3.0',
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
        const { query, limit, namespace } = args as { query: string; limit?: number; namespace?: string | null };
        const result = await semanticSearch(query, limit, namespace);
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
        const { query, folder, namespace, limit, refresh } = args as {
          query: string;
          folder?: string;
          namespace?: string;
          limit?: number;
          refresh?: boolean;
        };
        const result = await textSearch(query, { folder, namespace, limit, refresh });
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
        const { color, limit, namespace } = args as { color: string; limit?: number; namespace?: string | null };
        const result = await searchByColor(color, limit, namespace);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_search_image': {
        const { imageId, limit, namespace } = args as { imageId: string; limit?: number; namespace?: string | null };
        const result = await searchByImage(imageId, limit, namespace);
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
        const { imageId, type, limit, includeStrangers, offset, strangersLimit, strangersOffset, namespace } = args as {
          imageId: string;
          type?: 'clip' | 'color';
          limit?: number;
          includeStrangers?: boolean;
          offset?: number;
          strangersLimit?: number;
          strangersOffset?: number;
          namespace?: string | null;
        };
        const result = await findSimilar(imageId, type, limit, {
          includeStrangers,
          offset,
          strangersLimit,
          strangersOffset,
          namespace,
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

      case 'photarium_antipode': {
        const { imageId, domain, method, limit, namespace } = args as {
          imageId: string;
          domain?: 'clip' | 'color';
          method?: string;
          limit?: number;
          namespace?: string | null;
        };
        const result = await findAntipode(imageId, { domain, method, limit, namespace });
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
        const { folder, namespace, limit, refresh, aspectRatioClass, aspectRatio } = args as {
          folder?: string;
          namespace?: string;
          limit?: number;
          refresh?: boolean;
          aspectRatioClass?: string;
          aspectRatio?: string;
        };
        const result = await listImages({ folder, namespace, limit, refresh, aspectRatioClass, aspectRatio });
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

      case 'photarium_download_image': {
        const { imageId, variant, savePath, includeBase64 } = args as { imageId: string; variant?: string; savePath?: string; includeBase64?: boolean };
        const result = await downloadImageById(imageId, variant);
        let savedPath: string | undefined;
        if (savePath) {
          const fallbackFilename = result.filename || `${imageId}${variant ? `_${variant}` : ''}.bin`;
          savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
        }
        const response = includeBase64 === false && savePath
          ? { ...result, base64: undefined, savedPath }
          : { ...result, savedPath };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
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
        const { imageId, folder, tags, description, displayName, altTag, originalUrl, sourceUrl, namespace, parentId, variationSort, clearExif } = args as {
          imageId: string;
          folder?: string;
          tags?: string[];
          description?: string | null;
          displayName?: string | null;
          altTag?: string;
          originalUrl?: string | null;
          sourceUrl?: string | null;
          namespace?: string;
          parentId?: string;
          variationSort?: number;
          clearExif?: boolean;
        };
        const result = await updateMetadata(imageId, {
          folder,
          tags,
          description,
          displayName,
          altTag,
          originalUrl,
          sourceUrl,
          namespace,
          parentId,
          variationSort,
          clearExif,
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

      case 'photarium_extras_get': {
        const { imageId } = args as { imageId: string };
        const result = await getExtras(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_extras_update': {
        const { imageId, description, altText } = args as {
          imageId: string;
          description?: string | null;
          altText?: string | null;
        };
        const result = await updateExtras(imageId, { description, altText });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_swap_parent': {
        const { imageId, newParentId, concurrency, dryRun } = args as {
          imageId: string;
          newParentId: string;
          concurrency?: number;
          dryRun?: boolean;
        };
        const result = await swapImageParent(imageId, { newParentId, concurrency, dryRun });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_delete_family': {
        const { imageId, confirm, dryRun, concurrency, async } = args as {
          imageId: string;
          confirm?: string;
          dryRun?: boolean;
          concurrency?: number;
          async?: boolean;
        };
        const result = await deleteImageFamily(imageId, { confirm, dryRun, concurrency, async });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_delete_family_job': {
        const { jobId } = args as { jobId: string };
        const result = await getDeleteFamilyJob(jobId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_share_url': {
        const { imageId, variant } = args as { imageId: string; variant?: string };
        const result = { imageId, variant: variant || 'large', url: buildShareUrl(imageId, variant) };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_rotate': {
        const { imageId, direction, degrees, auto } = args as {
          imageId: string;
          direction?: 'left' | 'right';
          degrees?: number;
          auto?: boolean;
        };
        const result = await rotateImage(imageId, { direction, degrees, auto });
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
        const { url, folder, tags, namespace, description, originalUrl, sourceUrl, parentId } = args as {
          url: string;
          folder?: string;
          tags?: string[];
          namespace?: string;
          description?: string;
          originalUrl?: string;
          sourceUrl?: string;
          parentId?: string;
        };
        const result = await uploadFromUrl(url, { folder, tags, namespace, description, originalUrl, sourceUrl, parentId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_import_url': {
        const { url } = args as { url: string };
        const result = await importFromUrl(url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_upload_file': {
        const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, sourcePath, namespace, parentId } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          originalUrl?: string;
          sourceUrl?: string;
          sourcePath?: string;
          namespace?: string;
          parentId?: string;
        };
        const result = await uploadFileBase64('/api/upload', {
          base64,
          filename,
          contentType,
          folder,
          tags,
          description,
          originalUrl,
          sourceUrl,
          sourcePath,
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

      case 'photarium_upload_image': {
        const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, useExternalApi } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          originalUrl?: string;
          sourceUrl?: string;
          namespace?: string;
          parentId?: string;
          useExternalApi?: boolean;
        };
        const endpoint = useExternalApi === false ? '/api/upload' : '/api/upload/external';
        const result = await uploadFileBase64(endpoint, {
          base64,
          filename,
          contentType,
          folder,
          tags,
          description,
          originalUrl,
          sourceUrl,
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

      case 'photarium_upload_external_file': {
        const { base64, filename, contentType, folder, tags, description, originalUrl, sourceUrl, namespace, parentId } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          originalUrl?: string;
          sourceUrl?: string;
          namespace?: string;
          parentId?: string;
        };
        const result = await uploadFileBase64('/api/upload/external', {
          base64,
          filename,
          contentType,
          folder,
          tags,
          description,
          originalUrl,
          sourceUrl,
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

      case 'photarium_animate': {
        const { frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename } = args as {
          frames: Array<{ kind: 'url'; url: string } | { kind: 'base64'; data: string; filename: string; contentType?: string }>;
          fps?: number;
          loop?: boolean;
          folder?: string;
          tags?: string[];
          description?: string;
          originalUrl?: string;
          sourceUrl?: string;
          namespace?: string;
          parentId?: string;
          filename?: string;
        };
        const result = await createAnimation({ frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_uploads_list': {
        const { page, pageSize, folder } = args as { page?: number; pageSize?: number; folder?: string };
        const result = await listUploads({ page, pageSize, folder });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_upload_download': {
        const { uploadId } = args as { uploadId: string };
        const result = await downloadUpload(uploadId);
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
        const { imageId, existingDescription } = args as { imageId: string; existingDescription?: string };
        const result = await generateDescription(imageId, { existingDescription });
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
        const { imageId, force, existingPrompt } = args as { imageId: string; force?: boolean; existingPrompt?: string };
        const result = await generatePrompt(imageId, { force, existingPrompt });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_prompt_get': {
        const { imageId } = args as { imageId: string };
        const result = await getPromptRecord(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_prompts_bulk': {
        const { imageIds } = args as { imageIds: string[] };
        const result = await getPromptsBulk(imageIds);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ prompts: result }, null, 2),
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

      case 'photarium_haiku': {
        const { imageId } = args as { imageId: string };
        const result = await getHaiku(imageId);
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

      case 'photarium_vector_index': {
        const result = await ensureVectorIndex();
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

      case 'photarium_embedding_status': {
        const { imageId } = args as { imageId: string };
        const result = await getEmbeddingStatus(imageId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_embeddings_batch': {
        const { imageIds, clip, color, force } = args as {
          imageIds: string[];
          clip?: boolean;
          color?: boolean;
          force?: boolean;
        };
        const result = await batchGenerateEmbeddings({ imageIds, clip, color, force });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'photarium_colors_bulk': {
        const { imageIds } = args as { imageIds: string[] };
        const result = await getColorsBulk(imageIds);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ colors: result }, null, 2),
            },
          ],
        };
      }

      case 'photarium_audit': {
        const { refresh, limit, offset, concurrency, variant, verbose } = args as {
          refresh?: boolean;
          limit?: number;
          offset?: number;
          concurrency?: number;
          variant?: string;
          verbose?: boolean;
        };
        const result = await auditImages({ refresh, limit, offset, concurrency, variant, verbose });
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

      case 'photarium_debug_raw': {
        const result = await getDebugRaw();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
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
