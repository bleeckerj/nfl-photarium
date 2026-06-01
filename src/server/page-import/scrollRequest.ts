import { normalizeCookieHeader } from '@/server/pageImportCookies';
import { isPrivateHost, isValidUrl } from '@/server/page-import/scrollMediaCandidates';

const DEFAULT_MAX_SCROLLS = 10;
const AUTO_SCROLL_SAFETY_CAP = 200;
const DEFAULT_SCROLL_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ASSETS = 250;
const MAX_MAX_ASSETS = 2000;

export interface ScrollImportRequestConfig {
  pageUrl: string;
  includeUiChrome: boolean;
  includeSmallAssets: boolean;
  cookieHeader: string | null;
  maxScrolls: number;
  autoScrollUntilStable: boolean;
  maxPages: number;
  maxAssets: number;
  scrollDelayMs: number;
  timeoutMs: number;
}

export const streamErrorResponse = (error: string, status = 400) =>
  new Response(`event: error\ndata: ${JSON.stringify({ error })}\n\n`, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const readFiniteNumber = (value: unknown) =>
  Number.isFinite(value) ? Number(value) : null;

export const parseScrollImportRequest = (
  body: Record<string, unknown> | null | undefined
): { config: ScrollImportRequestConfig } | { response: Response } => {
  const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const includeUiChrome = Boolean(body?.includeUiChrome);
  const includeSmallAssets = Boolean(body?.includeSmallAssets);
  let cookieHeader: string | null = null;
  try {
    cookieHeader = normalizeCookieHeader(body?.cookieHeader);
  } catch (error) {
    return {
      response: streamErrorResponse(
        error instanceof Error ? error.message : 'Invalid cookie header'
      ),
    };
  }

  const bodyMaxScrolls = readFiniteNumber(body?.maxScrolls);
  const requestedMaxScrolls =
    bodyMaxScrolls !== null
      ? Math.max(1, Math.min(50, bodyMaxScrolls))
      : Number(process.env.IMPORT_SCROLL_MAX_SCROLLS) || DEFAULT_MAX_SCROLLS;
  const autoScrollUntilStable = Boolean(body?.autoScrollUntilStable);
  const maxScrolls = autoScrollUntilStable ? AUTO_SCROLL_SAFETY_CAP : requestedMaxScrolls;
  const bodyMaxPages = readFiniteNumber(body?.maxPages);
  const maxPages = bodyMaxPages !== null ? Math.max(1, Math.min(20, bodyMaxPages)) : 1;
  const bodyMaxAssets = readFiniteNumber(body?.maxAssets);
  const maxAssets =
    bodyMaxAssets !== null
      ? Math.max(1, Math.min(MAX_MAX_ASSETS, bodyMaxAssets))
      : DEFAULT_MAX_ASSETS;
  const bodyScrollDelayMs = readFiniteNumber(body?.scrollDelayMs);
  const scrollDelayMs =
    bodyScrollDelayMs !== null
      ? Math.max(500, Math.min(5000, bodyScrollDelayMs))
      : DEFAULT_SCROLL_DELAY_MS;
  const timeoutMs = Number(process.env.IMPORT_SCROLL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  if (!pageUrl || !isValidUrl(pageUrl)) {
    return { response: streamErrorResponse('A valid page URL is required') };
  }

  const parsed = new URL(pageUrl);
  if (isPrivateHost(parsed.hostname)) {
    return { response: streamErrorResponse('Private or localhost URLs are not allowed') };
  }

  return {
    config: {
      pageUrl,
      includeUiChrome,
      includeSmallAssets,
      cookieHeader,
      maxScrolls,
      autoScrollUntilStable,
      maxPages,
      maxAssets,
      scrollDelayMs,
      timeoutMs,
    },
  };
};
