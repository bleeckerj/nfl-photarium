import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { openCatalogDatabase } from './db.js';
import { ensurePreview, readPreview } from './preview.js';
import { getAsset, listCollections, listKeywords, saveAnnotation, searchAssets } from './search.js';
import { catalogStatus, listCatalogSummaries, syncArchive } from './sync.js';
import type { SearchFilters } from './types.js';

const databasePath = process.env.ARCHIVE_DATABASE_PATH ?? '/data/catalog.sqlite';
const previewRoot = process.env.ARCHIVE_PREVIEW_ROOT ?? '/data/previews';
const backupRoot = process.env.ARCHIVE_BACKUP_ROOT ?? '/data/backups';
const sourceRoot = process.env.ARCHIVE_SOURCE_ROOT ?? '/sources/photography-1';
const port = Number(process.env.ARCHIVE_PORT ?? 8790);
const database = openCatalogDatabase(databasePath);

async function sourceConnected(): Promise<boolean> {
  try {
    await access(sourceRoot);
    return true;
  } catch {
    return false;
  }
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(payload);
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

function pathParts(request: IncomingMessage): string[] {
  return ((request.url ?? '/').split('?')[0] ?? '/').split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

function queryValue(request: IncomingMessage, name: string): string | undefined {
  const url = new URL(request.url ?? '/', 'http://archive.local');
  return url.searchParams.get(name) ?? undefined;
}

function asFilters(body: unknown): SearchFilters {
  if (!body || typeof body !== 'object') return {};
  const input = body as Record<string, unknown>;
  return {
    query: typeof input.query === 'string' ? input.query : undefined,
    from: typeof input.from === 'string' ? input.from : undefined,
    to: typeof input.to === 'string' ? input.to : undefined,
    minRating: typeof input.minRating === 'number' ? input.minRating : undefined,
    pick: typeof input.pick === 'number' ? input.pick : undefined,
    catalogId: typeof input.catalogId === 'string' ? input.catalogId : undefined,
    path: typeof input.path === 'string' ? input.path : undefined,
    keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
    collection: typeof input.collection === 'string' ? input.collection : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    offset: typeof input.offset === 'number' ? input.offset : undefined,
    expandQuery: typeof input.expandQuery === 'boolean' ? input.expandQuery : undefined
  };
}

export function createArchiveServer() {
  return createServer(async (request, response) => {
    try {
      const parts = pathParts(request);
      if (request.method === 'GET' && parts[0] === 'health') {
        sendJson(response, 200, { ok: true, service: 'photo-archive-catalog' });
        return;
      }
      if (request.method === 'GET' && parts[0] === 'status') {
        sendJson(response, 200, { ...catalogStatus(database), sourceRoot, sourceConnected: await sourceConnected(), databasePath, previewRoot, backupRoot });
        return;
      }
      if (request.method === 'GET' && parts[0] === 'catalogs') {
        sendJson(response, 200, { catalogs: listCatalogSummaries(database) });
        return;
      }
      if (request.method === 'POST' && parts[0] === 'sync') {
        if (!(await sourceConnected())) {
          sendError(response, 409, 'The photography source is unavailable; cached catalog data was left unchanged.');
          return;
        }
        const body = await requestBody(request);
        const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const result = await syncArchive({
          sourceRoot,
          database,
          hashFiles: input.hashFiles === true,
          allowLockedCatalog: input.allowLockedCatalog === true,
          catalogPaths: Array.isArray(input.catalogPaths) ? input.catalogPaths.filter((item): item is string => typeof item === 'string') : undefined
        });
        sendJson(response, 200, result);
        return;
      }
      if (request.method === 'POST' && parts[0] === 'search') {
        const result = searchAssets(database, asFilters(await requestBody(request)));
        sendJson(response, 200, result);
        return;
      }
      if (request.method === 'GET' && parts[0] === 'keywords') {
        sendJson(response, 200, { keywords: listKeywords(database, queryValue(request, 'query')) });
        return;
      }
      if (request.method === 'GET' && parts[0] === 'collections') {
        sendJson(response, 200, { collections: listCollections(database, queryValue(request, 'query')) });
        return;
      }
      if (parts[0] === 'assets' && parts[1]) {
        const assetId = parts[1];
        if (request.method === 'GET' && parts[2] === 'preview') {
          const preview = await ensurePreview(database, assetId, previewRoot);
          if (!preview) {
            sendError(response, 404, 'No cached preview is available and the source file is offline or unsupported.');
            return;
          }
          const data = await readPreview(preview);
          response.writeHead(200, { 'content-type': preview.mimeType, 'content-length': data.byteLength, 'cache-control': 'public, max-age=3600' });
          response.end(data);
          return;
        }
        if (request.method === 'GET') {
          const asset = getAsset(database, assetId);
          if (!asset) {
            sendError(response, 404, 'Asset not found.');
            return;
          }
          sendJson(response, 200, { asset });
          return;
        }
        if (request.method === 'POST' && parts[2] === 'annotation') {
          const body = await requestBody(request);
          const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
          const tags = Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === 'string') : [];
          const asset = saveAnnotation(database, assetId, typeof input.note === 'string' ? input.note : null, tags, input.shortlist === true);
          if (!asset) {
            sendError(response, 404, 'Asset not found.');
            return;
          }
          sendJson(response, 200, { asset });
          return;
        }
      }
      sendError(response, 404, 'Unknown archive catalog route.');
    } catch (error) {
      sendError(response, 500, error instanceof Error ? error.message : 'Archive catalog request failed.');
    }
  });
}

export function startArchiveServer(): void {
  createArchiveServer().listen(port, '0.0.0.0', () => {
    console.log(`photo-archive-catalog listening on ${port}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startArchiveServer();
