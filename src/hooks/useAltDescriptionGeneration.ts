import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { requestAltTag, requestDescription, requestDisplayName } from '@/services/imageAltDescriptionService';
import { patchImageMetadata } from '@/services/imageMetadataService';

type Toast = { push: (message: string) => void };

type ImageLike = {
  id: string;
  filename: string;
  uploaded: string;
  altTag?: string;
  description?: string;
  displayName?: string;
};

type TextExtrasLike = {
  imageId?: string;
  description?: string;
  altText?: string;
};

type UseAltDescriptionGenerationParams = {
  imageId?: string;
  descriptionInput: string;
  selectedVariationIds: Set<string>;
  setDescriptionInput: Dispatch<SetStateAction<string>>;
  setDisplayNameInput: Dispatch<SetStateAction<string>>;
  setAltTextInput: (value: string) => void;
  setImage: Dispatch<SetStateAction<ImageLike | null>>;
  setAllImages: Dispatch<SetStateAction<ImageLike[]>>;
  setExtrasRecord?: (updater: (prev: TextExtrasLike | null) => TextExtrasLike) => void;
  toast: Toast;
};

export function useAltDescriptionGeneration({
  imageId,
  descriptionInput,
  selectedVariationIds,
  setDescriptionInput,
  setDisplayNameInput,
  setAltTextInput,
  setImage,
  setAllImages,
  setExtrasRecord,
  toast
}: UseAltDescriptionGenerationParams) {
  const [altLoadingMap, setAltLoadingMap] = useState<Record<string, boolean>>({});
  const [variationAltLoadingMap, setVariationAltLoadingMap] = useState<Record<string, boolean>>({});
  const [descriptionGenerating, setDescriptionGenerating] = useState(false);
  const [displayNameGenerating, setDisplayNameGenerating] = useState(false);

  const variationAltBusy = useMemo(
    () => Object.keys(variationAltLoadingMap).length > 0,
    [variationAltLoadingMap]
  );

  const generateAltTag = useCallback(async (targetId: string) => {
    setAltLoadingMap(prev => ({ ...prev, [targetId]: true }));
    try {
      const { ok, payload } = await requestAltTag(targetId);
      if (!ok || !payload?.altTag) {
        toast.push(payload?.error || 'Failed to generate ALT text');
        return;
      }
      setImage(prev => prev && prev.id === targetId ? { ...prev, altTag: payload.altTag } : prev);
      if (targetId === imageId) {
        setAltTextInput(payload.altTag);
      }
      setAllImages(prev => prev.map(img => img.id === targetId ? { ...img, altTag: payload.altTag } : img));
      if (payload?.saved === false) {
        toast.push(payload?.warning || 'ALT text generated (not saved)');
      } else {
        toast.push('ALT text updated');
      }
    } catch (error) {
      console.error('Failed to generate ALT text:', error);
      toast.push('Failed to generate ALT text');
    } finally {
      setAltLoadingMap(prev => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  }, [imageId, setAllImages, setAltTextInput, setImage, toast]);

  const generateAltForSelectedVariations = useCallback(async () => {
    const ids = Array.from(selectedVariationIds);
    if (ids.length === 0) {
      toast.push('Select at least one variation');
      return;
    }
    setVariationAltLoadingMap((prev) => {
      const next = { ...prev };
      ids.forEach((idValue) => {
        next[idValue] = true;
      });
      return next;
    });
    let updatedCount = 0;
    try {
      for (const idValue of ids) {
        const { ok, payload } = await requestAltTag(idValue);
        if (!ok || !payload?.altTag) {
          continue;
        }
        updatedCount += 1;
        setAllImages((prev) =>
          prev.map((img) => (img.id === idValue ? { ...img, altTag: payload.altTag } : img))
        );
        setImage((prev) => (prev?.id === idValue ? { ...prev, altTag: payload.altTag } : prev));
      }
      toast.push(updatedCount ? `ALT text generated for ${updatedCount} variation(s)` : 'No ALT text generated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate ALT text';
      toast.push(message);
    } finally {
      setVariationAltLoadingMap((prev) => {
        const next = { ...prev };
        ids.forEach((idValue) => {
          delete next[idValue];
        });
        return next;
      });
    }
  }, [selectedVariationIds, setAllImages, setImage, toast]);

  const generateDescription = useCallback(async () => {
    if (!imageId) {
      return;
    }
    setDescriptionGenerating(true);
    try {
      const { ok, payload } = await requestDescription(imageId, descriptionInput || '');
      if (!ok || !payload?.description) {
        toast.push(payload?.error || 'Failed to generate description');
        return;
      }
      const generatedText: string = payload.description;
      const appendText = (current?: string | null) => {
        const base = typeof current === 'string' ? current : '';
        return base.trim() ? `${base}\n\n${generatedText}` : generatedText;
      };
      const persistedText =
        typeof payload.persistedDescription === 'string'
          ? payload.persistedDescription
          : appendText(descriptionInput);
      setDescriptionInput(persistedText);
      setImage(prev => {
        if (!prev || prev.id !== imageId) {
          return prev;
        }
        return {
          ...prev,
          description: persistedText
        };
      });
      setAllImages(prev =>
        prev.map(img =>
          img.id === imageId ? { ...img, description: persistedText } : img
        )
      );
      setExtrasRecord?.(prev => ({
        ...prev,
        imageId,
        description: persistedText
      }));
      toast.push('Generated description appended and saved');
    } catch (error) {
      console.error('Failed to generate description:', error);
      toast.push('Failed to generate description');
    } finally {
      setDescriptionGenerating(false);
    }
  }, [descriptionInput, imageId, setAllImages, setDescriptionInput, setExtrasRecord, setImage, toast]);

  const generateDisplayName = useCallback(async () => {
    if (!imageId) {
      return;
    }
    setDisplayNameGenerating(true);
    try {
      const { ok, payload } = await requestDisplayName(imageId);
      if (!ok || !payload?.displayName) {
        toast.push(payload?.error || 'Failed to generate display name');
        return;
      }
      const suggestedName = payload.displayName;
      setDisplayNameInput(suggestedName);
      const { ok: saved, payload: savePayload } = await patchImageMetadata(imageId, {
        displayName: suggestedName,
      });
      if (!saved) {
        toast.push(savePayload?.error || 'Display name generated, but failed to save');
        return;
      }
      setImage(prev => (prev?.id === imageId ? { ...prev, displayName: suggestedName } : prev));
      setAllImages(prev =>
        prev.map(img => (img.id === imageId ? { ...img, displayName: suggestedName } : img))
      );
      toast.push('Display name generated and saved');
    } catch (error) {
      console.error('Failed to generate display name:', error);
      toast.push('Failed to generate display name');
    } finally {
      setDisplayNameGenerating(false);
    }
  }, [imageId, setAllImages, setDisplayNameInput, setImage, toast]);

  return {
    altLoadingMap,
    variationAltBusy,
    descriptionGenerating,
    displayNameGenerating,
    generateAltTag,
    generateAltForSelectedVariations,
    generateDescription,
    generateDisplayName
  };
}
