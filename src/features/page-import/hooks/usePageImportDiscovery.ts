'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImportCandidate,
  ImportProgressState,
  UploaderQueueItem,
} from '@/features/page-import/types';
import {
  DEFAULT_SMALL_ASSET_THRESHOLD_MB,
  mbToSmallAssetThresholdBytes,
  normalizeSmallAssetThresholdMb,
} from '@/features/page-import/utils/smallAssetPolicy';

const PAGE_IMPORT_PREVIEW_LIMIT = 60;
const DEFAULT_PAGE_IMPORT_MAX_ASSETS = '250';

type PageImportDiscoveryResponse = {
  media?: ImportCandidate[];
  relativeUrlWarning?: string;
};

const parseCookieHeaderFromClipboard = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cookieLine = lines.find((line) => /^cookie\s*:/i.test(line));
  return (cookieLine || trimmed).replace(/^cookie\s*:\s*/i, '').trim();
};

const isHtmlFile = (file: File) => {
  const lowerName = file.name.toLowerCase();
  return file.type === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm');
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const readImportPageResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    if (isJson && typeof data === 'object' && data && 'error' in data) {
      throw new Error(
        typeof (data as { error?: string }).error === 'string'
          ? (data as { error?: string }).error
          : 'Failed to inspect page'
      );
    }
    throw new Error('Failed to inspect page');
  }
  if (!isJson || typeof data !== 'object' || !data) {
    throw new Error('Failed to inspect page');
  }
  return data as PageImportDiscoveryResponse;
};

export const toQueueItem = (
  candidate: ImportCandidate,
  queueId: string,
  sessionId: string,
  includePreview: boolean
): UploaderQueueItem => ({
  id: queueId,
  assetType: candidate.kind,
  filename: candidate.filename || candidate.url.split('/').pop() || (candidate.kind === 'video' ? 'remote-video' : 'remote-image'),
  remoteUrl: candidate.url,
  previewUrl: includePreview ? (candidate.kind === 'video' ? candidate.posterUrl : candidate.previewUrl || candidate.url) : undefined,
  posterUrl: candidate.posterUrl,
  isBlobSource: candidate.isBlobSource || candidate.url.startsWith('blob:'),
  sizeBytes: candidate.metadata?.fileSizeBytes,
  contentType: candidate.metadata?.contentType ?? candidate.contentType,
  originalUrl: candidate.url,
  selected: candidate.smallAssetReview ? false : true,
  metadata: candidate.metadata,
  tempAssetKey: candidate.tempAssetKey,
  importSessionId: sessionId,
  smallAssetReview: candidate.smallAssetReview,
});

type UsePageImportDiscoveryParams = {
  addQueuedFiles: (items: UploaderQueueItem[]) => void;
  createQueueId: () => string;
  ensureImportSession: () => Promise<string>;
  setSourceUrlIfEmpty: (value: string) => void;
};

export function usePageImportDiscovery({
  addQueuedFiles,
  createQueueId,
  ensureImportSession,
  setSourceUrlIfEmpty,
}: UsePageImportDiscoveryParams) {
  const [pageImportUrl, setPageImportUrl] = useState('');
  const [pageImportLoading, setPageImportLoading] = useState(false);
  const [pageImportError, setPageImportError] = useState<string | null>(null);
  const [pageImportAllowInsecure, setPageImportAllowInsecure] = useState(false);
  const [pageImportIncludeUiChrome, setPageImportIncludeUiChrome] = useState(false);
  const [pageImportIncludeSmallAssets, setPageImportIncludeSmallAssets] = useState(false);
  const [pageImportSmallAssetThresholdMb, setPageImportSmallAssetThresholdMb] = useState(
    String(DEFAULT_SMALL_ASSET_THRESHOLD_MB)
  );
  const [pageImportScrollMode, setPageImportScrollMode] = useState(true);
  const [pageImportAutoScroll, setPageImportAutoScroll] = useState(true);
  const [pageImportMaxScrolls, setPageImportMaxScrolls] = useState('10');
  const [pageImportScrollDelayMs, setPageImportScrollDelayMs] = useState('1500');
  const [pageImportMaxPages, setPageImportMaxPages] = useState('1');
  const [pageImportMaxAssets, setPageImportMaxAssets] = useState(DEFAULT_PAGE_IMPORT_MAX_ASSETS);
  const [pageImportCookieHeader, setPageImportCookieHeader] = useState('');
  const [pageImportProgress, setPageImportProgress] = useState<ImportProgressState>(null);
  const scrollAbortControllerRef = useRef<AbortController | null>(null);
  const pageImportProgressRef = useRef<ImportProgressState>(null);

  useEffect(() => {
    pageImportProgressRef.current = pageImportProgress;
  }, [pageImportProgress]);

  const handleStopImportPage = useCallback(() => {
    const controller = scrollAbortControllerRef.current;
    if (!controller) return;

    scrollAbortControllerRef.current = null;
    controller.abort();

    const current = pageImportProgressRef.current;
    const scrollCount = current?.scrollCount ?? 0;
    const imageCount = current?.imageCount ?? 0;

    setPageImportError(null);
    setPageImportLoading(false);
    setPageImportProgress({
      message: `Scan stopped after ${scrollCount} scroll${scrollCount !== 1 ? 's' : ''}, ${imageCount} asset${imageCount !== 1 ? 's' : ''} found`,
      scrollCount,
      imageCount,
      pageNum: current?.pageNum,
    });
  }, []);

  const handleImportPage = useCallback(
    async (cookieHeaderOverride?: string) => {
      if (!pageImportUrl.trim()) return;
      const cookieHeaderValue = (cookieHeaderOverride ?? pageImportCookieHeader).trim();
      const smallAssetThresholdBytes = mbToSmallAssetThresholdBytes(
        Number(normalizeSmallAssetThresholdMb(pageImportSmallAssetThresholdMb))
      );

      setPageImportLoading(true);
      setPageImportError(null);
      setPageImportProgress(null);

      try {
        const sessionId = await ensureImportSession();

        if (pageImportScrollMode) {
          const abortController = new AbortController();
          scrollAbortControllerRef.current = abortController;
          const response = await fetch('/api/import/page/scroll/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortController.signal,
            body: JSON.stringify({
              url: pageImportUrl.trim(),
              autoScrollUntilStable: pageImportAutoScroll,
              maxScrolls: Number(pageImportMaxScrolls) || 10,
              scrollDelayMs: Number(pageImportScrollDelayMs) || 1500,
              maxPages: Number(pageImportMaxPages) || 1,
              maxAssets: Number(pageImportMaxAssets) || Number(DEFAULT_PAGE_IMPORT_MAX_ASSETS),
              includeUiChrome: pageImportIncludeUiChrome,
              includeSmallAssets: pageImportIncludeSmallAssets,
              smallAssetThresholdBytes,
              ...(cookieHeaderValue ? { cookieHeader: cookieHeaderValue } : {}),
            }),
          });
          if (!response.ok || !response.body) {
            const payload = await response.text();
            throw new Error(payload || 'Failed to scan page');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let totalAssets = 0;
          let scrollCount = 0;
          const pendingQueueItems: UploaderQueueItem[] = [];
          const seenUrls = new Set<string>();

          const flushPendingQueueItems = () => {
            if (pendingQueueItems.length === 0) return;
            const batch = pendingQueueItems.splice(0, pendingQueueItems.length);
            addQueuedFiles(batch);
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (abortController.signal.aborted) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              let eventType = '';
              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith('data: ') && eventType) {
                  const data = JSON.parse(line.slice(6));
                  if (eventType === 'status') {
                    setPageImportProgress({
                      message: data.message || 'Processing...',
                      scrollCount: data.scrollCount || 0,
                      imageCount: data.imageCount || 0,
                      pageNum: data.pageNum,
                    });
                    scrollCount = data.scrollCount || 0;
                  } else if (eventType === 'image' || eventType === 'video' || eventType === 'media') {
                    const candidate = data as ImportCandidate;
                    if (candidate?.url) {
                      if (seenUrls.has(candidate.url)) {
                        continue;
                      }
                      seenUrls.add(candidate.url);
                      totalAssets += 1;
                      pendingQueueItems.push(
                        toQueueItem(
                          candidate,
                          createQueueId(),
                          sessionId,
                          totalAssets <= PAGE_IMPORT_PREVIEW_LIMIT
                        )
                      );
                      if (pendingQueueItems.length >= 24) {
                        flushPendingQueueItems();
                      }
                    }
                  } else if (eventType === 'done') {
                    flushPendingQueueItems();
                    setPageImportProgress({
                      message: data.message || 'Complete',
                      scrollCount: data.scrollCount || scrollCount,
                      imageCount: data.imageCount || totalAssets,
                    });
                  } else if (eventType === 'error') {
                    throw new Error(data.error || 'Unknown error');
                  }
                }
              }
            }
          } finally {
            flushPendingQueueItems();
            reader.releaseLock();
          }

          if (abortController.signal.aborted) {
            return;
          }

          if (totalAssets === 0) {
            setPageImportError(
              `No media found after ${scrollCount} scroll${scrollCount !== 1 ? 's' : ''}. The page may require login, use complex lazy-loading, or block automated browsers.`
            );
          } else {
            setSourceUrlIfEmpty(pageImportUrl.trim());
            setPageImportUrl('');
          }
          return;
        }

        const response = await fetch('/api/import/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: pageImportUrl.trim(),
            smallAssetThresholdBytes,
            allowInsecure: pageImportAllowInsecure,
            includeUiChrome: pageImportIncludeUiChrome,
            includeSmallAssets: pageImportIncludeSmallAssets,
            ...(cookieHeaderValue ? { cookieHeader: cookieHeaderValue } : {}),
          }),
        });
        const data = await readImportPageResponse(response);

        const media = Array.isArray(data?.media) ? (data.media as ImportCandidate[]) : [];
        if (media.length === 0) {
          setPageImportError(
            'No media found on that page. The assets may be loaded via JavaScript, try enabling "Scroll mode" to load infinite scroll content.'
          );
          return;
        }

        const includePreviews = media.length <= PAGE_IMPORT_PREVIEW_LIMIT;
        addQueuedFiles(
          media.map((entry) => toQueueItem(entry, createQueueId(), sessionId, includePreviews))
        );
        setSourceUrlIfEmpty(pageImportUrl.trim());
        setPageImportUrl('');
      } catch (error) {
        const aborted =
          error instanceof Error &&
          (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
        if (aborted) {
          return;
        }
        console.error('Import page failed', error);
        setPageImportError(error instanceof Error ? error.message : 'Failed to import page');
      } finally {
        scrollAbortControllerRef.current = null;
        setPageImportLoading(false);
      }
    },
    [
      addQueuedFiles,
      createQueueId,
      ensureImportSession,
      pageImportAllowInsecure,
      pageImportAutoScroll,
      pageImportCookieHeader,
      pageImportIncludeSmallAssets,
      pageImportIncludeUiChrome,
      pageImportMaxAssets,
      pageImportMaxPages,
      pageImportMaxScrolls,
      pageImportScrollDelayMs,
      pageImportScrollMode,
      pageImportSmallAssetThresholdMb,
      pageImportUrl,
      setSourceUrlIfEmpty,
    ]
  );

  const handleImportHtmlFile = useCallback(
    async (file: File) => {
      if (pageImportLoading) return;
      if (!isHtmlFile(file)) {
        setPageImportError('Drop an .html or .htm file.');
        return;
      }

      setPageImportLoading(true);
      setPageImportError(null);
      setPageImportProgress(null);

      try {
        const html = await file.text();
        if (!html.trim()) {
          throw new Error('HTML file is empty');
        }

        const sessionId = await ensureImportSession();
        const sourceUrl = isValidHttpUrl(pageImportUrl.trim()) ? pageImportUrl.trim() : '';
        const smallAssetThresholdBytes = mbToSmallAssetThresholdBytes(
          Number(normalizeSmallAssetThresholdMb(pageImportSmallAssetThresholdMb))
        );
        const response = await fetch('/api/import/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html,
            sourceFilename: file.name,
            ...(sourceUrl ? { sourceUrl } : {}),
            smallAssetThresholdBytes,
            allowInsecure: pageImportAllowInsecure,
            includeUiChrome: pageImportIncludeUiChrome,
            includeSmallAssets: pageImportIncludeSmallAssets,
          }),
        });
        const data = await readImportPageResponse(response);
        const media = Array.isArray(data.media) ? data.media : [];

        if (media.length === 0) {
          setPageImportError(
            data.relativeUrlWarning ||
              'No media found in that HTML file. Relative media URLs require a page URL in the scan field or a <base href> tag.'
          );
          return;
        }

        const includePreviews = media.length <= PAGE_IMPORT_PREVIEW_LIMIT;
        addQueuedFiles(
          media.map((entry) => toQueueItem(entry, createQueueId(), sessionId, includePreviews))
        );
        if (sourceUrl) {
          setSourceUrlIfEmpty(sourceUrl);
          setPageImportUrl('');
        }
        setPageImportProgress({
          message: `Scanned ${file.name}`,
          scrollCount: 0,
          imageCount: media.length,
        });
        if (data.relativeUrlWarning) {
          setPageImportError(data.relativeUrlWarning);
        }
      } catch (error) {
        console.error('Import HTML file failed', error);
        setPageImportError(error instanceof Error ? error.message : 'Failed to import HTML file');
      } finally {
        setPageImportLoading(false);
      }
    },
    [
      addQueuedFiles,
      createQueueId,
      ensureImportSession,
      pageImportAllowInsecure,
      pageImportIncludeSmallAssets,
      pageImportIncludeUiChrome,
      pageImportLoading,
      pageImportSmallAssetThresholdMb,
      pageImportUrl,
      setSourceUrlIfEmpty,
    ]
  );

  const handlePasteCookiesAndScan = useCallback(async () => {
    if (pageImportLoading) return;
    if (!pageImportUrl.trim()) {
      setPageImportError('Enter a page URL first, then paste cookies and scan.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setPageImportError('Clipboard read is unavailable. Paste the Cookie header manually.');
      return;
    }

    try {
      const clipboardText = parseCookieHeaderFromClipboard(await navigator.clipboard.readText());
      if (!clipboardText.trim()) {
        setPageImportError('Clipboard does not contain a Cookie header.');
        return;
      }
      setPageImportCookieHeader(clipboardText.trim());
      await handleImportPage(clipboardText.trim());
    } catch (error) {
      setPageImportError(
        error instanceof Error ? error.message : 'Failed to read cookies from clipboard'
      );
    }
  }, [handleImportPage, pageImportLoading, pageImportUrl]);

  return {
    pageImportUrl,
    setPageImportUrl,
    pageImportLoading,
    pageImportError,
    pageImportAllowInsecure,
    setPageImportAllowInsecure,
    pageImportIncludeUiChrome,
    setPageImportIncludeUiChrome,
    pageImportIncludeSmallAssets,
    setPageImportIncludeSmallAssets,
    pageImportSmallAssetThresholdMb,
    setPageImportSmallAssetThresholdMb,
    pageImportScrollMode,
    setPageImportScrollMode,
    pageImportAutoScroll,
    setPageImportAutoScroll,
    pageImportMaxScrolls,
    setPageImportMaxScrolls,
    pageImportScrollDelayMs,
    setPageImportScrollDelayMs,
    pageImportMaxPages,
    setPageImportMaxPages,
    pageImportMaxAssets,
    setPageImportMaxAssets,
    pageImportCookieHeader,
    setPageImportCookieHeader,
    pageImportProgress,
    setPageImportProgress,
    handleImportPage,
    handleImportHtmlFile,
    handleStopImportPage,
    handlePasteCookiesAndScan,
  };
}
