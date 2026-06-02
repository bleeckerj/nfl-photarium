import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CloudflareImage } from '../types';
import type { ColorSearchResultRow } from '../colorSearch';

const COLOR_METADATA_RETRY_MS = 5 * 60 * 1000;
const PROMPT_THIS_RETRY_MS = 60 * 1000;
const COLOR_SEARCH_LIMIT = 100;

type ColorMetadataMap = Record<string, { dominantColors?: string[]; averageColor?: string }>;

type UseGalleryMetadataEffectsOptions = {
  colorSearchHex: string | null;
  enableColorMetadata: boolean;
  images: CloudflareImage[];
  namespace?: string;
  pageImages: CloudflareImage[];
  promptThisMapRef: MutableRefObject<Record<string, string | null>>;
  requestedColorIdsRef: MutableRefObject<Map<string, number>>;
  requestedPromptIdsRef: MutableRefObject<Map<string, number>>;
  searchTerm: string;
  setColorMetadataMap: Dispatch<SetStateAction<ColorMetadataMap>>;
  setColorSearchError: Dispatch<SetStateAction<string | null>>;
  setColorSearchLoading: Dispatch<SetStateAction<boolean>>;
  setColorSearchRows: Dispatch<SetStateAction<ColorSearchResultRow[]>>;
  setImages: Dispatch<SetStateAction<CloudflareImage[]>>;
  setPromptThisMap: Dispatch<SetStateAction<Record<string, string | null>>>;
};

export function useGalleryMetadataEffects({
  colorSearchHex,
  enableColorMetadata,
  images,
  namespace,
  pageImages,
  promptThisMapRef,
  requestedColorIdsRef,
  requestedPromptIdsRef,
  searchTerm,
  setColorMetadataMap,
  setColorSearchError,
  setColorSearchLoading,
  setColorSearchRows,
  setImages,
  setPromptThisMap,
}: UseGalleryMetadataEffectsOptions) {
  useEffect(() => {
    if (!colorSearchHex) {
      setColorSearchRows([]);
      setColorSearchError(null);
      setColorSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const searchNamespace = namespace === '__all__' ? null : (namespace ?? '');

    const fetchColorSearchResults = async () => {
      setColorSearchLoading(true);
      setColorSearchError(null);

      try {
        const response = await fetch('/api/images/search', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-photarium-component': 'ImageGallery',
            'x-photarium-trigger': 'swatch-click',
            'x-photarium-source': 'ui',
          },
          body: JSON.stringify({
            type: 'color',
            query: colorSearchHex,
            limit: COLOR_SEARCH_LIMIT,
            namespace: searchNamespace,
            diagnostics: {
              component: 'ImageGallery',
              trigger: 'swatch-click',
            },
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || 'Color search failed');
        }

        setColorSearchRows(Array.isArray(data?.results) ? data.results : []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Failed to fetch color search results:', error);
        setColorSearchRows([]);
        setColorSearchError(error instanceof Error ? error.message : 'Color search failed');
      } finally {
        if (!controller.signal.aborted) {
          setColorSearchLoading(false);
        }
      }
    };

    void fetchColorSearchResults();

    return () => controller.abort();
  }, [colorSearchHex, namespace, setColorSearchError, setColorSearchLoading, setColorSearchRows]);

  // Enrich only the visible page with Redis metadata after initial render.
  useEffect(() => {
    if (pageImages.length === 0) return;

    const fetchVisiblePageMetadata = async () => {
      try {
        const idsToFetch = pageImages
          .map((img) => img.id)
          .filter((id) => {
            const lastRequestedAt = requestedColorIdsRef.current.get(id);
            return !lastRequestedAt || Date.now() - lastRequestedAt > COLOR_METADATA_RETRY_MS;
          });

        if (idsToFetch.length === 0) return;

        for (const id of idsToFetch) {
          requestedColorIdsRef.current.set(id, Date.now());
        }

        const chunkSize = 60;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/colors?ids=${encodeURIComponent(chunk.join(','))}`);
          if (!response.ok) continue;
          const data = await response.json();
          const colors = data?.colors;
          if (!colors || typeof colors !== 'object') continue;

          setImages((prev) =>
            prev.map((img) => {
              const meta = colors[img.id] as
                | {
                    dominantColors?: string[];
                    averageColor?: string;
                    hasClipEmbedding?: boolean;
                    hasColorEmbedding?: boolean;
                  }
                | undefined;
              if (!meta) return img;
              const hasRedisMetadata =
                Array.isArray(meta.dominantColors) ||
                typeof meta.averageColor === 'string' ||
                Boolean(meta.hasClipEmbedding) ||
                Boolean(meta.hasColorEmbedding);
              if (!hasRedisMetadata) {
                return img;
              }
              return {
                ...img,
                hasClipEmbedding: img.hasClipEmbedding || Boolean(meta.hasClipEmbedding),
                hasColorEmbedding: img.hasColorEmbedding || Boolean(meta.hasColorEmbedding),
                dominantColors: meta.dominantColors ?? img.dominantColors,
                averageColor: meta.averageColor ?? img.averageColor,
              };
            })
          );

          if (enableColorMetadata) {
            setColorMetadataMap((prev) => ({ ...prev, ...colors }));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch visible page metadata:', error);
      }
    };

    void fetchVisiblePageMetadata();
  }, [enableColorMetadata, pageImages, requestedColorIdsRef, setColorMetadataMap, setImages]);

  // Fetch Prompt This text only when a search term is active.
  // Prompt This records live outside Cloudflare metadata, so we batch-load them on demand.
  useEffect(() => {
    if (!searchTerm.trim()) return;
    if (images.length === 0) return;

    let cancelled = false;

    const fetchPrompts = async () => {
      try {
        const idsToFetch = images
          .map((img) => img.id)
          .filter((id) => {
            if (Object.prototype.hasOwnProperty.call(promptThisMapRef.current, id)) return false;
            const lastRequestedAt = requestedPromptIdsRef.current.get(id);
            return !lastRequestedAt || Date.now() - lastRequestedAt > PROMPT_THIS_RETRY_MS;
          });

        if (idsToFetch.length === 0) return;
        idsToFetch.forEach((id) => requestedPromptIdsRef.current.set(id, Date.now()));

        const chunkSize = 50;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          if (cancelled) return;
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/prompts?ids=${encodeURIComponent(chunk.join(','))}`);
          if (!response.ok) continue;
          const data = await response.json();
          if (cancelled) return;
          if (data?.prompts && typeof data.prompts === 'object') {
            setPromptThisMap((prev) => ({ ...prev, ...data.prompts }));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch Prompt This text:', error);
      }
    };

    void fetchPrompts();

    return () => {
      cancelled = true;
    };
  }, [images, promptThisMapRef, requestedPromptIdsRef, searchTerm, setPromptThisMap]);
}
