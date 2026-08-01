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
  page: number
): Promise<CloudflareImageApiResponse[]> => {
  const params = new URLSearchParams({
    per_page: String(PAGE_SIZE),
    page: String(page),
  });

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      cache: 'no-store',
    }
  );

  const json = await response.json();
  if (!response.ok) {
    const errorMessage =
      json?.errors?.[0]?.message || 'Failed to fetch Cloudflare Images page.';
    throw new Error(errorMessage);
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
export const fetchAllCloudflareImagePages = async (): Promise<CloudflareImageApiResponse[]> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }

  const warnTruncated = () => {
    console.warn(
      `Reached CLOUDFLARE_CACHE_MAX_PAGES (${MAX_PAGES}). Results may be incomplete.`
    );
  };

  const collected: CloudflareImageApiResponse[] = [];
  const firstPage = await fetchCloudflareImagePage(accountId, apiToken, 1);
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
      wave.map((wavePage) => fetchCloudflareImagePage(accountId, apiToken, wavePage))
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
