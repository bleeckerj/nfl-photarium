'use client';

import { Loader2 } from 'lucide-react';
import type { ImportProgressState } from '@/features/page-import/types';

type PageImportControlsProps = {
  pageImportUrl: string;
  setPageImportUrl: (value: string) => void;
  pageImportLoading: boolean;
  pageImportScrollMode: boolean;
  pageImportAutoScroll: boolean;
  setPageImportAutoScroll: (value: boolean) => void;
  pageImportIncludeSmallAssets: boolean;
  setPageImportIncludeSmallAssets: (value: boolean) => void;
  pageImportIncludeUiChrome: boolean;
  setPageImportIncludeUiChrome: (value: boolean) => void;
  setPageImportScrollMode: (value: boolean) => void;
  pageImportMaxScrolls: string;
  setPageImportMaxScrolls: (value: string) => void;
  pageImportScrollDelayMs: string;
  setPageImportScrollDelayMs: (value: string) => void;
  pageImportMaxPages: string;
  setPageImportMaxPages: (value: string) => void;
  pageImportAllowInsecure: boolean;
  setPageImportAllowInsecure: (value: boolean) => void;
  pageImportCookieHeader: string;
  setPageImportCookieHeader: (value: string) => void;
  pageImportError: string | null;
  pageImportProgress: ImportProgressState;
  handleImportPage: () => Promise<void>;
  handlePasteCookiesAndScan: () => Promise<void>;
};

export function PageImportControls(props: PageImportControlsProps) {
  const {
    pageImportUrl,
    setPageImportUrl,
    pageImportLoading,
    pageImportScrollMode,
    pageImportAutoScroll,
    setPageImportAutoScroll,
    pageImportIncludeSmallAssets,
    setPageImportIncludeSmallAssets,
    pageImportIncludeUiChrome,
    setPageImportIncludeUiChrome,
    setPageImportScrollMode,
    pageImportMaxScrolls,
    setPageImportMaxScrolls,
    pageImportScrollDelayMs,
    setPageImportScrollDelayMs,
    pageImportMaxPages,
    setPageImportMaxPages,
    pageImportAllowInsecure,
    setPageImportAllowInsecure,
    pageImportCookieHeader,
    setPageImportCookieHeader,
    pageImportError,
    pageImportProgress,
    handleImportPage,
    handlePasteCookiesAndScan,
  } = props;

  return (
    <>
      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            placeholder="Scan a page for media URLs"
            value={pageImportUrl}
            onChange={(e) => setPageImportUrl(e.target.value)}
            className="flex-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            disabled={pageImportLoading}
          />
          <button
            type="button"
            onClick={() => {
              void handleImportPage();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pageImportLoading || !pageImportUrl.trim()}
          >
            {pageImportLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {pageImportLoading ? (pageImportScrollMode ? 'Scrolling...' : 'Scanning...') : 'Scan page'}
          </button>
          <button
            type="button"
            onClick={() => {
              void handlePasteCookiesAndScan();
            }}
            className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pageImportLoading || !pageImportUrl.trim()}
          >
            Paste Cookies + Scan
          </button>
        </div>

        {pageImportLoading && pageImportScrollMode && pageImportProgress && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-white/80 p-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-blue-900">{pageImportProgress.message}</p>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-blue-700">
                  {pageImportProgress.pageNum && Number(pageImportMaxPages) > 1 && (
                    <span>Page {pageImportProgress.pageNum}</span>
                  )}
                  <span>{pageImportProgress.scrollCount} scroll{pageImportProgress.scrollCount !== 1 ? 's' : ''}</span>
                  <span>{pageImportProgress.imageCount} asset{pageImportProgress.imageCount !== 1 ? 's' : ''} found</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!pageImportLoading && pageImportProgress && (
          <p className="mt-2 text-xs text-blue-700">
            {pageImportProgress.message} - {pageImportProgress.imageCount} asset{pageImportProgress.imageCount !== 1 ? 's' : ''} added
          </p>
        )}

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={pageImportIncludeSmallAssets}
              onChange={(e) => setPageImportIncludeSmallAssets(e.target.checked)}
              disabled={pageImportLoading}
            />
            Include small assets
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={pageImportIncludeUiChrome}
              onChange={(e) => setPageImportIncludeUiChrome(e.target.checked)}
              disabled={pageImportLoading}
            />
            Include UI chrome
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={pageImportScrollMode}
              onChange={(e) => setPageImportScrollMode(e.target.checked)}
              disabled={pageImportLoading}
            />
            Scroll mode
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={pageImportAllowInsecure}
              onChange={(e) => setPageImportAllowInsecure(e.target.checked)}
              disabled={pageImportLoading}
            />
            Allow insecure TLS
          </label>
        </div>

        {pageImportScrollMode && (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <label className="flex items-center gap-2 text-xs text-gray-700 md:col-span-4">
              <input
                type="checkbox"
                checked={pageImportAutoScroll}
                onChange={(e) => setPageImportAutoScroll(e.target.checked)}
                disabled={pageImportLoading}
              />
              Auto scroll until stable
            </label>
            {!pageImportAutoScroll && (
              <label className="flex flex-col gap-1 text-xs text-gray-700">
                Max scrolls
                <input
                  value={pageImportMaxScrolls}
                  onChange={(e) => setPageImportMaxScrolls(e.target.value)}
                  disabled={pageImportLoading}
                  className="rounded border border-blue-200 px-2 py-1"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-gray-700">
              Scroll delay (ms)
              <input
                value={pageImportScrollDelayMs}
                onChange={(e) => setPageImportScrollDelayMs(e.target.value)}
                disabled={pageImportLoading}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-700">
              Max pages
              <input
                value={pageImportMaxPages}
                onChange={(e) => setPageImportMaxPages(e.target.value)}
                disabled={pageImportLoading}
                className="rounded border border-blue-200 px-2 py-1"
              />
            </label>
          </div>
        )}

        <label className="mt-3 flex flex-col gap-1 text-xs text-gray-700">
          Cookie header
          <textarea
            value={pageImportCookieHeader}
            onChange={(e) => setPageImportCookieHeader(e.target.value)}
            disabled={pageImportLoading}
            rows={3}
            className="rounded-md border border-blue-200 bg-white px-3 py-2 font-mono text-[11px] focus:border-blue-400 focus:outline-none"
            placeholder="Paste a Cookie header for authenticated page scans"
          />
        </label>

        {pageImportError && <p className="mt-1 text-xs text-red-600">{pageImportError}</p>}
        <p className="mt-2 text-[11px] text-gray-600">
          {pageImportScrollMode
            ? 'Scroll mode uses a headless browser to trigger lazy-loading and capture browser-known dimensions.'
            : 'Classic mode scans the HTML and uses lightweight metadata probes before any temp download fallback.'}
        </p>
      </div>
    </>
  );
}
