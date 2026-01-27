/**
 * useGalleryData Hook
 * 
 * Manages core gallery data fetching and state.
 * Handles images, color metadata, and namespaces.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CloudflareImage, ColorMetadata } from '../types';

interface UseGalleryDataOptions {
  namespace?: string;
  refreshTrigger?: number;
}

interface UseGalleryDataReturn {
  images: CloudflareImage[];
  loading: boolean;
  refreshingCache: boolean;
  colorMetadataMap: Record<string, ColorMetadata>;
  registryNamespaces: string[];
  fetchImages: (options?: { silent?: boolean; forceRefresh?: boolean }) => Promise<void>;
  setImages: React.Dispatch<React.SetStateAction<CloudflareImage[]>>;
}

export function useGalleryData({ namespace, refreshTrigger }: UseGalleryDataOptions): UseGalleryDataReturn {
  const [images, setImages] = useState<CloudflareImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [colorMetadataMap, setColorMetadataMap] = useState<Record<string, ColorMetadata>>({});
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevNamespaceRef = useRef(namespace);

  // Fetch images from API
  const fetchImages = useCallback(async ({
    silent = false,
    forceRefresh = false,
  }: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!silent) {
      setLoading(true);
    }
    if (forceRefresh) {
      setRefreshingCache(true);
    }
    
    try {
      const params = new URLSearchParams();
      if (forceRefresh) {
        params.set('refresh', '1');
      }
      if (namespace === '') {
        params.set('namespace', '__none__');
      } else if (namespace === '__all__') {
        params.set('namespace', '__all__');
      } else if (namespace && namespace !== '__all__') {
        params.set('namespace', namespace);
      }
      const query = params.toString();
      const url = query ? `/api/images?${query}` : '/api/images';
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      
      if (response.ok) {
        // Deduplicate images by ID to prevent duplicate key errors in React
        const rawImages = data.images || [];
        const seen = new Set<string>();
        const uniqueImages = rawImages.filter((img: CloudflareImage) => {
          if (seen.has(img.id)) return false;
          seen.add(img.id);
          return true;
        });
        setImages(uniqueImages);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch images:', error);
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
        if (forceRefresh) {
          setRefreshingCache(false);
        }
      }
    }
  }, [namespace]);

  // Fetch namespaces on mount
  useEffect(() => {
    let active = true;
    fetch('/api/namespaces')
      .then(response => response.json())
      .then(data => {
        if (!active) return;
        const payload = Array.isArray(data?.namespaces) ? data.namespaces : [];
        setRegistryNamespaces(payload.filter((entry: unknown) => typeof entry === 'string'));
      })
      .catch(error => {
        console.warn('Failed to load namespace registry', error);
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch images when namespace changes
  useEffect(() => {
    // Reset when namespace changes
    if (prevNamespaceRef.current !== namespace) {
      prevNamespaceRef.current = namespace;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    fetchImages();
  }, [namespace, fetchImages]);

  // Refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchImages({ silent: true });
    }
  }, [refreshTrigger, fetchImages]);

  // Fetch color metadata from Redis for displayed images
  useEffect(() => {
    if (images.length === 0) return;

    const fetchColorMetadata = async () => {
      try {
        const idsToFetch = images
          .filter(img => !colorMetadataMap[img.id])
          .map(img => img.id);

        if (idsToFetch.length === 0) return;

        // Batch in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/colors?ids=${chunk.join(',')}`);
          if (response.ok) {
            const data = await response.json();
            if (data.colors) {
              setColorMetadataMap(prev => ({ ...prev, ...data.colors }));
            }
          }
        }
      } catch (error) {
        console.warn('Failed to fetch color metadata:', error);
      }
    };

    fetchColorMetadata();
  }, [images, colorMetadataMap]);

  return {
    images,
    loading,
    refreshingCache,
    colorMetadataMap,
    registryNamespaces,
    fetchImages,
    setImages,
  };
}
