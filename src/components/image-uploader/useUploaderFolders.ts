'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildUploaderGallerySummaryUrl } from '@/components/image-uploader/fileHelpers';
import type { GalleryImageSummary } from '@/components/image-uploader/types';

type UploaderSummaryPayload = {
  images?: unknown;
  facets?: { folders?: Array<{ value?: unknown }> };
};

// Shared across mounts so StrictMode's doubled effect (and any concurrent
// uploader instances) issue a single folder-summary request per URL.
const uploaderSummaryInflight = new Map<string, Promise<{ ok: boolean; data: UploaderSummaryPayload }>>();

const fetchSummary = (url: string) => {
  const existing = uploaderSummaryInflight.get(url);
  if (existing) return existing;

  const inflight = fetch(url).then(async (resp) => ({ ok: resp.ok, data: await resp.json() }));
  uploaderSummaryInflight.set(url, inflight);
  inflight.catch(() => uploaderSummaryInflight.delete(url));
  // Let a later remount (e.g. after uploads change folders) refetch.
  inflight.finally(() => {
    setTimeout(() => uploaderSummaryInflight.delete(url), 5_000);
  });
  return inflight;
};

const foldersFromSummary = (data: UploaderSummaryPayload): string[] => {
  const facetFolders = Array.isArray(data?.facets?.folders)
    ? data.facets.folders
        .map((entry: { value?: unknown }) => (typeof entry.value === 'string' ? entry.value.trim() : ''))
        .filter((folder: string): folder is string => Boolean(folder))
    : [];
  if (facetFolders.length > 0) return facetFolders;

  return Array.from(
    new Set(
      (data.images as GalleryImageSummary[])
        .map((img) => (img.folder ?? '').trim())
        .filter((folder): folder is string => Boolean(folder))
    )
  );
};

/**
 * The folder list offered by the uploader's folder picker, read from the gallery
 * summary endpoint and merged with whatever this session has already seen.
 */
export function useUploaderFolders(namespace?: string) {
  const [folders, setFolders] = useState<string[]>([]);

  const fetchFolders = useCallback(async () => {
    try {
      const { ok, data } = await fetchSummary(buildUploaderGallerySummaryUrl(namespace));
      if (!ok || !Array.isArray(data.images)) return;
      const fetched = foldersFromSummary(data);
      setFolders((prev) => Array.from(new Set<string>([...prev, ...fetched])));
    } catch (err) {
      console.warn('Failed to fetch folders for uploader', err);
    }
  }, [namespace]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const folderSelectOptions = useMemo(
    () => [
      { value: '', label: 'No folder' },
      ...[...folders]
        .sort((a, b) => a.localeCompare(b))
        .map((folder) => ({ value: folder, label: folder })),
    ],
    [folders]
  );

  return { folders, folderSelectOptions, fetchFolders };
}
