import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import type {
  ImageMetadataDraftAsset,
  ImageMetadataDraftExtras,
  ImageMetadataDraftValues,
  ImageMetadataSaveResponse,
} from '@/components/image-detail/imageMetadataDraft';
import {
  applyImageMetadataSaveResponse,
  buildImageMetadataSavePayload,
  emptyImageMetadataDraftValues,
  isImageMetadataDraftDirty,
  resolveImageMetadataDraftValuesAfterSave,
  resolveImageMetadataDraftValues,
} from '@/components/image-detail/imageMetadataDraft';

type UseImageMetadataDraftParams<TImage extends ImageMetadataDraftAsset> = {
  image: TImage | null;
  extrasRecord: ImageMetadataDraftExtras;
};

export function useImageMetadataDraft<TImage extends ImageMetadataDraftAsset>({
  image,
  extrasRecord,
}: UseImageMetadataDraftParams<TImage>) {
  const [values, setValues] = useState<ImageMetadataDraftValues>(() => emptyImageMetadataDraftValues());
  const imageRef = useRef<TImage | null>(image);
  const extrasRecordRef = useRef<ImageMetadataDraftExtras>(extrasRecord);
  const hasUserChangesRef = useRef(false);

  useEffect(() => {
    imageRef.current = image;
  }, [image]);

  useEffect(() => {
    extrasRecordRef.current = extrasRecord;
  }, [extrasRecord]);

  const resolveStateAction = useCallback(<T,>(current: T, next: SetStateAction<T>) => (
    typeof next === 'function' ? (next as (previous: T) => T)(current) : next
  ), []);

  const resetFromImage = useCallback((
    nextImage: TImage | null | undefined = imageRef.current,
    nextExtras: ImageMetadataDraftExtras = extrasRecordRef.current
  ) => {
    hasUserChangesRef.current = false;
    setValues(resolveImageMetadataDraftValues(nextImage, nextExtras));
  }, []);

  const applyDraft = useCallback((draft: Partial<ImageMetadataDraftValues>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, ...draft }));
  }, []);

  // Extras load independently from the image. Rebase a pristine draft when the
  // pair becomes available, but never overwrite values an operator has touched.
  const hydratePersistedValues = useCallback((
    nextImage: TImage | null | undefined = imageRef.current,
    nextExtras: ImageMetadataDraftExtras = extrasRecordRef.current
  ) => {
    if (hasUserChangesRef.current) {
      return;
    }
    setValues(resolveImageMetadataDraftValues(nextImage, nextExtras));
  }, []);

  const setFolderSelect = useCallback((folderSelect: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, folderSelect: resolveStateAction(prev.folderSelect, folderSelect) }));
  }, [resolveStateAction]);

  const setNewFolderInput = useCallback((newFolderInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, newFolderInput: resolveStateAction(prev.newFolderInput, newFolderInput) }));
  }, [resolveStateAction]);

  const setTagsInput = useCallback((tagsInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, tagsInput: resolveStateAction(prev.tagsInput, tagsInput) }));
  }, [resolveStateAction]);

  const setDescriptionInput = useCallback((descriptionInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, descriptionInput: resolveStateAction(prev.descriptionInput, descriptionInput) }));
  }, [resolveStateAction]);

  const setAltTextInput = useCallback((altTextInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, altTextInput: resolveStateAction(prev.altTextInput, altTextInput) }));
  }, [resolveStateAction]);

  const setOriginalUrlInput = useCallback((originalUrlInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, originalUrlInput: resolveStateAction(prev.originalUrlInput, originalUrlInput) }));
  }, [resolveStateAction]);

  const setSourceUrlInput = useCallback((sourceUrlInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, sourceUrlInput: resolveStateAction(prev.sourceUrlInput, sourceUrlInput) }));
  }, [resolveStateAction]);

  const setDisplayNameInput = useCallback((displayNameInput: SetStateAction<string>) => {
    hasUserChangesRef.current = true;
    setValues((prev) => ({ ...prev, displayNameInput: resolveStateAction(prev.displayNameInput, displayNameInput) }));
  }, [resolveStateAction]);

  const isDirty = useMemo(
    () => isImageMetadataDraftDirty(values, image, extrasRecord),
    [extrasRecord, image, values]
  );

  const buildSavePayload = useCallback(() => {
    if (!image) {
      return null;
    }
    return buildImageMetadataSavePayload(values, image);
  }, [image, values]);

  const applySavedResponse = useCallback((target: TImage, response: ImageMetadataSaveResponse) => (
    applyImageMetadataSaveResponse(target, response, values)
  ), [values]);

  const markSaved = useCallback((savedImage: TImage) => {
    hasUserChangesRef.current = false;
    setValues(resolveImageMetadataDraftValuesAfterSave(savedImage, values));
  }, [values]);

  return {
    draft: values,
    folderSelect: values.folderSelect,
    newFolderInput: values.newFolderInput,
    tagsInput: values.tagsInput,
    descriptionInput: values.descriptionInput,
    altTextInput: values.altTextInput,
    originalUrlInput: values.originalUrlInput,
    sourceUrlInput: values.sourceUrlInput,
    displayNameInput: values.displayNameInput,
    setFolderSelect,
    setNewFolderInput,
    setTagsInput,
    setDescriptionInput,
    setAltTextInput,
    setOriginalUrlInput,
    setSourceUrlInput,
    setDisplayNameInput,
    applyDraft,
    resetFromImage,
    hydratePersistedValues,
    isDirty,
    buildSavePayload,
    applySavedResponse,
    markSaved,
  };
}
