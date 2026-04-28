import type { Context } from 'hono';
import { json } from '../../lib/json';
import { isLocalDevRequest } from '../../dev/mode';
import { applyNoIndexHeaders } from '../../lib/http';

export interface RootProjectLink {
  projectId: string;
  title: string;
  publicSlug: string;
  accessKey: string;
  sharePath: string;
  publishedAt: string;
  expiresAt?: string | null;
}

export const parseRootProjects = (raw: string | undefined): RootProjectLink[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        projectId: typeof entry.projectId === 'string' ? entry.projectId : '',
        title: typeof entry.title === 'string' ? entry.title : '',
        publicSlug: typeof entry.publicSlug === 'string' ? entry.publicSlug : '',
        accessKey: typeof entry.accessKey === 'string' ? entry.accessKey : '',
        sharePath: typeof entry.sharePath === 'string' ? entry.sharePath : '',
        publishedAt: typeof entry.publishedAt === 'string' ? entry.publishedAt : '',
        expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : null,
      }))
      .filter((entry) => entry.projectId && entry.title && entry.publicSlug && entry.accessKey && entry.sharePath && entry.publishedAt);
  } catch {
    return [];
  }
};

const respond = (payload: unknown, status = 200): Response => {
  const response = json(payload, { status });
  const headers = applyNoIndexHeaders(new Headers(response.headers));
  return new Response(response.body, { status: response.status, headers });
};

export const getRootProjectBootstrapPath = (
  project: Pick<RootProjectLink, 'publicSlug'>
): string => `/p/${encodeURIComponent(project.publicSlug)}`;

export const findRootProjectBySlug = (
  publicSlug: string | undefined,
  env: Pick<Env, 'CLIENT_ROOT_PROJECTS_JSON'>
): RootProjectLink | null => {
  if (!publicSlug) return null;
  return parseRootProjects(env.CLIENT_ROOT_PROJECTS_JSON).find((project) => project.publicSlug === publicSlug) ?? null;
};

export const getRootState = (requestUrl: string, env: Env) => {
  if (isLocalDevRequest(requestUrl, env)) {
    return {
      mode: 'local-dev' as const,
    };
  }

  const projects = parseRootProjects(env.CLIENT_ROOT_PROJECTS_JSON);
  if (projects.length === 1) {
    return {
      mode: 'redirect' as const,
      sharePath: getRootProjectBootstrapPath(projects[0]),
    };
  }

  if (projects.length > 1) {
    return {
      mode: 'index' as const,
      siteName: env.PUBLIC_SITE_NAME,
      projects,
    };
  }

  const fallbackPath = env.CLIENT_ROOT_DEFAULT_PATH?.trim();
  if (fallbackPath) {
    return {
      mode: 'redirect' as const,
      sharePath: fallbackPath,
    };
  }

  return {
    mode: 'empty' as const,
    siteName: env.PUBLIC_SITE_NAME,
  };
};

export const handleRootState = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => respond(getRootState(context.req.url, context.env));
