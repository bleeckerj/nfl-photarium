import { describe, expect, it } from 'vitest';

import {
  shouldRestoreImageDetailDraft,
  type ImageDetailDraft,
} from '@/components/image-detail/detailDraft';

describe('detailDraft', () => {
  const now = 1_700_000_000_000;

  it('restores only drafts explicitly marked as unsaved changes', () => {
    const legacyStyleDraft = {
      savedAt: now,
      descriptionInput: 'server snapshot',
    };

    expect(shouldRestoreImageDetailDraft(legacyStyleDraft, now)).toBe(false);
  });

  it('restores fresh unsaved drafts', () => {
    const draft: ImageDetailDraft = {
      savedAt: now,
      hasUnsavedChanges: true,
      folderSelect: '',
      tagsInput: '',
      altTextInput: '',
      descriptionInput: 'edited locally',
      originalUrlInput: '',
      sourceUrlInput: '',
      displayNameInput: '',
      clearExif: false,
    };

    expect(shouldRestoreImageDetailDraft(draft, now)).toBe(true);
  });

  it('does not restore expired drafts', () => {
    const draft: ImageDetailDraft = {
      savedAt: now - (6 * 60 * 60 * 1000) - 1,
      hasUnsavedChanges: true,
      folderSelect: '',
      tagsInput: '',
      altTextInput: '',
      descriptionInput: 'edited locally',
      originalUrlInput: '',
      sourceUrlInput: '',
      displayNameInput: '',
      clearExif: false,
    };

    expect(shouldRestoreImageDetailDraft(draft, now)).toBe(false);
  });
});
