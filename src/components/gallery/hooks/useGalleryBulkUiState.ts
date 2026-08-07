import { useCallback, useEffect, useMemo, type Dispatch } from 'react';
import type { BulkAction, BulkState } from '../bulkReducer';
import type { CloudflareImage } from '../types';

type UseGalleryBulkUiStateOptions = {
  bulkAnimateOrderMode: BulkState['bulkAnimateOrderMode'];
  bulkAnimateTouched: boolean;
  dispatchBulk: Dispatch<BulkAction>;
  selectedImages: CloudflareImage[];
  selectedCount: number;
  setBulkAnimateFps: (value: string) => void;
  setBulkEditOpen: (value: boolean) => void;
  setBulkFolderInput: (value: string) => void;
  setBulkFolderMode: (value: BulkState['bulkFolderMode']) => void;
  toastPush: (message: string) => void;
  uniqueFolders: string[];
};

export function useGalleryBulkUiState({
  bulkAnimateOrderMode,
  bulkAnimateTouched,
  dispatchBulk,
  selectedImages,
  selectedCount,
  setBulkAnimateFps,
  setBulkEditOpen,
  setBulkFolderInput,
  setBulkFolderMode,
  toastPush,
  uniqueFolders,
}: UseGalleryBulkUiStateOptions) {
  useEffect(() => {
    if (bulkAnimateTouched) return;
    if (selectedCount === 0) {
      setBulkAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedCount / 2);
    setBulkAnimateFps(next.toString());
  }, [bulkAnimateTouched, selectedCount, setBulkAnimateFps]);

  const openBulkEditModal = useCallback(() => {
    if (!selectedCount) {
      toastPush('Select at least one asset');
      return;
    }
    dispatchBulk({ type: 'resetEdit' });
  }, [dispatchBulk, selectedCount, toastPush]);

  const closeBulkEditModal = useCallback(() => {
    setBulkEditOpen(false);
  }, [setBulkEditOpen]);

  const bulkFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map(folder => ({ value: folder as string, label: folder as string })),
      { value: '__create__', label: 'Create new folder...' },
    ],
    [uniqueFolders]
  );

  const handleBulkFolderSelect = useCallback(
    (value: string) => {
      if (value === '__create__') {
        setBulkFolderMode('new');
        setBulkFolderInput('');
      } else {
        setBulkFolderMode('existing');
        setBulkFolderInput(value);
      }
    },
    [setBulkFolderInput, setBulkFolderMode]
  );

  const selectedImagesForPayload = useMemo(
    () => selectedImages.map((image) => ({
      id: image.id,
      filename: image.filename || image.displayName || image.id,
      altText: image.altText,
      altTag: image.altTag,
    })),
    [selectedImages]
  );

  const selectedGalleryOrderIds = useMemo(
    () => selectedImagesForPayload.map((image) => image.id),
    [selectedImagesForPayload]
  );

  const selectedInsertionOrderIds = useMemo(
    () => selectedImages.map((image) => image.id),
    [selectedImages]
  );

  const selectedAnimationPreview = useMemo(
    () => (
      bulkAnimateOrderMode === 'reverse-gallery'
        ? [...selectedImagesForPayload].reverse()
        : selectedImagesForPayload
    ),
    [bulkAnimateOrderMode, selectedImagesForPayload]
  );

  const bulkAnimateSelectionOrderDiffers = useMemo(
    () =>
      selectedGalleryOrderIds.length > 1 &&
      selectedInsertionOrderIds.length === selectedGalleryOrderIds.length &&
      selectedInsertionOrderIds.some((id, index) => id !== selectedGalleryOrderIds[index]),
    [selectedGalleryOrderIds, selectedInsertionOrderIds]
  );

  const handleCopySelectionPayload = useCallback(
    async (payload: string, label: string = 'Selection JSON') => {
      try {
        await navigator.clipboard.writeText(payload);
        toastPush(`${label} copied`);
      } catch (error) {
        console.error(`Failed to copy ${label} payload`, error);
        toastPush(`Failed to copy ${label}`);
      }
    },
    [toastPush]
  );

  return {
    bulkAnimateSelectionOrderDiffers,
    bulkFolderOptions,
    closeBulkEditModal,
    handleBulkFolderSelect,
    handleCopySelectionPayload,
    openBulkEditModal,
    selectedAnimationPreview,
    selectedImagesForPayload,
  };
}
