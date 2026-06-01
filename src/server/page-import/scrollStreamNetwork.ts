import {
  isBlockedMediaDomain,
  looksLikeImageAssetUrl,
  looksLikeTinyTrackingPixel,
  looksLikeTrackingOrUtilityAsset,
  looksLikeUiChromeAsset,
} from '@/server/pageImportFilters';
import { resolveCandidateUrl } from '@/server/page-import/scrollMediaCandidates';

export type NetworkImageCandidate = {
  trusted: boolean;
  contentLength?: number;
};

export type ScrollStreamNetworkState = {
  imageCandidates: Map<string, NetworkImageCandidate>;
  sawProdPage403: boolean;
  sawProtectionPayload: boolean;
};

export type ScrollStreamNetworkPage = {
  on: (
    event: 'response',
    listener: (response: {
      request: () => { resourceType?: () => string };
      url: () => string;
      headers: () => Record<string, string>;
      status: () => number;
    }) => void
  ) => void;
};

export const createScrollStreamNetworkState = (): ScrollStreamNetworkState => ({
  imageCandidates: new Map(),
  sawProdPage403: false,
  sawProtectionPayload: false,
});

export const queueScrollStreamNetworkImage = (
  state: ScrollStreamNetworkState,
  rawUrl: string,
  pageLocation: string,
  options: {
    includeUiChrome: boolean;
    contentType?: string;
    resourceType?: string;
    contentLength?: number;
  }
): void => {
  const resolved = resolveCandidateUrl(rawUrl, pageLocation);
  if (!resolved) return;
  if (isBlockedMediaDomain(resolved)) return;
  if (!options.includeUiChrome && looksLikeUiChromeAsset(resolved)) return;
  if (looksLikeTrackingOrUtilityAsset(resolved)) return;
  if (looksLikeTinyTrackingPixel({ url: resolved })) return;

  const contentType = (options.contentType || '').toLowerCase();
  const trusted = contentType.startsWith('image/') || options.resourceType === 'image';
  const contentLength =
    typeof options.contentLength === 'number' && Number.isFinite(options.contentLength) && options.contentLength > 0
      ? options.contentLength
      : undefined;
  if (!trusted && !looksLikeImageAssetUrl(resolved)) return;

  const current = state.imageCandidates.get(resolved);
  if (!current) {
    state.imageCandidates.set(resolved, { trusted, contentLength });
  } else if (trusted && !current.trusted) {
    current.trusted = true;
  }
  if (typeof contentLength === 'number' && Number.isFinite(contentLength) && contentLength > 0) {
    if (current) {
      current.contentLength = contentLength;
    } else {
      state.imageCandidates.set(resolved, { trusted, contentLength });
    }
  }
};

export const registerScrollStreamNetworkCapture = (
  page: ScrollStreamNetworkPage,
  state: ScrollStreamNetworkState,
  options: {
    pageUrl: string;
    includeUiChrome: boolean;
    isMcMasterHost: boolean;
  }
): void => {
  page.on('response', (response) => {
    try {
      const url = response.url();
      if (!url) return;
      if (options.isMcMasterHost) {
        if (url.includes('ProdPageWebPart.aspx') && response.status() === 403) {
          state.sawProdPage403 = true;
        }
        if (url.includes('prodDatProtection.aspx') && response.status() === 200) {
          state.sawProtectionPayload = true;
        }
      }
      const resourceType = response.request()?.resourceType?.() || '';
      const headers = response.headers();
      const contentType = headers?.['content-type'] || '';
      const parsedContentLength = Number(headers?.['content-length']);
      const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength > 0
        ? parsedContentLength
        : undefined;
      if (resourceType === 'image' || contentType.toLowerCase().startsWith('image/')) {
        queueScrollStreamNetworkImage(state, url, options.pageUrl, {
          includeUiChrome: options.includeUiChrome,
          contentType,
          resourceType,
          contentLength,
        });
      }
    } catch {
      // Ignore best-effort network capture failures.
    }
  });
};
