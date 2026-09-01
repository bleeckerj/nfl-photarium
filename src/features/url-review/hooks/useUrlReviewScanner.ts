'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UrlReviewCandidate, UrlReviewProgress } from '@/features/url-review/types';

type UrlReviewScanOptions = {
  maxScrolls: number;
  maxPages: number;
  maxAssets: number;
  autoScrollUntilStable: boolean;
  includeSmallAssets: boolean;
  includeUiChrome: boolean;
};

const isCandidate = (value: unknown): value is UrlReviewCandidate => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UrlReviewCandidate>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.kind === 'image' || candidate.kind === 'video') &&
    typeof candidate.url === 'string' &&
    typeof candidate.filename === 'string'
  );
};

const readStream = async (
  response: Response,
  signal: AbortSignal,
  onCandidate: (candidate: UrlReviewCandidate) => void,
  onProgress: (progress: UrlReviewProgress) => void
): Promise<UrlReviewProgress | null> => {
  if (!response.body) throw new Error('The browser scan returned no stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  let finalProgress: UrlReviewProgress | null = null;

  const processLine = (line: string) => {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
      return;
    }
    if (!line.startsWith('data: ') || !eventType) return;

    const data = JSON.parse(line.slice(6)) as unknown;
    if (eventType === 'status' || eventType === 'done') {
      const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const progress: UrlReviewProgress = {
        message: typeof record.message === 'string' ? record.message : 'Scanning...',
        scrollCount: typeof record.scrollCount === 'number' ? record.scrollCount : 0,
        imageCount: typeof record.imageCount === 'number' ? record.imageCount : 0,
        pageNum: typeof record.pageNum === 'number' ? record.pageNum : undefined,
      };
      finalProgress = progress;
      onProgress(progress);
    } else if (eventType === 'media' && isCandidate(data)) {
      onCandidate(data);
    } else if (eventType === 'error') {
      const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      throw new Error(typeof record.error === 'string' ? record.error : 'Browser scan failed.');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) return finalProgress;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(processLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer.trim());
    return finalProgress;
  } finally {
    reader.releaseLock();
  }
};

export function useUrlReviewScanner() {
  const [candidates, setCandidates] = useState<UrlReviewCandidate[]>([]);
  const [progress, setProgress] = useState<UrlReviewProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
  }, []);

  const scan = useCallback(async (sourceUrl: string, options: UrlReviewScanOptions) => {
    const trimmedUrl = sourceUrl.trim();
    if (!trimmedUrl || loading) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setCandidates([]);
    setProgress({ message: 'Starting browser scan...', scrollCount: 0, imageCount: 0 });
    setError(null);
    setLoading(true);

    const nextCandidates: UrlReviewCandidate[] = [];
    const seenUrls = new Set<string>();
    try {
      const response = await fetch('/api/import/page/scroll/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          url: trimmedUrl,
          maxScrolls: options.maxScrolls,
          maxPages: options.maxPages,
          maxAssets: options.maxAssets,
          autoScrollUntilStable: options.autoScrollUntilStable,
          includeSmallAssets: options.includeSmallAssets,
          includeUiChrome: options.includeUiChrome,
        }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Browser scan failed.');
      }

      await readStream(
        response,
        controller.signal,
        (candidate) => {
          if (seenUrls.has(candidate.url)) return;
          seenUrls.add(candidate.url);
          nextCandidates.push(candidate);
          setCandidates([...nextCandidates]);
        },
        setProgress
      );
      if (!controller.signal.aborted && nextCandidates.length === 0) {
        setError('No media was found on that page.');
      }
    } catch (scanError) {
      if (!controller.signal.aborted) {
        setError(scanError instanceof Error ? scanError.message : 'Browser scan failed.');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  return { candidates, progress, loading, error, scan, stop };
}
