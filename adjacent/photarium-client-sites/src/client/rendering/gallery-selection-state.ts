import { clientCopy } from '@client/content/copy';

const galleryAssetSelector = '[data-gallery-asset-id]';
const galleryToggleSelector = '[data-gallery-select-toggle]';

export const syncGallerySelectionState = (
  root: HTMLElement,
  selectedAssetIds: ReadonlySet<string>
): void => {
  root.querySelectorAll<HTMLElement>(galleryAssetSelector).forEach((card) => {
    const assetId = card.getAttribute('data-gallery-asset-id');
    if (!assetId) return;

    const isSelected = selectedAssetIds.has(assetId);
    card.classList.toggle('asset-card--selected', isSelected);

    const toggle = card.querySelector<HTMLButtonElement>(galleryToggleSelector);
    if (!toggle) return;

    toggle.classList.toggle('asset-card__select--active', isSelected);
    toggle.setAttribute('aria-pressed', String(isSelected));
    toggle.textContent = isSelected
      ? clientCopy.addedCardSelection
      : clientCopy.addCardSelection;
  });
};
