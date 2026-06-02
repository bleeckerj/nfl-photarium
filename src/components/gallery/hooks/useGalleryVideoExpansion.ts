import { useCallback, useEffect, useRef } from 'react';
import type { VideoMetaState } from '../serverState';

const VIDEO_LIMIT_STEP = 150;

type UseGalleryVideoExpansionOptions = {
  currentPage: number;
  loading: boolean;
  namespace?: string;
  setVideoLimitOverride: (value: number | null | ((previous: number | null) => number | null)) => void;
  totalPages: number;
  videoMeta: VideoMetaState;
};

export function useGalleryVideoExpansion({
  currentPage,
  loading,
  namespace,
  setVideoLimitOverride,
  totalPages,
  videoMeta,
}: UseGalleryVideoExpansionOptions) {
  const videoAutoExpandPageRef = useRef<number | null>(null);

  const loadMoreVideos = useCallback(() => {
    setVideoLimitOverride((prev) => {
      const base = typeof prev === 'number' && prev > 0
        ? prev
        : (videoMeta?.limit && videoMeta.limit > 0 ? videoMeta.limit : VIDEO_LIMIT_STEP);
      return base + VIDEO_LIMIT_STEP;
    });
  }, [setVideoLimitOverride, videoMeta]);

  useEffect(() => {
    if (!videoMeta?.enabled || !videoMeta.truncated) return;
    if (loading) return;
    if (currentPage <= 1) return;
    if (currentPage < totalPages) return;
    if (videoAutoExpandPageRef.current === currentPage) return;
    videoAutoExpandPageRef.current = currentPage;
    loadMoreVideos();
  }, [videoMeta, loading, currentPage, totalPages, loadMoreVideos]);

  useEffect(() => {
    if (!videoMeta?.truncated) {
      videoAutoExpandPageRef.current = null;
    }
  }, [videoMeta]);

  useEffect(() => {
    videoAutoExpandPageRef.current = null;
  }, [namespace]);

  return { loadMoreVideos };
}
