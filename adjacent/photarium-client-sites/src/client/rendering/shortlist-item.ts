import type { ClientAsset } from '@client/domain/types';
import { clientCopy } from '@client/content/copy';
import { getAssetPosterUrl } from '@client/rendering/media';

interface ShortlistItemOptions {
  asset: ClientAsset;
  onRemove: (assetId: string) => void;
}

export const renderShortlistItem = (options: ShortlistItemOptions): HTMLElement => {
  const item = document.createElement('article');
  item.className = 'shortlist-item';
  const mediaUrl = getAssetPosterUrl(options.asset, 'grid') || '';

  item.innerHTML = `
    ${mediaUrl ? `<img class="shortlist-item__image" src="${mediaUrl}" alt="${options.asset.displayName}" />` : ''}
    <div class="shortlist-item__body">
      <strong>${options.asset.displayName}</strong>
      <span>${options.asset.assetType === 'video' ? 'Video · ' : ''}${options.asset.visibleTags.join(' · ') || 'Untagged'}</span>
    </div>
  `;

  const remove = document.createElement('button');
  remove.className = 'button button--ghost';
  remove.type = 'button';
  remove.textContent = clientCopy.remove;
  remove.addEventListener('click', () => options.onRemove(options.asset.id));

  item.append(remove);
  return item;
};
