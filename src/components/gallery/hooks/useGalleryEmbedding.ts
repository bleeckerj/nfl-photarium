/**
 * useGalleryEmbedding Hook
 * 
 * Tracks embedding pending status and embedding filters.
 */

'use client';

import { useEffect, useState } from 'react';
import { subscribeEmbeddingPending, clearPendingIfHasEmbeddings, type EmbeddingPendingEntry } from '@/utils/embeddingPending';
import type { CloudflareImage } from '../types';

interface UseGalleryEmbeddingOptions {
  images: CloudflareImage[];
}

interface UseGalleryEmbeddingReturn {
  embeddingPendingMap: Record<string, EmbeddingPendingEntry>;
}

export function useGalleryEmbedding({
  images,
}: UseGalleryEmbeddingOptions): UseGalleryEmbeddingReturn {
  const [embeddingPendingMap, setEmbeddingPendingMap] = useState<Record<string, EmbeddingPendingEntry>>({});

  useEffect(() => {
    return subscribeEmbeddingPending(setEmbeddingPendingMap);
  }, []);

  useEffect(() => {
    for (const image of images) {
      if (image.hasClipEmbedding || image.hasColorEmbedding) {
        clearPendingIfHasEmbeddings(image.id, image.hasClipEmbedding, image.hasColorEmbedding);
      }
    }
  }, [images]);

  return {
    embeddingPendingMap,
  };
}
