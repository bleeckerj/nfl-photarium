import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import {
  looksLikeTinyTrackingPixel,
  looksLikeTrackingOrUtilityAsset,
  looksLikeUiChromeAsset,
} from '@/server/pageImportFilters';
import { normalizeCookieHeader } from '@/server/pageImportCookies';

const DEFAULT_MIN_BYTES = 8 * 1024;

// Use a browser-like User-Agent to avoid sites (e.g. Google Drive) redirecting to login pages
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent };

const isCertError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
  return code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
};

const fetchWithCertFallback = async (url: string, allowInsecure: boolean, init?: RequestInit) => {
  const baseHeaders = { 'User-Agent': BROWSER_USER_AGENT, ...(init?.headers || {}) };
  const firstInit: FetchInitWithDispatcher = allowInsecure
    ? { ...init, headers: baseHeaders, dispatcher: insecureAgent }
    : { ...init, headers: baseHeaders };
  try {
    return await fetch(url, firstInit as RequestInit);
  } catch (error) {
    if (!allowInsecure) throw error;
    if (isCertError(error)) {
      // Retry once with insecure agent if the first attempt didn't already use it
      if (!firstInit.dispatcher) {
        const retryInit: FetchInitWithDispatcher = { ...init, headers: baseHeaders, dispatcher: insecureAgent };
        return await fetch(url, retryInit as RequestInit);
      }
    }
    throw error;
  }
};

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const getHostFromUrl = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};

const toErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code || '')
    : '';

const buildFetchPageFailureMessage = (sourceUrl: string, response: Response) => {
  const host = getHostFromUrl(sourceUrl);
  const status = response.status;
  const statusText = response.statusText || 'Unknown';
  const redirectedToLogin = (() => {
    try {
      const finalPath = new URL(response.url || sourceUrl).pathname.toLowerCase();
      return /(login|signin|auth|account)/.test(finalPath);
    } catch {
      return false;
    }
  })();

  let hint = 'The site may block automated requests or require login.';
  if (status === 401 || status === 403 || redirectedToLogin) {
    hint = 'The site appears to require authentication or is blocking automated requests.';
  } else if (status >= 500) {
    hint = 'The source site returned a server error.';
  }

  return `Failed to fetch page from ${host} (HTTP ${status} ${statusText}). ${hint}`;
};

const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const extractBaseHref = (html: string) => {
  const match = html.match(/<base[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match?.[1];
};

const parseAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:\-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
};

type SrcsetCandidate = { url: string; score: number };

const pickSrcsetCandidate = (srcset: string) => {
  const parts = srcset.split(',');
  const candidates: SrcsetCandidate[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, descriptor] = trimmed.split(/\s+/, 2);
    let score = 0;
    if (descriptor?.endsWith('w')) {
      const width = Number(descriptor.slice(0, -1));
      score = Number.isFinite(width) ? width : 0;
    } else if (descriptor?.endsWith('x')) {
      const ratio = Number(descriptor.slice(0, -1));
      score = Number.isFinite(ratio) ? ratio * 1000 : 0;
    } else {
      score = 1;
    }
    candidates.push({ url, score });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
};

type DiscoveredMediaCandidate = {
  kind: 'image' | 'video';
  rawUrl: string;
  filenameHint?: string;
};

const extractImageUrls = (html: string) => {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const urls: DiscoveredMediaCandidate[] = [];
  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const typeValue = (attrs.type || '').toLowerCase();
    const srcsetCandidate = attrs.srcset ? pickSrcsetCandidate(attrs.srcset) : undefined;
    const raw =
      srcsetCandidate ||
      attrs.src ||
      attrs['data-src'] ||
      attrs['data-lazy-src'] ||
      attrs['data-original'];
    if (!raw) continue;
    const looksLikeVideoSource =
      typeValue.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(raw);
    urls.push({
      kind: looksLikeVideoSource ? 'video' : 'image',
      rawUrl: raw,
    });
  }
  return urls;
};

const extractVideoUrls = (html: string) => {
  const candidates: DiscoveredMediaCandidate[] = [];
  const videoTags = html.match(/<video\b[^>]*>([\s\S]*?)<\/video>/gi) ?? [];
  for (const videoTag of videoTags) {
    const videoOpenTag = videoTag.match(/<video\b[^>]*>/i)?.[0] ?? '';
    const videoAttrs = parseAttributes(videoOpenTag);
    const filenameHint = videoAttrs['aria-label'] || videoAttrs['title'] || videoAttrs['data-filename'];
    const directVideoSrc =
      videoAttrs.src || videoAttrs['data-src'] || videoAttrs['data-original'] || videoAttrs.poster;
    if (directVideoSrc) {
      candidates.push({
        kind: 'video',
        rawUrl: directVideoSrc,
        filenameHint,
      });
    }

    const sourceTags = videoTag.match(/<source\b[^>]*>/gi) ?? [];
    for (const sourceTag of sourceTags) {
      const attrs = parseAttributes(sourceTag);
      const raw = attrs.src || (attrs.srcset ? pickSrcsetCandidate(attrs.srcset) : undefined);
      if (!raw) continue;
      candidates.push({
        kind: 'video',
        rawUrl: raw,
        filenameHint,
      });
    }
  }
  return candidates;
};

const resolveUrl = (value: string, baseUrl: string) => {
  try {
    const resolved = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return undefined;
    resolved.hash = '';
    if (isPrivateHost(resolved.hostname)) return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
};

const resolveMediaCandidate = (candidate: DiscoveredMediaCandidate, baseUrl: string) => {
  const raw = candidate.rawUrl.trim();
  if (!raw) return null;

  if (raw.startsWith('blob:')) {
    return {
      kind: candidate.kind,
      url: raw,
      isBlob: true,
      filename: candidate.filenameHint || getFilenameFromUrl(raw),
    };
  }

  const resolved = resolveUrl(raw, baseUrl);
  if (!resolved) return null;
  return {
    kind: candidate.kind,
    url: resolved,
    isBlob: false,
    filename: candidate.filenameHint || getFilenameFromUrl(resolved),
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) => {
  const results: R[] = [];
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
};

const fetchHeadInfo = async (url: string, allowInsecure: boolean) => {
  try {
    const response = await fetchWithCertFallback(url, allowInsecure, { method: 'HEAD', redirect: 'follow' });
    if (!response.ok) return {};
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    return {
      contentLength: contentLength ? Number(contentLength) : undefined,
      contentType: contentType ? contentType.split(';')[0].trim().toLowerCase() : undefined
    };
  } catch {
    return {};
  }
};

const getFilenameFromUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'remote-image';
  } catch {
    return 'remote-image';
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    let cookieHeader: string | null = null;
    try {
      cookieHeader = normalizeCookieHeader(body?.cookieHeader);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cookie header' }, { status: 400 });
    }
    const minBytes = Number.isFinite(body?.minBytes) ? Number(body.minBytes) : DEFAULT_MIN_BYTES;
    const maxImages = Number.isFinite(body?.maxImages) ? Math.max(0, Number(body.maxImages)) : undefined;
    const allowInsecureEnv = process.env.IMPORT_ALLOW_INSECURE_TLS === 'true';
    const allowInsecure = allowInsecureEnv && Boolean(body?.allowInsecure);

    if (process.env.NODE_ENV !== 'production') {
      console.log('[import/page] allowInsecureEnv:', allowInsecureEnv, 'allowInsecureReq:', Boolean(body?.allowInsecure), 'effective:', allowInsecure);
    }

    if (!pageUrl || !isValidUrl(pageUrl)) {
      return NextResponse.json({ error: 'A valid page URL is required' }, { status: 400 });
    }
    const parsed = new URL(pageUrl);
    if (isPrivateHost(parsed.hostname)) {
      return NextResponse.json({ error: 'Private or localhost URLs are not allowed' }, { status: 400 });
    }

    let response: Response;
    try {
      response = await fetchWithCertFallback(pageUrl, allowInsecure, cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined);
    } catch (error) {
      const code = toErrorCode(error);
      const certRelated = isCertError(error);
      const certHint = certRelated
        ? (allowInsecureEnv
            ? 'Try enabling "Allow insecure TLS" in the importer.'
            : 'Set IMPORT_ALLOW_INSECURE_TLS=true on the server, then enable "Allow insecure TLS" in the importer.')
        : '';
      const message = error instanceof Error ? error.message : 'Network error';
      return NextResponse.json(
        {
          error: `Failed to fetch page from ${getHostFromUrl(pageUrl)} (${message}). ${certHint}`.trim(),
          details: {
            code: code || undefined,
            certRelated,
          },
        },
        { status: 400 }
      );
    }

    if (!response.ok) {
      // Retry once without browser-like headers in case the origin rejects them.
      try {
        const fallbackResponse = await fetch(pageUrl, cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined);
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        } else {
          return NextResponse.json(
            {
              error: buildFetchPageFailureMessage(pageUrl, fallbackResponse),
              details: {
                upstreamStatus: fallbackResponse.status,
                upstreamStatusText: fallbackResponse.statusText,
                finalUrl: fallbackResponse.url,
              },
            },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          {
            error: buildFetchPageFailureMessage(pageUrl, response),
            details: {
              upstreamStatus: response.status,
              upstreamStatusText: response.statusText,
              finalUrl: response.url,
            },
          },
          { status: 400 }
        );
      }
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return NextResponse.json({ error: 'URL must return HTML' }, { status: 400 });
    }

    const html = await response.text();
    const baseHref = extractBaseHref(html);
    const baseUrl = baseHref ? new URL(baseHref, pageUrl).toString() : pageUrl;

    const rawCandidates = [...extractImageUrls(html), ...extractVideoUrls(html)];
    const resolvedCandidates = rawCandidates
      .map((candidate) => resolveMediaCandidate(candidate, baseUrl))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    const dedupedCandidates = Array.from(
      new Map(
        resolvedCandidates.map((candidate) => [
          `${candidate.kind}:${candidate.url}`,
          candidate,
        ])
      ).values()
    );

    const filteredCandidates = dedupedCandidates.filter(
      (candidate) =>
        !looksLikeUiChromeAsset(candidate.url, candidate.filename) &&
        !looksLikeTrackingOrUtilityAsset(candidate.url, candidate.filename) &&
        !looksLikeTinyTrackingPixel({
          url: candidate.url,
          filenameHint: candidate.filename,
        })
    );

    const imageCandidates = filteredCandidates.filter((candidate) => candidate.kind === 'image' && !candidate.isBlob);
    const videoCandidates = filteredCandidates.filter((candidate) => candidate.kind === 'video');

    const limitedImageCandidates =
      typeof maxImages === 'number' && maxImages > 0
        ? imageCandidates.slice(0, maxImages)
        : imageCandidates;

    const headInfos = await mapWithConcurrency(limitedImageCandidates, 6, async (candidate) => ({
      url: candidate.url,
      filename: candidate.filename,
      ...(await fetchHeadInfo(candidate.url, allowInsecure))
    }));

    const images = headInfos
      .filter((info) => {
        if (looksLikeTinyTrackingPixel({
          url: info.url,
          filenameHint: info.filename,
          contentLength: info.contentLength,
        })) {
          return false;
        }
        if (info.contentType && !info.contentType.startsWith('image/')) return false;
        if (typeof info.contentLength === 'number' && info.contentLength < minBytes) return false;
        return true;
      })
      .map((info) => ({
        url: info.url,
        filename: info.filename || getFilenameFromUrl(info.url),
        contentType: info.contentType,
        contentLength: info.contentLength
      }));

    const videos = videoCandidates.map((candidate) => ({
      kind: 'video' as const,
      url: candidate.url,
      filename: candidate.filename || getFilenameFromUrl(candidate.url),
      isBlob: candidate.isBlob,
      contentType: candidate.url.startsWith('blob:') ? undefined : 'video/unknown',
    }));

    const media = [
      ...images.map((image) => ({ kind: 'image' as const, ...image, isBlob: false })),
      ...videos,
    ];

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      allowInsecure,
      images,
      videos,
      media,
    });
  } catch (error) {
    console.error('Page import discovery error:', error);
    return NextResponse.json({ error: 'Failed to inspect page' }, { status: 500 });
  }
}
