'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { buildUrlReviewManifest, type UrlReviewCandidate } from '@/features/url-review/types';
import { useUrlReviewScanner } from '@/features/url-review/hooks/useUrlReviewScanner';

const getHost = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'unresolved source';
  }
};

const filenameFromUrl = (value: string) => {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '') || 'remote-image';
  } catch {
    return 'remote-image';
  }
};

const downloadManifest = (manifest: ReturnType<typeof buildUrlReviewManifest>) => {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'photarium-image-urls.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const UrlReviewCard = ({
  candidate,
  kept,
  broken,
  onToggle,
  onBroken,
}: {
  candidate: UrlReviewCandidate;
  kept: boolean;
  broken: boolean;
  onToggle: () => void;
  onBroken: () => void;
}) => (
  <article className={`rounded-xl border bg-white p-3 ${kept ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-stone-200'}`}>
    <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-stone-500">
      <span>{candidate.kind === 'image' ? 'Image' : 'Video'} · {candidate.filename || filenameFromUrl(candidate.url)}</span>
      <span className={kept ? 'font-semibold text-emerald-700' : ''}>{kept ? 'Kept' : 'Review'}</span>
    </div>
    <div className="mt-3 flex min-h-64 items-center justify-center overflow-hidden rounded-lg bg-stone-100 p-2">
      {broken ? (
        <p className="text-xs text-stone-500">Preview unavailable</p>
      ) : candidate.kind === 'video' ? (
        candidate.posterUrl ? (
          <img src={candidate.posterUrl} alt={candidate.filename} className="max-h-[420px] w-auto max-w-full object-contain" onError={onBroken} />
        ) : (
          <p className="text-xs text-stone-500">Video URL</p>
        )
      ) : (
        <img src={candidate.previewUrl || candidate.url} alt={candidate.filename} loading="lazy" referrerPolicy="no-referrer" className="max-h-[420px] w-auto max-w-full object-contain" onError={onBroken} />
      )}
    </div>
    <p className="mt-3 truncate text-xs font-medium text-stone-800" title={candidate.url}>{getHost(candidate.url)}</p>
    <p className="mt-1 break-all text-[11px] leading-4 text-stone-500">{candidate.url}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={onToggle} className={`rounded-md px-3 py-1.5 text-xs font-medium text-white ${kept ? 'bg-stone-600 hover:bg-stone-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {kept ? 'Remove from JSON' : 'Keep in JSON'}
      </button>
      <a href={candidate.url} target="_blank" rel="noreferrer" className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-100">
        Open source
      </a>
    </div>
  </article>
);

export default function UrlReviewPage() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [filter, setFilter] = useState('');
  const [keptUrls, setKeptUrls] = useState<Set<string>>(new Set());
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [maxScrolls, setMaxScrolls] = useState('10');
  const [maxPages, setMaxPages] = useState('1');
  const [maxAssets, setMaxAssets] = useState('250');
  const [includeSmallAssets, setIncludeSmallAssets] = useState(false);
  const [includeUiChrome, setIncludeUiChrome] = useState(false);
  const [showKeptOnly, setShowKeptOnly] = useState(false);
  const { candidates, progress, loading, error, scan, stop } = useUrlReviewScanner();

  const visibleCandidates = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (showKeptOnly && !keptUrls.has(candidate.url)) return false;
      return !query || `${candidate.url} ${candidate.filename} ${getHost(candidate.url)}`.toLowerCase().includes(query);
    });
  }, [candidates, filter, keptUrls, showKeptOnly]);

  const toggleKept = (url: string) => {
    setKeptUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const setAllVisible = (keep: boolean) => {
    setKeptUrls((current) => {
      const next = new Set(current);
      visibleCandidates.forEach((candidate) => {
        if (keep) next.add(candidate.url);
        else next.delete(candidate.url);
      });
      return next;
    });
  };

  const exportManifest = () => {
    downloadManifest(buildUrlReviewManifest(sourceUrl.trim(), candidates, keptUrls));
  };

  const scanPage = () => {
    setKeptUrls(new Set());
    setBrokenUrls(new Set());
    void scan(sourceUrl, {
      autoScrollUntilStable: autoScroll,
      maxScrolls: Number(maxScrolls) || 10,
      maxPages: Number(maxPages) || 1,
      maxAssets: Number(maxAssets) || 250,
      includeSmallAssets,
      includeUiChrome,
    });
  };

  const imageCount = candidates.filter((candidate) => candidate.kind === 'image').length;
  const keptImageCount = candidates.filter((candidate) => candidate.kind === 'image' && keptUrls.has(candidate.url)).length;

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Photarium source intake</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-5xl">Build an image URL list from a page.</h1>
            </div>
            <Link href="/" className="text-xs text-stone-600 underline hover:text-stone-900">Back to gallery</Link>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-stone-600">Enter a public page URL. Photarium opens it in a browser-backed scanner, follows lazy-loaded content, and presents the discovered media for review before you export an ingestable JSON list.</p>
        </header>

        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex-1 text-xs text-stone-600">
              Source page URL
              <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://archive.org/details/vintageai" disabled={loading} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none" />
            </label>
            <button type="button" onClick={loading ? stop : scanPage} disabled={!loading && !sourceUrl.trim()} className={`rounded-md px-4 py-2 text-sm font-medium text-white ${loading ? 'bg-amber-600 hover:bg-amber-700' : 'bg-stone-900 hover:bg-stone-700'} disabled:cursor-not-allowed disabled:opacity-40`}>
              {loading ? 'Stop browser scan' : 'Scan page'}
            </button>
          </div>
          <div className="mt-4 grid gap-3 border-t border-stone-100 pt-4 text-xs text-stone-600 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex items-center gap-2"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} disabled={loading} /> Auto-scroll until stable</label>
            {!autoScroll && <label>Max scrolls<input value={maxScrolls} onChange={(event) => setMaxScrolls(event.target.value)} disabled={loading} className="mt-1 w-full rounded border border-stone-300 px-2 py-1" /></label>}
            <label>Max pages<input value={maxPages} onChange={(event) => setMaxPages(event.target.value)} disabled={loading} className="mt-1 w-full rounded border border-stone-300 px-2 py-1" /></label>
            <label>Max assets<input value={maxAssets} onChange={(event) => setMaxAssets(event.target.value)} disabled={loading} className="mt-1 w-full rounded border border-stone-300 px-2 py-1" /></label>
            <div className="space-y-2"><label className="flex items-center gap-2"><input type="checkbox" checked={includeSmallAssets} onChange={(event) => setIncludeSmallAssets(event.target.checked)} disabled={loading} /> Include small assets</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeUiChrome} onChange={(event) => setIncludeUiChrome(event.target.checked)} disabled={loading} /> Include UI chrome</label></div>
          </div>
          {progress && <p className="mt-3 text-xs text-stone-600">{progress.message} · {progress.scrollCount} scrolls · {progress.imageCount} media found</p>}
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-4 text-xs text-stone-600"><span>Loaded <strong className="text-stone-900">{candidates.length}</strong></span><span>Images <strong className="text-stone-900">{imageCount}</strong></span><span>Kept for JSON <strong className="text-emerald-700">{keptImageCount}</strong></span></div>
          <div className="flex flex-wrap gap-2"><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter URL, filename, or host" className="rounded-md border border-stone-300 px-3 py-2 text-xs" /><button type="button" onClick={() => setAllVisible(true)} disabled={!visibleCandidates.length} className="rounded-md border border-emerald-300 px-3 py-2 text-xs text-emerald-700 disabled:opacity-40">Keep visible</button><button type="button" onClick={() => setAllVisible(false)} disabled={!visibleCandidates.length} className="rounded-md border border-stone-300 px-3 py-2 text-xs text-stone-700 disabled:opacity-40">Clear visible</button><button type="button" onClick={() => setShowKeptOnly((value) => !value)} disabled={!keptUrls.size} className="rounded-md border border-stone-300 px-3 py-2 text-xs text-stone-700 disabled:opacity-40">{showKeptOnly ? 'Show all' : 'Show kept only'}</button><button type="button" onClick={() => { void navigator.clipboard.writeText([...keptUrls].join('\n')); }} disabled={!keptImageCount} className="rounded-md border border-stone-300 px-3 py-2 text-xs text-stone-700 disabled:opacity-40">Copy kept URLs</button><button type="button" onClick={exportManifest} disabled={!keptImageCount} className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40">Export JSON</button></div>
        </section>

        {visibleCandidates.length === 0 ? <div className="rounded-xl border border-dashed border-stone-300 bg-white p-12 text-center text-sm text-stone-500">{candidates.length ? 'No media matches the current filter.' : 'Enter a page URL and scan it to begin.'}</div> : <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">{visibleCandidates.map((candidate) => <UrlReviewCard key={candidate.id || candidate.url} candidate={candidate} kept={keptUrls.has(candidate.url)} broken={brokenUrls.has(candidate.url)} onToggle={() => toggleKept(candidate.url)} onBroken={() => setBrokenUrls((current) => new Set(current).add(candidate.url))} />)}</section>}
      </div>
    </main>
  );
}
