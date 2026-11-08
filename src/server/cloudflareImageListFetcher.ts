import { getCloudflareCredentials } from './cloudflareClient';
import type { CloudflareImageApiResponse } from './cloudflareImageCacheMapper';

/**
 * Raw Cloudflare Images list-API access.
 *
 * Owns paging over `GET /images/v1` and nothing else: no cache state, no
 * metadata overrides, no transformation into `CachedCloudflareImage`. The cache
 * module composes this with its own mapping and reconciliation.
 */

const PAGE_SIZE = Math.min(
  100,
  Math.max(10, Number(process.env.CLOUDFLARE_CACHE_PAGE_SIZE ?? 100))
);

const MAX_PAGES = (() => {
  const value = Number(process.env.CLOUDFLARE_CACHE_MAX_PAGES);
  return Number.isFinite(value) && value > 0 ? value : undefined;
})();

// Concurrent requests per wave when walking past page 1.
const FETCH_CONCURRENCY = 6;

export const getCloudflareImageListPageSize = () => PAGE_SIZE;

export const fetchCloudflareImagePage = async (
  accountId: string,
  apiToken: string,
  page: number,
  strict = false
): Promise<CloudflareImageApiResponse[]> => {
  const params = new URLSearchParams({
    per_page: String(PAGE_SIZE),
    page: String(page),
  });

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`;
  let response: Response;
  let json: { errors?: Array<{ message?: string }>; result?: { images?: CloudflareImageApiResponse[] } };
  for (let attempt = 0; ; attempt += 1) {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: 'no-store',
    });
    try {
      json = await response.json();
      break;
    } catch {
      if (attempt === 0) continue;
      throw new Error(`Cloudflare returned invalid JSON for image catalog page ${page} (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const errorMessage =
      json?.errors?.[0]?.message || 'Failed to fetch Cloudflare Images page.';
    throw new Error(errorMessage);
  }

  if (strict && !Array.isArray(json?.result?.images)) {
    throw new Error('Cloudflare returned an invalid image catalog page.');
  }
  return Array.isArray(json?.result?.images) ? json.result.images : [];
};

/**
 * Walks the full image list.
 *
 * The list API exposes no total count, so the end is detected by a short page.
 * Page 1 is fetched alone — small catalogs then finish in a single request —
 * and the remainder proceeds in concurrent waves, stopping at the wave that
 * contains a short page. A strictly sequential walk cost ~65 round-trips at
 * ~6.5k images.
 */
export const fetchAllCloudflareImagePages = async (strict = false): Promise<CloudflareImageApiResponse[]> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }

  const warnTruncated = () => {
    if (strict) throw new Error(`Image catalog exceeds CLOUDFLARE_CACHE_MAX_PAGES (${MAX_PAGES}).`);
    console.warn(
      `Reached CLOUDFLARE_CACHE_MAX_PAGES (${MAX_PAGES}). Results may be incomplete.`
    );
  };

  const collected: CloudflareImageApiResponse[] = [];
  const firstPage = await fetchCloudflareImagePage(accountId, apiToken, 1, strict);
  collected.push(...firstPage);
  if (firstPage.length < PAGE_SIZE) {
    return collected;
  }

  let page = 2;
  let done = false;

  while (!done) {
    const wave: number[] = [];
    for (let i = 0; i < FETCH_CONCURRENCY; i += 1) {
      const candidate = page + i;
      if (MAX_PAGES && candidate > MAX_PAGES) break;
      wave.push(candidate);
    }
    if (wave.length === 0) {
      warnTruncated();
      break;
    }

    const results = await Promise.all(
      wave.map((wavePage) => fetchCloudflareImagePage(accountId, apiToken, wavePage, strict))
    );
    for (const images of results) {
      collected.push(...images);
      if (images.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }

    page += wave.length;
    if (!done && MAX_PAGES && page > MAX_PAGES) {
      warnTruncated();
      break;
    }
  }

  return collected;
};

/** Query the upstream parent field directly so delete planning does not scan unrelated images. */
export async function fetchCloudflareImageChildren(parentId: string): Promise<CloudflareImageApiResponse[]> {
  const { accountId, apiToken } = getCloudflareCredentials();
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2`);
  url.searchParams.set('meta.variationParentId[eq:string]', parentId);
  url.searchParams.set('per_page', '1000');
  const children: CloudflareImageApiResponse[] = [];
  const seenTokens = new Set<string>();

  while (true) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Cloudflare image variant lookup failed (HTTP ${response.status}).`);
    }
    const body = await response.json();
    const result = body?.result;
    if (body?.success !== true || !Array.isArray(result?.images)) {
      throw new Error('Cloudflare returned an invalid image variant list.');
    }
    children.push(...result.images);
    const token = result.continuation_token;
    if (token == null || token === '') return children;
    if (typeof token !== 'string' || seenTokens.has(token)) {
      throw new Error('Cloudflare returned an invalid image variant continuation token.');
    }
    seenTokens.add(token);
    url.searchParams.set('continuation_token', token);
  }
}
