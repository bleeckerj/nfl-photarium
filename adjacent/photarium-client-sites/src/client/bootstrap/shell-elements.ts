export interface ShellElements {
  projectTitle: HTMLElement;
  projectSummary: HTMLElement;
  toolbarCopy: HTMLElement;
  visibleCount: HTMLElement;
  selectedCount: HTMLElement;
  galleryRoot: HTMLElement;
  lightboxRoot: HTMLElement;
  shortlistDrawer: HTMLElement;
  tagFilterBar: HTMLElement;
}

export const requireShellElements = (): ShellElements => {
  const projectTitle = document.getElementById('project-title');
  const projectSummary = document.getElementById('project-summary');
  const toolbarCopy = document.getElementById('toolbar-copy');
  const visibleCount = document.getElementById('visible-count');
  const selectedCount = document.getElementById('selected-count');
  const galleryRoot = document.getElementById('gallery-root');
  const lightboxRoot = document.getElementById('lightbox-root');
  const shortlistDrawer = document.getElementById('shortlist-drawer');
  const tagFilterBar = document.getElementById('tag-filter-bar');

  if (
    !projectTitle ||
    !projectSummary ||
    !toolbarCopy ||
    !visibleCount ||
    !selectedCount ||
    !galleryRoot ||
    !lightboxRoot ||
    !shortlistDrawer ||
    !tagFilterBar
  ) {
    throw new Error('Client shell is missing required DOM anchors.');
  }

  return {
    projectTitle,
    projectSummary,
    toolbarCopy,
    visibleCount,
    selectedCount,
    galleryRoot,
    lightboxRoot,
    shortlistDrawer,
    tagFilterBar,
  };
};

