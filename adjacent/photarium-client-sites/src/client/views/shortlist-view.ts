import { clientCopy, getShortlistCountCopy, getSubmissionStatusCopy } from '@client/content/copy';
import { getSelectedAssets, getShortlistPreviewAssets } from '@client/domain/selectors';
import type { AppState } from '@client/domain/types';
import { renderShortlistItem } from '@client/rendering/shortlist-item';

export const renderShortlistView = (
  root: HTMLElement,
  state: AppState,
  handlers: {
    onToggleSelect: (assetId: string) => void;
    onToggleTray: () => void;
    onToggleSubmit: () => void;
    onSubmit: (input: { clientName?: string; clientEmail?: string; note?: string }) => Promise<void>;
  }
): void => {
  root.replaceChildren();

  const selectedAssets = getSelectedAssets(state);
  const previewAssets = getShortlistPreviewAssets(state);
  const tray = document.createElement('section');
  tray.className = state.shortlistTrayExpanded
    ? 'shortlist-tray shortlist-tray--expanded'
    : 'shortlist-tray shortlist-tray--collapsed';

  const summary = document.createElement('div');
  summary.className = 'shortlist-tray__summary';

  const heading = document.createElement('h2');
  heading.className = 'shortlist-tray__title';
  heading.textContent = clientCopy.shortlistTitle;

  const count = document.createElement('p');
  count.className = 'shortlist-tray__count';
  count.textContent = getShortlistCountCopy(selectedAssets.length);

  const preview = document.createElement('div');
  preview.className = 'shortlist-tray__preview';

  previewAssets.forEach((asset) => {
    const image = document.createElement('img');
    image.className = 'shortlist-tray__preview-image';
    image.src = `/a/${asset.id}/grid`;
    image.alt = asset.displayName;
    preview.append(image);
  });

  const reviewButton = document.createElement('button');
  reviewButton.className = 'button button--primary shortlist-tray__toggle';
  reviewButton.type = 'button';
  reviewButton.textContent = state.shortlistTrayExpanded ? clientCopy.hideShortlist : clientCopy.reviewShortlist;
  reviewButton.disabled = !state.shortlistTrayExpanded && selectedAssets.length === 0;
  reviewButton.addEventListener('click', handlers.onToggleTray);

  summary.append(heading, count);
  if (previewAssets.length > 0) summary.append(preview);
  tray.append(summary, reviewButton);

  if (!state.shortlistTrayExpanded) {
    root.append(tray);
    return;
  }

  const details = document.createElement('div');
  details.className = 'shortlist-tray__details';

  const intro = document.createElement('p');
  intro.className = 'shortlist-tray__copy';
  intro.textContent = clientCopy.shortlistSummary;
  details.append(intro);

  if (selectedAssets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'shortlist-tray__empty';
    empty.textContent = clientCopy.shortlistEmpty;
    details.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'shortlist-list';
    selectedAssets.forEach((asset) => {
      list.append(
        renderShortlistItem({
          asset,
          onRemove: handlers.onToggleSelect,
        })
      );
    });
    details.append(list);
  }

  if (selectedAssets.length > 0) {
    const submitToggle = document.createElement('button');
    submitToggle.className = state.shortlistSubmitExpanded ? 'button button--ghost' : 'button button--primary';
    submitToggle.type = 'button';
    submitToggle.textContent = state.shortlistSubmitExpanded ? clientCopy.hideForm : clientCopy.sendSelection;
    submitToggle.addEventListener('click', handlers.onToggleSubmit);
    details.append(submitToggle);
  }

  if (state.shortlistSubmitExpanded && selectedAssets.length > 0) {
    const formTitle = document.createElement('h3');
    formTitle.className = 'shortlist-tray__form-title';
    formTitle.textContent = clientCopy.selectionDetailsTitle;

    const form = document.createElement('form');
    form.className = 'shortlist-form';
    form.innerHTML = `
      <label class="field">
        <span>Name</span>
        <input name="clientName" type="text" autocomplete="name" />
      </label>
      <label class="field">
        <span>Email</span>
        <input name="clientEmail" type="email" autocomplete="email" />
      </label>
      <label class="field">
        <span>Note</span>
        <textarea name="note" rows="4"></textarea>
      </label>
      <button class="button button--primary" type="submit">${clientCopy.sendSelection}</button>
    `;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      await handlers.onSubmit({
        clientName: String(formData.get('clientName') || '').trim() || undefined,
        clientEmail: String(formData.get('clientEmail') || '').trim() || undefined,
        note: String(formData.get('note') || '').trim() || undefined,
      });
    });

    details.append(formTitle, form);
  }

  const status = document.createElement('p');
  status.className = 'shortlist-status';
  status.textContent = getSubmissionStatusCopy(state.submissionState);
  details.append(status);

  tray.append(details);
  root.append(tray);
};
