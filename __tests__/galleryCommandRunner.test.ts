import { describe, expect, it, vi } from 'vitest';
import { createGalleryCommandRunner } from '@/utils/galleryCommandRunner';

const createOptions = (overrides: Record<string, unknown> = {}) => ({
  hiddenFolders: [],
  hiddenTags: [],
  hiddenNamespaces: [],
  knownFolders: [],
  knownTags: [],
  knownNamespaces: ['cf-exports-for-mail'],
  onHideFolder: vi.fn(() => true),
  onUnhideFolder: vi.fn(() => true),
  onClearHidden: vi.fn(() => true),
  onHideTag: vi.fn(() => true),
  onUnhideTag: vi.fn(() => true),
  onClearHiddenTags: vi.fn(() => true),
  onHideNamespace: vi.fn(() => true),
  onUnhideNamespace: vi.fn(() => true),
  onClearHiddenNamespaces: vi.fn(() => true),
  onSelectFolder: vi.fn(),
  selectedTag: '',
  onSelectTag: vi.fn(),
  onClearTagFilter: vi.fn(),
  showParentsOnly: false,
  onSetParentsOnly: vi.fn(),
  currentPage: 1,
  totalPages: 1,
  onGoToPage: vi.fn(),
  embeddingFilter: 'none' as const,
  onSetEmbeddingFilter: vi.fn(),
  onShowLastUploaded: undefined,
  showComfyOnly: false,
  onSetComfyOnly: vi.fn(),
  setStatusLine: vi.fn(),
  toast: { push: vi.fn() },
  ...overrides,
});

describe('gallery command routing', () => {
  it('routes namespace commands to namespace visibility state', () => {
    const options = createOptions();
    const runCommand = createGalleryCommandRunner(options);

    runCommand('hide namespace cf-exports-for-mail');

    expect(options.onHideNamespace).toHaveBeenCalledWith('cf-exports-for-mail');
    expect(options.onHideFolder).not.toHaveBeenCalled();
  });

  it('rejects namespace-looking values in the generic folder command', () => {
    const options = createOptions();
    const runCommand = createGalleryCommandRunner(options);

    runCommand('hide folder namespace cf-exports-for-mail');

    expect(options.onHideFolder).not.toHaveBeenCalled();
    expect(options.onHideNamespace).not.toHaveBeenCalled();
    expect(options.setStatusLine).toHaveBeenCalledWith(
      'Use "hide namespace cf-exports-for-mail" for a namespace.'
    );
  });
});
