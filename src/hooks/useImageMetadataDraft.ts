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
    setValues(resolveImageMetadataDraftValues(nextImage, nextExtras));
  }, []);

  const applyDraft = useCallback((draft: Partial<ImageMetadataDraftValues>) => {
    setValues((prev) => ({ ...prev, ...draft }));
  }, []);

  const setFolderSelect = useCallback((folderSelect: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, folderSelect: resolveStateAction(prev.folderSelect, folderSelect) }));
  }, [resolveStateAction]);

  const setNewFolderInput = useCallback((newFolderInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, newFolderInput: resolveStateAction(prev.newFolderInput, newFolderInput) }));
  }, [resolveStateAction]);

  const setTagsInput = useCallback((tagsInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, tagsInput: resolveStateAction(prev.tagsInput, tagsInput) }));
  }, [resolveStateAction]);

  const setDescriptionInput = useCallback((descriptionInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, descriptionInput: resolveStateAction(prev.descriptionInput, descriptionInput) }));
  }, [resolveStateAction]);

  const setAltTextInput = useCallback((altTextInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, altTextInput: resolveStateAction(prev.altTextInput, altTextInput) }));
  }, [resolveStateAction]);

  const setOriginalUrlInput = useCallback((originalUrlInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, originalUrlInput: resolveStateAction(prev.originalUrlInput, originalUrlInput) }));
  }, [resolveStateAction]);

  const setSourceUrlInput = useCallback((sourceUrlInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, sourceUrlInput: resolveStateAction(prev.sourceUrlInput, sourceUrlInput) }));
  }, [resolveStateAction]);

  const setDisplayNameInput = useCallback((displayNameInput: SetStateAction<string>) => {
    setValues((prev) => ({ ...prev, displayNameInput: resolveStateAction(prev.displayNameInput, displayNameInput) }));
  }, [resolveStateAction]);

  const setClearExif = useCallback((clearExif: SetStateAction<boolean>) => {
    setValues((prev) => ({ ...prev, clearExif: resolveStateAction(prev.clearExif, clearExif) }));
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
    clearExif: values.clearExif,
    setFolderSelect,
    setNewFolderInput,
    setTagsInput,
    setDescriptionInput,
    setAltTextInput,
    setOriginalUrlInput,
    setSourceUrlInput,
    setDisplayNameInput,
    setClearExif,
    applyDraft,
    resetFromImage,
    isDirty,
    buildSavePayload,
    applySavedResponse,
    markSaved,
  };
}
