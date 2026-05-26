export const IMAGE_DETAIL_DRAFT_KEY_PREFIX = 'imageDetailDraftV2:';
export const LEGACY_IMAGE_DETAIL_DRAFT_KEY_PREFIX = 'imageDetailDraftV1:';
export const IMAGE_DETAIL_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export type ImageDetailDraft = {
  savedAt: number;
  hasUnsavedChanges: true;
  folderSelect: string;
  tagsInput: string;
  altTextInput: string;
  descriptionInput: string;
  originalUrlInput: string;
  sourceUrlInput: string;
  displayNameInput: string;
};

export function shouldRestoreImageDetailDraft(
  draft: Partial<ImageDetailDraft> | null | undefined,
  now = Date.now()
): draft is ImageDetailDraft {
  if (!draft || draft.hasUnsavedChanges !== true) {
    return false;
  }
  if (typeof draft.savedAt !== 'number' || draft.savedAt <= 0) {
    return false;
  }
  return now - draft.savedAt < IMAGE_DETAIL_DRAFT_TTL_MS;
}
