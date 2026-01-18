'use client';

import { useState, useEffect, useRef } from 'react';
import { getImageDimensions, calculateAspectRatio, getCloudflareImageUrl } from '@/utils/imageUtils';

interface AspectRatioResult {
  aspectRatio: string | null;
  dimensions: { width: number; height: number } | null;
  loading: boolean;
  error: string | null;
}

// Cache for aspect ratios to avoid recalculation
const aspectRatioCache = new Map<string, { aspectRatio: string; dimensions: { width: number; height: number } }>();

/**
 * Custom hook to calculate and cache aspect ratios for images
 * @param imageId - The Cloudflare image ID
 * @param shouldCalculate - Whether to calculate the aspect ratio (default: true)
 * @returns Object with aspect ratio, dimensions, loading state, and error
 */
export function useImageAspectRatio(imageId: string, shouldCalculate: boolean = true): AspectRatioResult {
  // Initialize from cache synchronously to prevent flickering
  const cached = imageId ? aspectRatioCache.get(imageId) : undefined;
  
  const [aspectRatio, setAspectRatio] = useState<string | null>(cached?.aspectRatio ?? null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(cached?.dimensions ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!imageId || !shouldCalculate) {
      return;
    }

    // Check cache first
    const cached = aspectRatioCache.get(imageId);
    if (cached) {
      setAspectRatio(cached.aspectRatio);
      setDimensions(cached.dimensions);
      setLoading(false);
      setError(null);
      return;
    }

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const calculateRatio = async () => {
      // Early return if aborted
      if (abortController.signal.aborted) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Use the original/public variant to get true dimensions
        const imageUrl = getCloudflareImageUrl(imageId, 'public');
        
        // Check if still should proceed
        if (abortController.signal.aborted) {
          return;
        }

        const imageDimensions = await getImageDimensions(imageUrl);

        // Check again after async operation
        if (abortController.signal.aborted) {
          return;
        }

        const ratioResult = calculateAspectRatio(imageDimensions.width, imageDimensions.height);

        // Cache the result
        aspectRatioCache.set(imageId, {
          aspectRatio: ratioResult.common,
          dimensions: ratioResult.dimensions
        });

        // Set state only if not aborted
        if (!abortController.signal.aborted) {
          setAspectRatio(ratioResult.common);
          setDimensions(ratioResult.dimensions);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.warn(`Failed to calculate aspect ratio for image ${imageId}:`, err);
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    // Add a small delay to avoid calculating ratios for images that are quickly scrolled past
    const timeoutId = setTimeout(() => {
      if (!abortController.signal.aborted) {
        calculateRatio();
      }
    }, 100);

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [imageId, shouldCalculate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    aspectRatio,
    dimensions,
    loading,
    error
  };
}

/**
 * Hook for batch calculating aspect ratios for multiple images
 * Useful for grid views where we want to calculate many at once with controlled concurrency
 */
export function useBatchAspectRatio(imageIds: string[], maxConcurrent: number = 3) {
  const [results, setResults] = useState<Map<string, AspectRatioResult>>(new Map());

  useEffect(() => {
    if (imageIds.length === 0) {
      return;
    }

    const newResults = new Map<string, AspectRatioResult>();
    
    // Initialize all results
    imageIds.forEach(id => {
      const cached = aspectRatioCache.get(id);
      if (cached) {
        newResults.set(id, {
          aspectRatio: cached.aspectRatio,
          dimensions: cached.dimensions,
          loading: false,
          error: null
        });
      } else {
        newResults.set(id, {
          aspectRatio: null,
          dimensions: null,
          loading: true,
          error: null
        });
      }
    });

    setResults(new Map(newResults));

    // Process uncached images in batches
    const uncachedIds = imageIds.filter(id => !aspectRatioCache.has(id));
    
    if (uncachedIds.length === 0) {
      return;
    }

    const processInBatches = async () => {
      for (let i = 0; i < uncachedIds.length; i += maxConcurrent) {
        const batch = uncachedIds.slice(i, i + maxConcurrent);
        
        const promises = batch.map(async (imageId) => {
          try {
            const imageUrl = getCloudflareImageUrl(imageId, 'public');
            const imageDimensions = await getImageDimensions(imageUrl);
            const ratioResult = calculateAspectRatio(imageDimensions.width, imageDimensions.height);

            // Cache the result
            aspectRatioCache.set(imageId, {
              aspectRatio: ratioResult.common,
              dimensions: ratioResult.dimensions
            });

            return {
              imageId,
              result: {
                aspectRatio: ratioResult.common,
                dimensions: ratioResult.dimensions,
                loading: false,
                error: null
              }
            };
          } catch (err) {
            return {
              imageId,
              result: {
                aspectRatio: null,
                dimensions: null,
                loading: false,
                error: err instanceof Error ? err.message : 'Unknown error'
              }
            };
          }
        });

        const batchResults = await Promise.all(promises);

        setResults(prev => {
          const updated = new Map(prev);
          batchResults.forEach(({ imageId, result }) => {
            updated.set(imageId, result);
          });
          return updated;
        });
      }
    };

    processInBatches();
  }, [imageIds, maxConcurrent]);

  return results;
}