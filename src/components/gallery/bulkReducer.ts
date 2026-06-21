export type BulkState = {
  bulkSelectionMode: boolean;
  bulkEditOpen: boolean;
  bulkFolderInput: string;
  bulkFolderMode: 'existing' | 'new';
  bulkTagsInput: string;
  bulkTagsAiCount: string;
  bulkApplyFolder: boolean;
  bulkApplyTags: boolean;
  bulkTagsMode: 'replace' | 'append' | 'ai';
  bulkApplyDisplayName: boolean;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  bulkDisplayNameInput: string;
  bulkApplyDescription: boolean;
  bulkDescriptionAppendInput: string;
  bulkApplyNamespace: boolean;
  bulkNamespaceInput: string;
  bulkUpdating: boolean;
  bulkDeleting: boolean;
  bulkEmbeddingGenerating: boolean;
  bulkAnimateFps: string;
  bulkAnimateTouched: boolean;
  bulkAnimateLoop: boolean;
  bulkAnimateOrderMode: 'gallery' | 'reverse-gallery';
  bulkAnimateNamespaceInput: string;
  bulkAnimateFilename: string;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
};

export type BulkAction =
  | { type: 'set'; field: keyof BulkState; value: BulkState[keyof BulkState] }
  | { type: 'resetEdit' };

export const bulkReducer = (state: BulkState, action: BulkAction): BulkState => {
  switch (action.type) {
    case 'set':
      return {
        ...state,
        [action.field]: action.value,
      };
    case 'resetEdit':
      return {
        ...state,
        bulkEditOpen: true,
        bulkFolderInput: '',
        bulkFolderMode: 'existing',
        bulkTagsInput: '',
        bulkTagsAiCount: '6',
        bulkApplyFolder: false,
        bulkApplyTags: true,
        bulkTagsMode: 'append',
        bulkApplyDisplayName: false,
        bulkDisplayNameMode: 'custom',
        bulkDisplayNameInput: '',
        bulkApplyDescription: false,
        bulkDescriptionAppendInput: '',
        bulkApplyNamespace: false,
        bulkNamespaceInput: '',
        bulkAnimateFps: '',
        bulkAnimateTouched: false,
        bulkAnimateLoop: true,
        bulkAnimateOrderMode: 'gallery',
        bulkAnimateNamespaceInput: '',
        bulkAnimateFilename: '',
        bulkAnimateError: null,
      };
    default:
      return state;
  }
};
