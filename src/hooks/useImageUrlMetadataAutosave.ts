import { useEffect, useRef, useState } from 'react';
import {
  buildImageMetadataUrlSavePayload,
  type ImageMetadataUrlSaveResponse,
} from '@/components/image-detail/imageMetadataDraft';
import { cleanString } from '@/utils/cloudflareMetadata';

type UrlMetadataImage = {
  id: string;
  originalUrl?: string;
  sourceUrl?: string;
};

type UrlMetadataAutosaveStatus = 'idle' | 'pending' | 'saving';

type UseImageUrlMetadataAutosaveParams = {
  image: UrlMetadataImage | null;
  originalUrlInput: string;
  sourceUrlInput: string;
  disabled?: boolean;
  delayMs?: number;
  onSaved: (imageId: string, response: ImageMetadataUrlSaveResponse) => void;
  onError: (message: string) => void;
};

type UrlMetadataSaveError = { error?: string };

const isUrlDirty = (
  image: UrlMetadataImage,
  originalUrlInput: string,
  sourceUrlInput: string
) => (
  (cleanString(originalUrlInput) ?? '') !== (cleanString(image.originalUrl) ?? '')
  || (cleanString(sourceUrlInput) ?? '') !== (cleanString(image.sourceUrl) ?? '')
);

export function useImageUrlMetadataAutosave({
  image,
  originalUrlInput,
  sourceUrlInput,
  disabled = false,
  delayMs = 700,
  onSaved,
  onError,
}: UseImageUrlMetadataAutosaveParams) {
  const [status, setStatus] = useState<UrlMetadataAutosaveStatus>('idle');
  const generationRef = useRef(0);
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);
  const imageId = image?.id;
  const persistedOriginalUrl = image?.originalUrl;
  const persistedSourceUrl = image?.sourceUrl;

  useEffect(() => {
    onSavedRef.current = onSaved;
    onErrorRef.current = onError;
  }, [onError, onSaved]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (
      !imageId
      || disabled
      || !isUrlDirty({ id: imageId, originalUrl: persistedOriginalUrl, sourceUrl: persistedSourceUrl }, originalUrlInput, sourceUrlInput)
    ) {
      setStatus('idle');
      return;
    }

    const payload = buildImageMetadataUrlSavePayload({ originalUrlInput, sourceUrlInput });
    setStatus('pending');

    const timeoutId = globalThis.setTimeout(async () => {
      if (generationRef.current !== generation) {
        return;
      }

      setStatus('saving');
      try {
        const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({})) as ImageMetadataUrlSaveResponse & UrlMetadataSaveError;
        if (!response.ok || body.error) {
          throw new Error(body.error || 'Failed to save URL metadata');
        }
        if (generationRef.current !== generation) {
          return;
        }
        onSavedRef.current(imageId, body);
        setStatus('idle');
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        setStatus('idle');
        onErrorRef.current(error instanceof Error ? error.message : 'Failed to save URL metadata');
      }
    }, delayMs);

    return () => globalThis.clearTimeout(timeoutId);
  }, [
    delayMs,
    disabled,
    imageId,
    persistedOriginalUrl,
    persistedSourceUrl,
    originalUrlInput,
    sourceUrlInput,
  ]);

  return {
    isPending: status !== 'idle',
    isSaving: status === 'saving',
  };
}
