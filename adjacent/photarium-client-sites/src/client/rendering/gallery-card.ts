import { clientCopy } from '@client/content/copy';
import type { ClientAsset } from '@client/domain/types';

interface GalleryCardOptions {
  asset: ClientAsset;
  isSelected: boolean;
  onToggleSelect: (assetId: string) => void;
  onOpenLightbox: (assetId: string) => void;
}

export const renderGalleryCard = (options: GalleryCardOptions): HTMLElement => {
  const { asset, isSelected, onToggleSelect, onOpenLightbox } = options;
  const card = document.createElement('article');
  card.className = isSelected ? 'asset-card asset-card--selected' : 'asset-card';
  card.setAttribute('data-gallery-asset-id', asset.id);

  const imageButton = document.createElement('button');
  imageButton.className = 'asset-card__image-button';
  imageButton.type = 'button';
  imageButton.innerHTML = `
    <img class="asset-card__image" src="/a/${asset.id}/grid" alt="${asset.displayName}" loading="lazy" />
  `;
  imageButton.addEventListener('click', () => onOpenLightbox(asset.id));

  const title = document.createElement('h3');
  title.className = 'asset-card__title';
  title.textContent = asset.displayName;

  const tags = document.createElement('p');
  tags.className = 'asset-card__tags';
  tags.textContent = asset.visibleTags.join(' · ') || 'Untagged';

  const footer = document.createElement('div');
  footer.className = 'asset-card__footer';

  const toggle = document.createElement('button');
  toggle.className = isSelected ? 'asset-card__select asset-card__select--active' : 'asset-card__select';
  toggle.type = 'button';
  toggle.setAttribute('data-gallery-select-toggle', '');
  toggle.setAttribute('aria-pressed', String(isSelected));
  toggle.textContent = isSelected ? clientCopy.addedCardSelection : clientCopy.addCardSelection;
  toggle.addEventListener('click', () => onToggleSelect(asset.id));

  footer.append(toggle);
  card.append(imageButton, title, tags, footer);
  return card;
};
