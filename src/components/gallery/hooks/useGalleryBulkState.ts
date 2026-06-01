import { useCallback, useReducer } from 'react';

import { bulkReducer, type BulkState } from '@/components/gallery/bulkReducer';

interface UseGalleryBulkStateOptions {
  bulkFolderInput?: string;
  bulkFolderMode?: 'existing' | 'new';
}

export const useGalleryBulkState = ({
  bulkFolderInput = '',
  bulkFolderMode = 'existing',
}: UseGalleryBulkStateOptions) => {
  const [bulkState, dispatchBulk] = useReducer(
    bulkReducer,
    {
      bulkSelectionMode: false,
      bulkEditOpen: false,
      bulkFolderInput,
      bulkFolderMode,
      bulkTagsInput: '',
      bulkTagsAiCount: '6',
      bulkApplyFolder: true,
      bulkApplyTags: false,
      bulkTagsMode: 'replace',
      bulkApplyDisplayName: false,
      bulkDisplayNameMode: 'custom',
      bulkDisplayNameInput: '',
      bulkApplyDescription: false,
      bulkDescriptionAppendInput: '',
      bulkApplyNamespace: false,
      bulkNamespaceInput: '',
      bulkUpdating: false,
      bulkDeleting: false,
      bulkEmbeddingGenerating: false,
      bulkAnimateFps: '',
      bulkAnimateTouched: false,
      bulkAnimateLoop: true,
      bulkAnimateOrderMode: 'gallery',
      bulkAnimateFilename: '',
      bulkAnimateLoading: false,
      bulkAnimateError: null,
    }
  );

  const setBulkField = useCallback(<K extends keyof BulkState>(field: K, value: BulkState[K]) => {
    dispatchBulk({ type: 'set', field, value });
  }, []);

  return {
    ...bulkState,
    dispatchBulk,
    setBulkSelectionMode: useCallback((value: boolean) => setBulkField('bulkSelectionMode', value), [setBulkField]),
    setBulkEditOpen: useCallback((value: boolean) => setBulkField('bulkEditOpen', value), [setBulkField]),
    setBulkFolderInput: useCallback((value: string) => setBulkField('bulkFolderInput', value), [setBulkField]),
    setBulkFolderMode: useCallback((value: 'existing' | 'new') => setBulkField('bulkFolderMode', value), [setBulkField]),
    setBulkTagsInput: useCallback((value: string) => setBulkField('bulkTagsInput', value), [setBulkField]),
    setBulkTagsAiCount: useCallback((value: string) => setBulkField('bulkTagsAiCount', value), [setBulkField]),
    setBulkApplyFolder: useCallback((value: boolean) => setBulkField('bulkApplyFolder', value), [setBulkField]),
    setBulkApplyTags: useCallback((value: boolean) => setBulkField('bulkApplyTags', value), [setBulkField]),
    setBulkTagsMode: useCallback((value: 'replace' | 'append' | 'ai') => setBulkField('bulkTagsMode', value), [setBulkField]),
    setBulkApplyDisplayName: useCallback((value: boolean) => setBulkField('bulkApplyDisplayName', value), [setBulkField]),
    setBulkDisplayNameMode: useCallback((value: 'custom' | 'auto' | 'clear' | 'ai') => setBulkField('bulkDisplayNameMode', value), [setBulkField]),
    setBulkDisplayNameInput: useCallback((value: string) => setBulkField('bulkDisplayNameInput', value), [setBulkField]),
    setBulkApplyDescription: useCallback((value: boolean) => setBulkField('bulkApplyDescription', value), [setBulkField]),
    setBulkDescriptionAppendInput: useCallback((value: string) => setBulkField('bulkDescriptionAppendInput', value), [setBulkField]),
    setBulkApplyNamespace: useCallback((value: boolean) => setBulkField('bulkApplyNamespace', value), [setBulkField]),
    setBulkNamespaceInput: useCallback((value: string) => setBulkField('bulkNamespaceInput', value), [setBulkField]),
    setBulkUpdating: useCallback((value: boolean) => setBulkField('bulkUpdating', value), [setBulkField]),
    setBulkDeleting: useCallback((value: boolean) => setBulkField('bulkDeleting', value), [setBulkField]),
    setBulkEmbeddingGenerating: useCallback((value: boolean) => setBulkField('bulkEmbeddingGenerating', value), [setBulkField]),
    setBulkAnimateFps: useCallback((value: string) => setBulkField('bulkAnimateFps', value), [setBulkField]),
    setBulkAnimateTouched: useCallback((value: boolean) => setBulkField('bulkAnimateTouched', value), [setBulkField]),
    setBulkAnimateLoop: useCallback((value: boolean) => setBulkField('bulkAnimateLoop', value), [setBulkField]),
    setBulkAnimateOrderMode: useCallback((value: 'gallery' | 'reverse-gallery') => setBulkField('bulkAnimateOrderMode', value), [setBulkField]),
    setBulkAnimateFilename: useCallback((value: string) => setBulkField('bulkAnimateFilename', value), [setBulkField]),
    setBulkAnimateLoading: useCallback((value: boolean) => setBulkField('bulkAnimateLoading', value), [setBulkField]),
    setBulkAnimateError: useCallback((value: string | null) => setBulkField('bulkAnimateError', value), [setBulkField]),
  };
};
