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
import { createServer } from 'node:http';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

// Configuration
const BASE_URL = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
const SERVICE_NAME = 'photarium-mcp-server';
const SERVICE_VERSION = '0.3.0';
const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_FILE_DIR, '..', '..');

// Types
interface ImageResult {
  id: string;
  imageId?: string;
  canonicalImageId?: string;
  requestedImageId?: string;
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
  const baseHeaders = {
    'Content-Type': 'application/json',
    'x-photarium-source': 'mcp',
    'x-photarium-component': 'photarium-mcp-server',
    'x-photarium-trigger': 'mcp',
  };
  const response = await fetch(url, {
    ...options,
    headers: {
      ...baseHeaders,
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
  const baseHeaders = {
    'x-photarium-source': 'mcp',
    'x-photarium-component': 'photarium-mcp-server',
    'x-photarium-trigger': 'mcp',
  };
  const response = await fetch(url, {
    ...options,
    headers: {
      ...baseHeaders,
      ...options.headers,
    },
  });

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

async function runCommandCapture(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runFilesystemIngest(options: {
  rootPath: string;
  namespace: string;
  apiBase?: string;
  folder?: string;
  tags?: string[];
  descriptionPrefix?: string;
  includeFilename?: boolean;
  includePathTags?: boolean;
  aiMetadata?: boolean;
  aiDisplayName?: boolean;
  aiTags?: boolean;
  tagCount?: number;
  concurrency?: number;
  throttleMs?: number;
  limit?: number;
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<{
  ok: boolean;
  exitCode: number;
  command: string[];
  stdout: string;
  stderr: string;
}> {
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'fs-ingest.mjs');
  const args = [scriptPath, '--root', options.rootPath, '--namespace', options.namespace];

  if (options.apiBase) args.push('--api-base', options.apiBase);
  if (options.folder) args.push('--folder', options.folder);
  if (options.tags && options.tags.length > 0) args.push('--tags', options.tags.join(','));
  if (options.descriptionPrefix) args.push('--description-prefix', options.descriptionPrefix);
  if (options.includeFilename) args.push('--include-filename');
  if (options.includePathTags) args.push('--include-path-tags');
  if (options.aiMetadata) args.push('--ai-metadata');
  if (options.aiDisplayName) args.push('--ai-display-name');
  if (options.aiTags) args.push('--ai-tags');
  if (typeof options.tagCount === 'number') args.push('--tag-count', String(options.tagCount));
  if (typeof options.concurrency === 'number') args.push('--concurrency', String(options.concurrency));
  if (typeof options.throttleMs === 'number') args.push('--throttle-ms', String(options.throttleMs));
  if (typeof options.limit === 'number') args.push('--limit', String(options.limit));
  if (options.dryRun) args.push('--dry-run');
  if (options.verbose) args.push('--verbose');

  const result = await runCommandCapture(process.execPath, args, { cwd: REPO_ROOT });
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    command: [process.execPath, ...args],
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function buildHttpHelp(toolName?: string) {
  const normalized = toolName ? decodeURIComponent(toolName) : undefined;
  if (normalized) {
    const tool = TOOLS.find((entry) => entry.name === normalized);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${normalized}` };
    }
    return {
      ok: true,
      tool,
      usage: {
        endpoint: `/tools/${tool.name}`,
        method: 'POST',
        body: { arguments: {} },
      },
    };
  }

  return {
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    endpoints: {
      health: 'GET /health',
      version: 'GET /version',
      tools: 'GET /tools',
      toolInfo: 'GET /tools/:name',
      help: 'GET /help',
      toolHelp: 'GET /help/:name',
      callTool: 'POST /tools/call',
      callToolDirect: 'POST /tools/:name',
    },
    notes: [
      'Use GET /help/<tool-name> for a specific tool schema and HTTP call pattern.',
      'Example: /help/photarium_fs_ingest',
    ],
  };
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

function _toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function _pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function _pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function _normalizeDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const width = _pickNumber(obj.width, obj.w);
  const height = _pickNumber(obj.height, obj.h);
  if (width && height) {
    return { width, height };
  }
  return undefined;
}

function _deriveAspectRatio(dimensions?: { width: number; height: number }): string | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(width), Math.round(height));
  if (!g) return undefined;
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

function _formatFileSize(bytes?: number): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
}

async function getImage(imageId: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await apiRequest<{ image: Record<string, unknown> }>(`/api/images/${imageId}`);
    const rawImage = data.image;
    const normalized = formatImageResult(rawImage as unknown as ImageResult);
    const metadata = _toRecord(rawImage.meta);
    const dimensions =
      normalized.dimensions
      || _normalizeDimensions(rawImage.dimensions)
      || _normalizeDimensions(metadata.dimensions)
      || (() => {
        const width = _pickNumber(rawImage.width, metadata.width);
        const height = _pickNumber(rawImage.height, metadata.height);
        return width && height ? { width, height } : undefined;
      })();
    const aspectRatio =
      _pickString(
        normalized.aspectRatio,
        rawImage.aspectRatio,
        metadata.aspectRatio
      ) || _deriveAspectRatio(dimensions);
    const fileSizeBytes = _pickNumber(
      rawImage.size,
      (rawImage as Record<string, unknown>).fileSize,
      rawImage.bytes,
      metadata.size,
      (metadata as Record<string, unknown>).fileSize,
      metadata.bytes
    );
    const contentType = _pickString(
      rawImage.type,
      (rawImage as Record<string, unknown>).contentType,
      (rawImage as Record<string, unknown>).mimeType,
      metadata.type,
      (metadata as Record<string, unknown>).contentType,
      (metadata as Record<string, unknown>).mimeType
    );

    return {
      ...normalized,
      uploadedAt:
        _pickString(
          (rawImage as Record<string, unknown>).uploaded,
          (rawImage as Record<string, unknown>).uploadedAt,
          (rawImage as Record<string, unknown>).createdAt,
          (rawImage as Record<string, unknown>).updatedAt,
          metadata.uploadedAt,
          metadata.updatedAt
        ) || null,
      folder: normalized.folder || _pickString(metadata.folder) || null,
      tags: normalized.tags || (Array.isArray(metadata.tags) ? metadata.tags : []),
      displayName:
        _pickString(
          (rawImage as Record<string, unknown>).displayName,
          metadata.displayName
        ) || null,
      linkedAssetId:
        _pickString(
          (rawImage as Record<string, unknown>).linkedAssetId,
          metadata.linkedAssetId
        ) || null,
      variationSort: _pickNumber(
        (rawImage as Record<string, unknown>).variationSort,
        metadata.variationSort
      ) ?? null,
      generatedBy:
        _pickString(
          (rawImage as Record<string, unknown>).generatedBy,
          metadata.generatedBy
        ) || null,
      contentHash:
        _pickString(
          (rawImage as Record<string, unknown>).contentHash,
          metadata.contentHash
        ) || null,
      fileSizeBytes: fileSizeBytes ?? null,
      fileSize: _formatFileSize(fileSizeBytes) || null,
      contentType: contentType || null,
      dimensions: dimensions || null,
      aspectRatio: aspectRatio || null,
      metadata,
      raw: rawImage,
    };
  } catch {
    return null;
  }
}

async function getImageMetadata(imageId: string): Promise<Record<string, unknown> | null> {
  let rawImage: Record<string, unknown>;
  try {
    const data = await apiRequest<{ image: Record<string, unknown> }>(`/api/images/${imageId}`);
    rawImage = data.image;
  } catch {
    return null;
  }

  const normalized = formatImageResult(rawImage as unknown as ImageResult);
  const isVariant = Boolean(normalized.parentId);
  const familyRootId = isVariant ? normalized.parentId : normalized.id;

  let familyVariantCount: number | null = null;
  try {
    const { images } = await listImages({ limit: 0 });
    familyVariantCount = images.filter((img) => (img.parentId || null) === familyRootId).length;
  } catch {
    familyVariantCount = null;
  }

  let extrasRecord: { description?: string; altText?: string } | null = null;
  try {
    const extras = await getExtras(imageId);
    extrasRecord = extras.record;
  } catch {
    extrasRecord = null;
  }

  let promptText: string | null = null;
  try {
    const promptResult = await getPromptRecord(imageId);
    const record = (promptResult.record || {}) as Record<string, unknown>;
    const candidate = record.prompt;
    promptText = typeof candidate === 'string' ? candidate : null;
  } catch {
    promptText = null;
  }

  const tags = normalized.tags || [];
  const variants = normalized.variants;
  const variantUrls = Array.isArray(variants)
    ? variants
    : variants && typeof variants === 'object'
      ? Object.values(variants)
      : [];

  return {
    id: normalized.id,
    filename: normalized.filename,
    url: normalized.url,
    uploadedAt:
      (rawImage.createdAt as string | undefined)
      || (rawImage.uploaded as string | undefined)
      || (rawImage.uploadedAt as string | undefined)
      || (rawImage.updatedAt as string | undefined)
      || null,
    folder: normalized.folder || null,
    namespace: normalized.namespace || null,
    tags,
    description: normalized.description || null,
    altDescription: extrasRecord?.altText || normalized.altTag || null,
    prompt: promptText,
    isVariant,
    parentId: normalized.parentId || null,
    familyRootId,
    variantCount: familyVariantCount,
    variantUrls,
    dimensions: normalized.dimensions || null,
    aspectRatio: normalized.aspectRatio || null,
    dominantColors: normalized.dominantColors || null,
    averageColor: normalized.averageColor || null,
    hasClipEmbedding: normalized.hasClipEmbedding ?? null,
    hasColorEmbedding: normalized.hasColorEmbedding ?? null,
    originalUrl: normalized.originalUrl || null,
    sourceUrl: normalized.sourceUrl || null,
    extras: extrasRecord,
    raw: rawImage,
  };
}

const UPLOAD_FILENAME_QUERY_KEYS = [
  'view_filename',
  'filename',
  'file',
  'name',
  'image',
  'download',
];

const UPLOAD_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/tiff': '.tiff',
};

function decodeUrlComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractFilenameFromSearchParams(params: URLSearchParams): string | undefined {
  for (const key of UPLOAD_FILENAME_QUERY_KEYS) {
    const raw = params.get(key);
    if (raw && raw.trim()) {
      return decodeUrlComponentSafe(raw.trim());
    }
  }
  return undefined;
}

function extractFilenameFromQueryBlob(value: string): string | undefined {
  const text = value.trim().replace(/^\?/, '');
  if (!text || !text.includes('=')) return undefined;
  const params = new URLSearchParams(text);
  return extractFilenameFromSearchParams(params);
}

function cleanUploadFilename(value: string): string {
  let name = value.split(/[\\/]/).pop() || value;
  const fromBlob = extractFilenameFromQueryBlob(name);
  if (fromBlob) {
    name = fromBlob;
  }
  name = name.split('#')[0] || name;
  name = name.split('?')[0] || name;

  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const extension = hasExt ? name.slice(dot).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase() : '';
  const stem = hasExt ? name.slice(0, dot) : name;
  const cleanStem = stem
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const finalStem = cleanStem || 'UploadedImage';
  return `${finalStem}${extension}`;
}

function camelizeUploadStem(value: string): string {
  const tokens = value
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return 'UploadedImage';
  const words = tokens.slice(0, 6).map((token) => {
    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  const merged = words.join('');
  if (!merged) return 'UploadedImage';
  return /^\d/.test(merged) ? `Image${merged}` : merged;
}

function extensionFromMimeType(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  return UPLOAD_MIME_EXTENSION_MAP[normalized];
}

function extensionFromFilename(value: string): string | undefined {
  const match = value.match(/\.[a-z0-9]{2,5}$/i);
  return match ? match[0].toLowerCase() : undefined;
}

function withExtension(stem: string, extension?: string): string {
  if (!extension) return stem;
  if (stem.toLowerCase().endsWith(extension.toLowerCase())) return stem;
  return `${stem}${extension}`;
}

function detectImageMimeFromBuffer(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 12) return undefined;

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  // TIFF
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return 'image/tiff';
  }

  // AVIF/HEIF family by ftyp box
  const ftyp = buffer.subarray(4, 12).toString('ascii');
  if (ftyp === 'ftypavif' || ftyp === 'ftypavis' || ftyp === 'ftypheic' || ftyp === 'ftypheif') {
    return 'image/avif';
  }

  // SVG (text-based)
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trim().toLowerCase();
  if (head.includes('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return undefined;
}

function extractUploadFilenameFromUrl(url: string, mimeType?: string | null): string {
  const preferredExt = extensionFromMimeType(mimeType) || '.jpg';
  try {
    const parsed = new URL(url);
    const fromQuery = extractFilenameFromSearchParams(parsed.searchParams);
    if (fromQuery) {
      return withExtension(cleanUploadFilename(fromQuery), preferredExt);
    }

    const rawSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decodedSegment = decodeUrlComponentSafe(rawSegment);

    try {
      const nested = new URL(decodedSegment);
      const nestedQueryName = extractFilenameFromSearchParams(nested.searchParams);
      if (nestedQueryName) {
        return withExtension(cleanUploadFilename(nestedQueryName), preferredExt);
      }
      const nestedName = nested.pathname.split('/').filter(Boolean).pop();
      if (nestedName) {
        return withExtension(cleanUploadFilename(nestedName), preferredExt);
      }
    } catch {
      // Not a nested URL.
    }

    const queryBlobName = extractFilenameFromQueryBlob(decodedSegment);
    if (queryBlobName) {
      return withExtension(cleanUploadFilename(queryBlobName), preferredExt);
    }
    if (decodedSegment) {
      return withExtension(cleanUploadFilename(decodedSegment), preferredExt);
    }
  } catch {
    // Ignore malformed URLs and use fallback.
  }
  return withExtension('UploadedImage', preferredExt);
}

function looksLikeTransportFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  const stem = lowered.replace(/\.[^.]+$/, '');
  if (stem.includes('view_filename=')) return true;
  if (stem.includes('filename=') && stem.includes('&')) return true;
  if (stem === 'view' || stem === 'image' || stem === 'uploaded-image' || stem === 'remote-image') return true;
  if (/^comfyui[_-]?\d+_?$/.test(stem)) return true;
  return /[=&]/.test(stem);
}

function estimateBase64Bytes(value?: string): number | undefined {
  if (!value) return undefined;
  const payload = value.startsWith('data:') ? value.split(',', 2)[1] || '' : value;
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

async function suggestSemanticDisplayNameFromUrl(
  url: string,
  hints: { filename?: string; folder?: string; tags?: string[] } = {}
): Promise<string | undefined> {
  try {
    const form = new FormData();
    form.append('remoteUrl', url);
    if (hints.filename) form.append('filename', hints.filename);
    if (hints.folder) form.append('folder', hints.folder);
    if (hints.tags?.length) form.append('tags', hints.tags.join(','));

    const response = await fetch(`${BASE_URL}/api/display-name/suggest`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as { displayName?: unknown };
    const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
    if (!displayName) return undefined;
    return camelizeUploadStem(displayName);
  } catch {
    return undefined;
  }
}

async function uploadFromUrl(
  url: string,
  options: {
    displayName?: string;
    folder?: string;
    tags?: string[];
    namespace?: string;
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    parentId?: string;
    prompt?: string;
  } = {}
): Promise<{ success: boolean; imageId?: string; error?: string; promptSave?: Record<string, unknown> }> {
  try {
    // Fetch the image
    const imageResponse = await fetch(url);
    if (!imageResponse.ok) {
      return { success: false, error: `Failed to fetch image from URL: ${imageResponse.status}` };
    }

    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    if (!imageBytes.length) {
      return { success: false, error: 'Downloaded file is empty' };
    }
    const inferredMime =
      detectImageMimeFromBuffer(imageBytes)
      || imageResponse.headers.get('content-type')?.split(';')[0]?.trim()
      || undefined;
    if (!inferredMime || !inferredMime.startsWith('image/')) {
      return { success: false, error: 'Downloaded content is not valid image data' };
    }

    const extractedFilename = extractUploadFilenameFromUrl(url, inferredMime);
    const extractedExtension = extensionFromFilename(extractedFilename) || extensionFromMimeType(inferredMime) || '.jpg';
    const extractedStem = extractedFilename.replace(/\.[^.]+$/, '');

    let semanticDisplayName = options.displayName ? camelizeUploadStem(options.displayName) : '';
    if (!semanticDisplayName) {
      if (looksLikeTransportFilename(extractedFilename)) {
        const suggested = await suggestSemanticDisplayNameFromUrl(url, {
          filename: extractedFilename,
          folder: options.folder,
          tags: options.tags,
        });
        semanticDisplayName = suggested || camelizeUploadStem(extractedStem);
      } else {
        semanticDisplayName = camelizeUploadStem(extractedStem);
      }
    }
    const filename = withExtension(semanticDisplayName || 'UploadedImage', extractedExtension);

    // Create form data
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(imageBytes)], { type: inferredMime }), filename);
    formData.append('displayName', semanticDisplayName || filename.replace(/\.[^.]+$/, ''));
    if (options.folder) formData.append('folder', options.folder);
    if (options.tags) formData.append('tags', options.tags.join(','));
    if (options.namespace) formData.append('namespace', options.namespace);
    if (options.description) formData.append('description', options.description);
    const prompt = normalizeManualPrompt(options.prompt);
    if (prompt) formData.append('prompt', prompt);
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

    const imageId = typeof result.id === 'string' ? result.id : undefined;
    const promptSave =
      result && typeof result === 'object' && !Array.isArray(result) && 'promptSave' in result
        ? (result as Record<string, unknown>).promptSave
        : undefined;

    return {
      success: true,
      imageId,
      ...(promptSave !== undefined ? { promptSave: promptSave as Record<string, unknown> } : {}),
    };
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

function normalizeManualPrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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

async function downloadImageById(
  imageId: string,
  variant?: string
): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  requestedVariant?: string;
  servedVariant?: string;
}> {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
  const contentType = response.headers.get('content-type') || undefined;
  const disposition = response.headers.get('content-disposition') || undefined;
  const sizeHeader = response.headers.get('content-length') || undefined;
  const requestedVariant = response.headers.get('x-photarium-variant-requested') || undefined;
  const servedVariant = response.headers.get('x-photarium-variant-served') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    filename: filenameMatch?.[1],
    contentType,
    size: sizeHeader ? Number(sizeHeader) : undefined,
    base64,
    requestedVariant,
    servedVariant,
  };
}

async function downloadOriginalImageById(imageId: string): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  variantUsed: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}> {
  try {
    const result = await downloadImageById(imageId, 'original');
    return {
      ...result,
      variantUsed: 'original',
      fallbackUsed: false,
    };
  } catch (error) {
    const fallback = await downloadImageById(imageId);
    return {
      ...fallback,
      variantUsed: 'default',
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function _tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function _extractFromMetadataMap(
  metadata: Record<string, string>,
  sourceLabel: string,
): {
  found: boolean;
  workflow: unknown | null;
  prompt: unknown | null;
  rawMetadata: Record<string, string>;
  message?: string;
} {
  const workflowKeys = ['workflow', 'comfy_workflow', 'comfyui_workflow'];
  const promptKeys = ['prompt', 'comfy_prompt', 'parameters'];

  let workflow: unknown | null = null;
  for (const key of workflowKeys) {
    if (metadata[key]) {
      workflow = _tryParseJson(metadata[key]);
      if (workflow !== null) break;
    }
  }

  let prompt: unknown | null = null;
  for (const key of promptKeys) {
    if (metadata[key]) {
      prompt = _tryParseJson(metadata[key]);
      if (prompt !== null) break;
    }
  }

  if (!workflow || !prompt) {
    for (const value of Object.values(metadata)) {
      const parsed = _tryParseJson(value.trim());
      if (!parsed || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      if (!workflow && obj.workflow !== undefined) workflow = obj.workflow;
      if (!prompt && obj.prompt !== undefined) prompt = obj.prompt;
      if (workflow && prompt) break;
    }
  }

  if (!workflow && !prompt) {
    return {
      found: false,
      workflow: null,
      prompt: null,
      rawMetadata: metadata,
      message: `No Comfy workflow/prompt JSON metadata found in ${sourceLabel}.`,
    };
  }

  return {
    found: true,
    workflow,
    prompt,
    rawMetadata: metadata,
  };
}

function _extractExifText(exifBuffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (exifBuffer.length < 14) return out;

  let tiffStart = 0;
  if (exifBuffer.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
    tiffStart = 6;
  }

  if (tiffStart + 8 > exifBuffer.length) return out;
  const endian = exifBuffer.toString('ascii', tiffStart, tiffStart + 2);
  const le = endian === 'II';
  if (!le && endian !== 'MM') return out;

  const u16 = (off: number) => (le ? exifBuffer.readUInt16LE(off) : exifBuffer.readUInt16BE(off));
  const u32 = (off: number) => (le ? exifBuffer.readUInt32LE(off) : exifBuffer.readUInt32BE(off));

  const firstIfdRel = u32(tiffStart + 4);
  const typeSizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };

  const readIfd = (ifdRel: number, prefix = 'ifd') => {
    const ifdOff = tiffStart + ifdRel;
    if (ifdOff + 2 > exifBuffer.length) return;
    const count = u16(ifdOff);
    for (let i = 0; i < count; i += 1) {
      const entryOff = ifdOff + 2 + i * 12;
      if (entryOff + 12 > exifBuffer.length) break;
      const tag = u16(entryOff);
      const type = u16(entryOff + 2);
      const valueCount = u32(entryOff + 4);
      const valueOrOffset = u32(entryOff + 8);
      const unit = typeSizes[type] || 1;
      const byteLen = valueCount * unit;
      let raw: Buffer;
      if (byteLen <= 4) {
        raw = exifBuffer.subarray(entryOff + 8, entryOff + 8 + byteLen);
      } else {
        const dataOff = tiffStart + valueOrOffset;
        if (dataOff + byteLen > exifBuffer.length) continue;
        raw = exifBuffer.subarray(dataOff, dataOff + byteLen);
      }

      let decoded: string | null = null;
      if (type === 2) {
        decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
      } else if (type === 7 || type === 1) {
        if (tag === 0x9286 && raw.length > 8) {
          const payload = raw.subarray(8);
          decoded = payload.toString('utf8').replace(/\x00+$/g, '').trim();
        } else {
          decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
        }
      }

      if (decoded) {
        out[`${prefix}_tag_${tag.toString(16)}`] = decoded;
        if (tag === 0x010e) out.image_description = decoded;
        if (tag === 0x9286) out.user_comment = decoded;
      }

      if (tag === 0x8769 && valueOrOffset > 0) {
        readIfd(valueOrOffset, `${prefix}_exif`);
      }
    }
  };

  if (firstIfdRel > 0) readIfd(firstIfdRel);
  return out;
}

function extractComfyMetadataFromJpeg(buffer: Buffer) {
  const metadata: Record<string, string> = {};
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return {
      found: false,
      workflow: null,
      prompt: null,
      rawMetadata: metadata,
      message: 'Not a JPEG file.',
    };
  }

  let offset = 2;
  let commentIndex = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const len = buffer.readUInt16BE(offset);
    if (len < 2 || offset + len > buffer.length) break;
    const data = buffer.subarray(offset + 2, offset + len);

    if (marker === 0xe1) {
      if (data.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
        Object.assign(metadata, _extractExifText(data));
      } else if (data.subarray(0, 29).toString('ascii').startsWith('http://ns.adobe.com/xap/1.0/')) {
        const xmp = data.subarray(29).toString('utf8').replace(/\x00+$/g, '').trim();
        if (xmp) metadata.xmp = xmp;
      }
    } else if (marker === 0xfe) {
      const txt = data.toString('utf8').replace(/\x00+$/g, '').trim();
      if (txt) metadata[`comment_${commentIndex++}`] = txt;
    }

    offset += len;
  }

  return _extractFromMetadataMap(metadata, 'JPEG metadata segments');
}

function extractComfyMetadataFromWebp(buffer: Buffer) {
  const metadata: Record<string, string> = {};
  if (
    buffer.length < 12
    || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return {
      found: false,
      workflow: null,
      prompt: null,
      rawMetadata: metadata,
      message: 'Not a WebP file.',
    };
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOff = offset + 8;
    const dataEnd = dataOff + chunkSize;
    if (dataEnd > buffer.length) break;
    const data = buffer.subarray(dataOff, dataEnd);

    if (chunkType === 'EXIF') {
      Object.assign(metadata, _extractExifText(data));
    } else if (chunkType === 'XMP ') {
      const xmp = data.toString('utf8').replace(/\x00+$/g, '').trim();
      if (xmp) metadata.xmp = xmp;
    }

    offset = dataEnd + (chunkSize % 2);
  }

  return _extractFromMetadataMap(metadata, 'WebP EXIF/XMP chunks');
}

function extractComfyMetadataFromPng(buffer: Buffer): {
  found: boolean;
  workflow: unknown | null;
  prompt: unknown | null;
  rawMetadata: Record<string, string>;
  message?: string;
} {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
    return {
      found: false,
      workflow: null,
      prompt: null,
      rawMetadata: {},
      message: 'Not a PNG file; Comfy workflow extraction currently supports PNG embedded metadata.',
    };
  }

  const metadata: Record<string, string> = {};
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    offset += 4;

    if (offset + length + 4 > buffer.length) {
      break;
    }

    const chunkData = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4; // crc

    if (chunkType === 'tEXt') {
      const sep = chunkData.indexOf(0);
      if (sep > 0) {
        const key = chunkData.subarray(0, sep).toString('utf8');
        const value = chunkData.subarray(sep + 1).toString('utf8');
        metadata[key] = value;
      }
    } else if (chunkType === 'zTXt') {
      const sep = chunkData.indexOf(0);
      if (sep > 0 && sep + 2 <= chunkData.length) {
        const key = chunkData.subarray(0, sep).toString('utf8');
        const compressed = chunkData.subarray(sep + 2);
        try {
          metadata[key] = inflateSync(compressed).toString('utf8');
        } catch {
          // ignore malformed chunk
        }
      }
    } else if (chunkType === 'iTXt') {
      const sep0 = chunkData.indexOf(0);
      if (sep0 > 0 && sep0 + 3 <= chunkData.length) {
        const key = chunkData.subarray(0, sep0).toString('utf8');
        const compressionFlag = chunkData[sep0 + 1];
        const afterFlag = sep0 + 3;
        const sep1 = chunkData.indexOf(0, afterFlag); // language
        if (sep1 >= 0) {
          const sep2 = chunkData.indexOf(0, sep1 + 1); // translated keyword
          if (sep2 >= 0) {
            const textBytes = chunkData.subarray(sep2 + 1);
            try {
              metadata[key] = (compressionFlag === 1 ? inflateSync(textBytes) : textBytes).toString('utf8');
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
    }

    if (chunkType === 'IEND') {
      break;
    }
  }

  return _extractFromMetadataMap(metadata, 'PNG text chunks');
}

function extractComfyMetadata(
  buffer: Buffer,
  contentType?: string,
  filename?: string,
): {
  found: boolean;
  workflow: unknown | null;
  prompt: unknown | null;
  rawMetadata: Record<string, string>;
  message?: string;
  format: string;
} {
  const lowerType = (contentType || '').toLowerCase();
  const lowerName = (filename || '').toLowerCase();

  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
  const isWebp = buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (isPng || lowerType.includes('png') || lowerName.endsWith('.png')) {
    const result = extractComfyMetadataFromPng(buffer);
    return { ...result, format: 'png' };
  }
  if (isJpeg || lowerType.includes('jpeg') || lowerType.includes('jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    const result = extractComfyMetadataFromJpeg(buffer);
    return { ...result, format: 'jpeg' };
  }
  if (isWebp || lowerType.includes('webp') || lowerName.endsWith('.webp')) {
    const result = extractComfyMetadataFromWebp(buffer);
    return { ...result, format: 'webp' };
  }

  return {
    found: false,
    workflow: null,
    prompt: null,
    rawMetadata: {},
    format: 'unknown',
    message: 'Unsupported artifact format for embedded workflow extraction. Supported: PNG, JPEG, WebP.',
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
    prompt?: string;
  }
): Promise<Record<string, unknown>> {
  const { buffer, mimeType } = decodeBase64(payload.base64);
  const contentType = payload.contentType || mimeType || 'application/octet-stream';
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), payload.filename);
  if (payload.folder) formData.append('folder', payload.folder);
  if (payload.tags?.length) formData.append('tags', payload.tags.join(','));
  if (payload.description) formData.append('description', payload.description);
  const prompt = normalizeManualPrompt(payload.prompt);
  if (prompt) formData.append('prompt', prompt);
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
  const canonicalId = String(
    img.id
    || img.imageId
    || img.canonicalImageId
    || ''
  ).trim();
  // Handle both array and object variants
  let publicUrl = '';
  if (Array.isArray(img.variants)) {
    publicUrl = img.variants.find((v) => v.includes('/public')) || img.variants[0] || '';
  } else if (img.variants && typeof img.variants === 'object') {
    publicUrl = img.variants.public || Object.values(img.variants)[0] || '';
  }

  return {
    id: canonicalId,
    imageId: canonicalId || undefined,
    canonicalImageId: canonicalId || undefined,
    requestedImageId: img.requestedImageId,
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
  {
    name: 'list_tools',
    description: 'Return tool definitions for this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
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
        folder: { type: 'string', description: 'Optional folder value applied to all uploads' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Base tags for all files' },
        descriptionPrefix: { type: 'string', description: 'Optional prefix prepended to generated descriptions' },
        includeFilename: { type: 'boolean', description: 'Include filename in generated description' },
        includePathTags: { type: 'boolean', description: 'Add subdirectory names as tags' },
        aiMetadata: { type: 'boolean', description: 'Generate both displayName and tags for images using AI' },
        aiDisplayName: { type: 'boolean', description: 'Generate image displayName using AI' },
        aiTags: { type: 'boolean', description: 'Generate image tags using AI' },
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
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
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

async function handleToolCall(name: string, args: Record<string, unknown> = {}) {
  try {
    switch (name) {
      case 'list_tools': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ tools: TOOLS }, null, 2),
            },
          ],
        };
      }

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

      case 'photarium_image_metadata': {
        const { imageId } = args as { imageId: string };
        const result = await getImageMetadata(imageId);
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
        const includeRaw = includeBase64 === true;
        const response = includeRaw
          ? { ...result, savedPath }
          : {
              ...result,
              base64: undefined,
              base64Omitted: true,
              base64Bytes: estimateBase64Bytes(result.base64),
              savedPath,
            };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      case 'photarium_download_original': {
        const { imageId, savePath, includeBase64 } = args as {
          imageId: string;
          savePath?: string;
          includeBase64?: boolean;
        };
        const result = await downloadOriginalImageById(imageId);
        let savedPath: string | undefined;
        if (savePath) {
          const fallbackFilename = result.filename || `${imageId}_original.bin`;
          savedPath = await saveBase64ToFile(result.base64, savePath, fallbackFilename);
        }
        const includeRaw = includeBase64 === true;
        const response = includeRaw
          ? { ...result, savedPath }
          : {
              ...result,
              base64: undefined,
              base64Omitted: true,
              base64Bytes: estimateBase64Bytes(result.base64),
              savedPath,
            };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      case 'photarium_extract_workflow': {
        const { imageId, includeRawMetadata } = args as { imageId: string; includeRawMetadata?: boolean };
        const download = await downloadOriginalImageById(imageId);
        const decoded = Buffer.from(download.base64, 'base64');
        const extracted = extractComfyMetadata(decoded, download.contentType, download.filename);

        const response: Record<string, unknown> = {
          imageId,
          format: extracted.format,
          contentType: download.contentType || null,
          size: download.size || decoded.length,
          filename: download.filename || null,
          variantUsed: download.variantUsed,
          fallbackUsed: download.fallbackUsed,
          fallbackReason: download.fallbackReason || null,
          extracted: extracted.found,
          workflow: extracted.workflow,
          prompt: extracted.prompt,
          message: extracted.message || null,
        };

        if (includeRawMetadata) {
          response.rawMetadata = extracted.rawMetadata;
        }

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
        const { url, folder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId } = args as {
          url: string;
          folder?: string;
          tags?: string[];
          namespace?: string;
          description?: string;
          prompt?: string;
          displayName?: string;
          originalUrl?: string;
          sourceUrl?: string;
          parentId?: string;
        };
        const result = await uploadFromUrl(url, { folder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId });
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
        const { url, includeData } = args as { url: string; includeData?: boolean };
        const result = await importFromUrl(url);
        const response = includeData === true
          ? result
          : {
              ...result,
              data: undefined,
              dataOmitted: true,
              dataBytes: estimateBase64Bytes(result.data),
            };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      case 'photarium_upload_file': {
        const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, sourcePath, namespace, parentId } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          prompt?: string;
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
          prompt,
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
        const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId, useExternalApi } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          prompt?: string;
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
          prompt,
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
        const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args as {
          base64: string;
          filename: string;
          contentType?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          prompt?: string;
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
          prompt,
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

      case 'photarium_upload_from_path': {
        const { filePath, filename, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args as {
          filePath: string;
          filename?: string;
          folder?: string;
          tags?: string[];
          description?: string;
          prompt?: string;
          originalUrl?: string;
          sourceUrl?: string;
          namespace?: string;
          parentId?: string;
        };

        try {
          const { readFileSync, statSync } = await import('node:fs');
          const stats = statSync(filePath);
          if (!stats.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
          }
          if (stats.size <= 0) {
            throw new Error(`File is empty: ${filePath}`);
          }

          const fileBuffer = readFileSync(filePath);
          const detectedMime = detectImageMimeFromBuffer(fileBuffer);
          if (!detectedMime) {
            throw new Error('File does not contain recognized image data');
          }

          const requestedFilename = cleanUploadFilename(filename || filePath.split('/').pop() || 'upload');
          const requestedExt = extensionFromFilename(requestedFilename);
          const effectiveExt = requestedExt || extensionFromMimeType(detectedMime) || '.png';
          const semanticStem = camelizeUploadStem(requestedFilename.replace(/\.[^.]+$/, ''));
          const finalFilename = withExtension(semanticStem || 'UploadedImage', effectiveExt);
          const displayName = semanticStem || finalFilename.replace(/\.[^.]+$/, '');
          const mimeType = detectedMime;

          const form = new FormData();
          form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), finalFilename);
          form.append('displayName', displayName);
          if (folder) form.append('folder', folder);
          if (description) form.append('description', description);
          const cleanedPrompt = normalizeManualPrompt(prompt);
          if (cleanedPrompt) form.append('prompt', cleanedPrompt);
          if (originalUrl) form.append('originalUrl', originalUrl);
          if (sourceUrl) form.append('sourceUrl', sourceUrl);
          if (namespace) form.append('namespace', namespace);
          if (parentId) form.append('parentId', parentId);
          if (tags && tags.length > 0) {
            form.append('tags', tags.join(','));
          }

          const response = await fetch(`${BASE_URL}/api/upload`, {
            method: 'POST',
            body: form,
          });

          const rawText = await response.text();
          let result: Record<string, unknown>;
          try {
            result = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
          } catch {
            result = { raw: rawText };
          }
          if (!response.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: (result.error as string | undefined) || `Upload failed (${response.status})`,
                      status: response.status,
                      filePath,
                      uploadFilename: finalFilename,
                      mimeType,
                      bytes: fileBuffer.byteLength,
                      response: result,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ...result,
                    uploadFilename: finalFilename,
                    displayName,
                    mimeType,
                    bytes: fileBuffer.byteLength,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `Error uploading from path: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
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

      case 'photarium_fs_ingest': {
        const {
          rootPath,
          namespace,
          apiBase,
          folder,
          tags,
          descriptionPrefix,
          includeFilename,
          includePathTags,
          aiMetadata,
          aiDisplayName,
          aiTags,
          tagCount,
          concurrency,
          throttleMs,
          limit,
          dryRun,
          verbose,
        } = args as {
          rootPath: string;
          namespace: string;
          apiBase?: string;
          folder?: string;
          tags?: string[];
          descriptionPrefix?: string;
          includeFilename?: boolean;
          includePathTags?: boolean;
          aiMetadata?: boolean;
          aiDisplayName?: boolean;
          aiTags?: boolean;
          tagCount?: number;
          concurrency?: number;
          throttleMs?: number;
          limit?: number;
          dryRun?: boolean;
          verbose?: boolean;
        };

        const result = await runFilesystemIngest({
          rootPath,
          namespace,
          apiBase: apiBase || BASE_URL,
          folder,
          tags,
          descriptionPrefix,
          includeFilename,
          includePathTags,
          aiMetadata,
          aiDisplayName,
          aiTags,
          tagCount,
          concurrency,
          throttleMs,
          limit,
          dryRun,
          verbose,
        });

        const response = {
          ok: result.ok,
          exitCode: result.exitCode,
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
          ...(result.ok ? {} : { isError: true }),
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
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, (args || {}) as Record<string, unknown>);
});

const HTTP_HOST = process.env.PHOTARIUM_HTTP_HOST || '127.0.0.1';
const HTTP_PORT = process.env.PHOTARIUM_HTTP_PORT ? Number(process.env.PHOTARIUM_HTTP_PORT) : undefined;
const HTTP_ENABLED = new Set(['1', 'true', 'yes', 'on']).has(
  (process.env.PHOTARIUM_HTTP_ENABLED || '').toLowerCase()
);
const STARTED_AT = new Date().toISOString();

function gitOutput(args: string[]): string | null {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function gitDirty(): boolean | null {
  try {
    execSync('git diff --quiet --ignore-submodules HEAD --', {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    return false;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status === 1) return true;
    }
    return null;
  }
}

function runtimeInfo() {
  return {
    service: SERVICE_NAME,
    service_version: SERVICE_VERSION,
    git_commit: gitOutput(['rev-parse', '--short=12', 'HEAD']),
    git_branch: gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']),
    git_dirty: gitDirty(),
    node_version: process.version,
    started_at: STARTED_AT,
    tool_count: TOOLS.length,
  };
}

function getTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const rawAuth = headers.authorization || headers.Authorization;
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice('bearer '.length).trim();
    return token || undefined;
  }
  const rawToken = headers['x-mcp-token'] || headers['X-MCP-Token'];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  return token || undefined;
}

function maybeInjectToken(args: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) {
  if (args.token !== undefined) {
    return args;
  }
  const token = getTokenFromHeaders(headers);
  if (!token) {
    return args;
  }
  return { ...args, token };
}

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          resolve(parsed as Record<string, unknown>);
          return;
        }
        reject(new Error('Request body must be a JSON object'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function startHttpServer() {
  const port = HTTP_PORT ?? 8787;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && path === '/health') {
        sendJson(res, 200, { status: 'ok', ...runtimeInfo() });
        return;
      }

      if (req.method === 'GET' && path === '/version') {
        sendJson(res, 200, runtimeInfo());
        return;
      }

      if (req.method === 'GET' && path === '/tools') {
        sendJson(res, 200, { tools: TOOLS });
        return;
      }

      if (req.method === 'GET' && path === '/help') {
        sendJson(res, 200, buildHttpHelp());
        return;
      }

      if (req.method === 'GET' && path.startsWith('/help/')) {
        const name = path.slice('/help/'.length);
        const payload = buildHttpHelp(name);
        sendJson(res, payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false ? 404 : 200, payload);
        return;
      }

      if (path.startsWith('/tools/') && req.method === 'GET') {
        const name = decodeURIComponent(path.slice('/tools/'.length));
        const tool = TOOLS.find((entry) => entry.name === name);
        if (!tool) {
          sendJson(res, 404, { ok: false, error: `Unknown tool: ${name}` });
          return;
        }
        sendJson(res, 200, { tool });
        return;
      }

      if (req.method === 'POST' && path === '/tools/call') {
        const payload = await readJsonBody(req);
        const name = payload.name as string | undefined;
        if (!name) {
          sendJson(res, 400, { ok: false, error: 'Missing tool name' });
          return;
        }
        const rawArgs = payload.arguments as Record<string, unknown> | undefined;
        const args = maybeInjectToken(rawArgs || {}, req.headers as Record<string, string | string[] | undefined>);
        const result = await handleToolCall(name, args);
        sendJson(res, 200, { ok: !result.isError, result });
        return;
      }

      if (req.method === 'POST' && path.startsWith('/tools/')) {
        const name = decodeURIComponent(path.slice('/tools/'.length));
        const payload = await readJsonBody(req);
        const args = (payload.arguments as Record<string, unknown> | undefined)
          || (payload.args as Record<string, unknown> | undefined)
          || payload;
        const result = await handleToolCall(
          name,
          maybeInjectToken(args || {}, req.headers as Record<string, string | string[] | undefined>)
        );
        sendJson(res, 200, { ok: !result.isError, result });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(port, HTTP_HOST, () => {
    console.error(`Photarium MCP HTTP proxy listening on http://${HTTP_HOST}:${port}`);
  });
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Photarium MCP server running on stdio');
  if (HTTP_ENABLED || HTTP_PORT !== undefined) {
    await startHttpServer();
  }
}

main().catch(console.error);
