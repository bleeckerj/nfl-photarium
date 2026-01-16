import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';

const DEFAULT_MIN_BYTES = 8 * 1024;

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

const isCertError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code)
    : '';
  return code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
};

const fetchWithCertFallback = async (url: string, allowInsecure: boolean, init?: RequestInit) => {
  const firstInit = allowInsecure ? { ...(init as any), dispatcher: insecureAgent } : init;
  try {
    return await fetch(url, firstInit);
  } catch (error) {
    if (!allowInsecure) throw error;
    if (isCertError(error)) {
      // Retry once with insecure agent if the first attempt didn't already use it
      if (!firstInit || !(firstInit as any).dispatcher) {
        return await fetch(url, { ...(init as any), dispatcher: insecureAgent } as any);
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

const extractImageUrls = (html: string) => {
  const tags = html.match(/<(img|source)\b[^>]*>/gi) ?? [];
  const urls: string[] = [];
  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const srcsetCandidate = attrs.srcset ? pickSrcsetCandidate(attrs.srcset) : undefined;
    const raw =
      srcsetCandidate ||
      attrs.src ||
      attrs['data-src'] ||
      attrs['data-lazy-src'] ||
      attrs['data-original'];
    if (raw) {
      urls.push(raw);
    }
  }
  return urls;
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

    const response = await fetchWithCertFallback(pageUrl, allowInsecure);
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch page' }, { status: 400 });
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return NextResponse.json({ error: 'URL must return HTML' }, { status: 400 });
    }

    const html = await response.text();
    const baseHref = extractBaseHref(html);
    const baseUrl = baseHref ? new URL(baseHref, pageUrl).toString() : pageUrl;

    const rawUrls = extractImageUrls(html);
    const resolvedUrls = rawUrls
      .map((value) => resolveUrl(value, baseUrl))
      .filter((value): value is string => Boolean(value));

    const uniqueUrls = Array.from(new Set(resolvedUrls));
    const limitedUrls = typeof maxImages === 'number' && maxImages > 0
      ? uniqueUrls.slice(0, maxImages)
      : uniqueUrls;

    const headInfos = await mapWithConcurrency(limitedUrls, 6, async (url) => ({
      url,
      ...(await fetchHeadInfo(url, allowInsecure))
    }));

    const images = headInfos
      .filter((info) => {
        if (info.contentType && !info.contentType.startsWith('image/')) return false;
        if (typeof info.contentLength === 'number' && info.contentLength < minBytes) return false;
        return true;
      })
      .map((info) => ({
        url: info.url,
        filename: getFilenameFromUrl(info.url),
        contentType: info.contentType,
        contentLength: info.contentLength
      }));

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      allowInsecure,
      images
    });
  } catch (error) {
    console.error('Page import discovery error:', error);
    return NextResponse.json({ error: 'Failed to inspect page' }, { status: 500 });
  }
}
