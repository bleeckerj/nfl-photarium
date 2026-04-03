import { clientCopy } from '@client/content/copy';
import { getAvailableTags } from '@client/domain/selectors';
import type { AppState } from '@client/domain/types';

export const renderTagFilterView = (
  root: HTMLElement,
  state: AppState,
  onTagChange: (tag: string | null) => void
): void => {
  root.replaceChildren();

  const tags = getAvailableTags(state);

  const allButton = document.createElement('button');
  allButton.className = state.activeTag ? 'tag-chip' : 'tag-chip tag-chip--active';
  allButton.type = 'button';
  allButton.textContent = clientCopy.allTagsLabel;
  allButton.addEventListener('click', () => onTagChange(null));
  root.append(allButton);

  tags.forEach((tag) => {
    const button = document.createElement('button');
    button.className = state.activeTag === tag ? 'tag-chip tag-chip--active' : 'tag-chip';
    button.type = 'button';
    button.textContent = tag;
    button.addEventListener('click', () => onTagChange(tag));
    root.append(button);
  });
};
