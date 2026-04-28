import type { RootProjectLink } from '@client/api/root-client';
import type { ShellElements } from '@client/bootstrap/shell-elements';

export const renderRootIndexView = (
  shell: ShellElements,
  options: {
    siteName: string;
    projects: RootProjectLink[];
  }
): void => {
  shell.projectTitle.textContent = options.siteName;
  shell.projectSummary.textContent = 'Choose a gallery to review.';
  shell.toolbarCopy.textContent = '';
  shell.visibleCount.textContent = '—';
  shell.selectedCount.textContent = '—';
  shell.tagFilterBar.replaceChildren();
  shell.lightboxRoot.replaceChildren();
  shell.shortlistDrawer.replaceChildren();
  shell.shortlistDrawer.hidden = true;
  shell.galleryRoot.replaceChildren();

  const grid = document.createElement('section');
  grid.className = 'root-index';

  options.projects.forEach((project) => {
    const card = document.createElement('a');
    card.className = 'root-index__card';
    card.href = `/p/${encodeURIComponent(project.publicSlug)}`;
    card.innerHTML = `
      <span class="root-index__eyebrow">Client Gallery</span>
      <strong class="root-index__title">${project.title}</strong>
      <span class="root-index__meta">Open gallery</span>
    `;
    grid.append(card);
  });

  shell.galleryRoot.append(grid);
};

export const renderRootEmptyView = (
  shell: ShellElements,
  siteName: string
): void => {
  shell.projectTitle.textContent = siteName;
  shell.projectSummary.textContent = 'No client galleries are available at this URL.';
  shell.toolbarCopy.textContent = '';
  shell.visibleCount.textContent = '—';
  shell.selectedCount.textContent = '—';
  shell.tagFilterBar.replaceChildren();
  shell.lightboxRoot.replaceChildren();
  shell.shortlistDrawer.replaceChildren();
  shell.shortlistDrawer.hidden = true;
  shell.galleryRoot.replaceChildren();

  const emptyState = document.createElement('div');
  emptyState.className = 'gallery-empty';
  emptyState.textContent = 'No client galleries are available at this URL.';
  shell.galleryRoot.append(emptyState);
};
