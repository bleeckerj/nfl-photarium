import fs from 'node:fs/promises';
import path from 'node:path';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface ApiEndpointDoc {
  apiPath: string;
  filePath: string;
  methods: HttpMethod[];
  docblock?: string;
}

const ROUTE_FILE_NAME = 'route.ts';
const API_ROOT_SEGMENT = 'api';

function normalizeApiPathFromRouteFile(routeFilePath: string): string {
  const normalized = routeFilePath.split(path.sep).join('/');
  const apiIndex = normalized.lastIndexOf(`/${API_ROOT_SEGMENT}/`);
  if (apiIndex === -1) return '/api';

  const afterApi = normalized.slice(apiIndex + `/${API_ROOT_SEGMENT}/`.length);
  const withoutRoute = afterApi.replace(new RegExp(`/${ROUTE_FILE_NAME}$`), '');
  const segments = withoutRoute.split('/').filter(Boolean);

  const formattedSegments = segments.map(seg => {
    // Next.js dynamic route segments
    // [id] -> :id
    // [...slug] -> :slug*
    // [[...slug]] -> :slug* (optional catchall; still show as catchall)
    const match = seg.match(/^\[(\[)?\.{3}(.+?)\]?\]$/);
    if (match) {
      const name = match[2];
      return `:${name}*`;
    }
    const dyn = seg.match(/^\[(.+)\]$/);
    if (dyn) {
      return `:${dyn[1]}`;
    }
    return seg;
  });

  return `/${API_ROOT_SEGMENT}/${formattedSegments.join('/')}`;
}

function parseExportedHttpMethods(fileContents: string): HttpMethod[] {
  const methodRegex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  const methods = new Set<HttpMethod>();
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = methodRegex.exec(fileContents)) !== null) {
    methods.add(match[1] as HttpMethod);
  }
  return Array.from(methods);
}

function extractTopDocblock(fileContents: string): string | undefined {
  // Capture only the very first /** ... */ block (common in this repo for route docs).
  const trimmed = fileContents.trimStart();
  const docMatch = trimmed.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!docMatch) return undefined;
  const raw = docMatch[0];

  // Normalize leading "* " formatting without getting fancy markdown parsing.
  const lines = raw
    .replace(/^\/\*\*\s*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trimEnd());

  const cleaned = lines.join('\n').trim();
  return cleaned.length ? cleaned : undefined;
}

async function listRouteFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRouteFilesRecursively(fullPath)));
    } else if (entry.isFile() && entry.name === ROUTE_FILE_NAME) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function listApiEndpoints(): Promise<ApiEndpointDoc[]> {
  const apiRoot = path.join(process.cwd(), 'src', 'app', API_ROOT_SEGMENT);
  const routeFiles = await listRouteFilesRecursively(apiRoot);

  const endpoints = await Promise.all(
    routeFiles.map(async filePathAbs => {
      const contents = await fs.readFile(filePathAbs, 'utf8');
      const methods = parseExportedHttpMethods(contents);
      const docblock = extractTopDocblock(contents);
      const apiPath = normalizeApiPathFromRouteFile(filePathAbs);

      return {
        apiPath,
        filePath: path.relative(process.cwd(), filePathAbs).split(path.sep).join('/'),
        methods,
        docblock,
      } satisfies ApiEndpointDoc;
    })
  );

  return endpoints
    .sort((a, b) => a.apiPath.localeCompare(b.apiPath))
    .map(e => ({
      ...e,
      methods: e.methods.sort(),
    }));
}
