import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import {
  buildArchiveChallengeMessage,
  inspectArchiveHtml,
  logArchiveDiagnostics,
  readArchiveResponseDiagnostics,
} from '@/server/archiveDiagnostics';
import { normalizeCookieHeader } from '@/server/pageImportCookies';
import {
  discoverPageMediaFromHtml,
  isPrivateHost,
} from '@/server/pageImportDiscovery';
import { normalizeSmallAssetThresholdBytes } from '@/features/page-import/utils/smallAssetPolicy';

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const htmlBody = typeof body?.html === 'string' ? body.html : '';
    const sourceUrl = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
    const sourceFilename = typeof body?.sourceFilename === 'string' ? body.sourceFilename.trim() : '';
    const hasHtmlBody = htmlBody.trim().length > 0;
    const includeUiChrome = Boolean(body?.includeUiChrome);
    const includeSmallAssets = Boolean(body?.includeSmallAssets);
    let cookieHeader: string | null = null;
    try {
      cookieHeader = normalizeCookieHeader(body?.cookieHeader);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cookie header' }, { status: 400 });
    }
    const smallAssetThresholdBytes = normalizeSmallAssetThresholdBytes(
      body?.smallAssetThresholdBytes ?? body?.minBytes
    );
    const minBytes = smallAssetThresholdBytes;
    const maxImages = Number.isFinite(body?.maxImages) ? Math.max(0, Number(body.maxImages)) : undefined;
    const allowInsecureEnv = process.env.IMPORT_ALLOW_INSECURE_TLS === 'true';
    const allowInsecure = allowInsecureEnv && Boolean(body?.allowInsecure);

    if (process.env.NODE_ENV !== 'production') {
      console.log('[import/page] allowInsecureEnv:', allowInsecureEnv, 'allowInsecureReq:', Boolean(body?.allowInsecure), 'effective:', allowInsecure);
    }

    if (hasHtmlBody) {
      const htmlSourceUrl = sourceUrl || (pageUrl && isValidUrl(pageUrl) ? pageUrl : '');
      if (sourceUrl && !isValidUrl(sourceUrl)) {
        return NextResponse.json({ error: 'sourceUrl must be a valid page URL when provided' }, { status: 400 });
      }
      if (htmlSourceUrl) {
        const parsedSource = new URL(htmlSourceUrl);
        if (isPrivateHost(parsedSource.hostname)) {
          return NextResponse.json({ error: 'Private or localhost source URLs are not allowed' }, { status: 400 });
        }
      }

      const diagnosticSource = htmlSourceUrl || sourceFilename || 'local-html';
      const archiveDiagnostics = inspectArchiveHtml({
        sourceUrl: diagnosticSource,
        html: htmlBody,
        status: 200,
        finalUrl: diagnosticSource,
        contentType: 'text/html',
      });
      logArchiveDiagnostics('import/page', archiveDiagnostics, { phase: 'html-body-scan' });
      if (archiveDiagnostics?.challengeDetected) {
        return NextResponse.json(
          {
            error: buildArchiveChallengeMessage(archiveDiagnostics.host),
            details: {
              archiveDiagnostics,
            },
          },
          { status: 403 }
        );
      }

      const discovery = await discoverPageMediaFromHtml({
        html: htmlBody,
        sourceUrl: htmlSourceUrl || undefined,
        smallAssetThresholdBytes,
        maxImages,
        includeUiChrome,
        includeSmallAssets,
        fetchHeadInfo: (url) => fetchHeadInfo(url, allowInsecure),
      });

      return NextResponse.json({
        sourceUrl: htmlSourceUrl || null,
        sourceFilename: sourceFilename || null,
        minBytes,
        smallAssetThresholdBytes,
        maxImages: typeof maxImages === 'number' ? maxImages : null,
        allowInsecure,
        includeUiChrome,
        includeSmallAssets,
        archiveDiagnostics,
        ...discovery,
      });
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
      const initialArchiveDiagnostics = await readArchiveResponseDiagnostics(pageUrl, response);
      logArchiveDiagnostics('import/page', initialArchiveDiagnostics, { phase: 'primary-fetch' });
      // Retry once without browser-like headers in case the origin rejects them.
      try {
        const fallbackResponse = await fetch(pageUrl, cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined);
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        } else {
          const fallbackArchiveDiagnostics = await readArchiveResponseDiagnostics(pageUrl, fallbackResponse);
          logArchiveDiagnostics('import/page', fallbackArchiveDiagnostics, { phase: 'fallback-fetch' });
          return NextResponse.json(
            {
              error: fallbackArchiveDiagnostics?.challengeDetected
                ? buildArchiveChallengeMessage(fallbackArchiveDiagnostics.host)
                : buildFetchPageFailureMessage(pageUrl, fallbackResponse),
              details: {
                upstreamStatus: fallbackResponse.status,
                upstreamStatusText: fallbackResponse.statusText,
                finalUrl: fallbackResponse.url,
                archiveDiagnostics: fallbackArchiveDiagnostics,
              },
            },
            { status: fallbackArchiveDiagnostics?.challengeDetected ? 403 : 400 }
          );
        }
      } catch {
        return NextResponse.json(
          {
            error: initialArchiveDiagnostics?.challengeDetected
              ? buildArchiveChallengeMessage(initialArchiveDiagnostics.host)
              : buildFetchPageFailureMessage(pageUrl, response),
            details: {
              upstreamStatus: response.status,
              upstreamStatusText: response.statusText,
              finalUrl: response.url,
              archiveDiagnostics: initialArchiveDiagnostics,
            },
          },
          { status: initialArchiveDiagnostics?.challengeDetected ? 403 : 400 }
        );
      }
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return NextResponse.json({ error: 'URL must return HTML' }, { status: 400 });
    }

    const html = await response.text();
    const archiveDiagnostics = inspectArchiveHtml({
      sourceUrl: pageUrl,
      html,
      status: response.status,
      finalUrl: response.url,
      contentType,
    });
    logArchiveDiagnostics('import/page', archiveDiagnostics, { phase: 'html-scan' });
    if (archiveDiagnostics?.challengeDetected) {
      return NextResponse.json(
        {
          error: buildArchiveChallengeMessage(archiveDiagnostics.host),
          details: {
            upstreamStatus: response.status,
            upstreamStatusText: response.statusText,
            finalUrl: response.url,
            archiveDiagnostics,
          },
        },
        { status: 403 }
      );
    }
    const discovery = await discoverPageMediaFromHtml({
      html,
      sourceUrl: pageUrl,
      smallAssetThresholdBytes,
      maxImages,
      includeUiChrome,
      includeSmallAssets,
      fetchHeadInfo: (url) => fetchHeadInfo(url, allowInsecure),
    });

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      smallAssetThresholdBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      allowInsecure,
      includeUiChrome,
      includeSmallAssets,
      archiveDiagnostics,
      ...discovery,
    });
  } catch (error) {
    console.error('Page import discovery error:', error);
    return NextResponse.json({ error: 'Failed to inspect page' }, { status: 500 });
  }
}

