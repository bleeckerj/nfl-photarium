import { clientCopy } from '@client/content/copy';
import type { ClientAsset } from '@client/domain/types';
import {
  formatAssetAspectRatio,
  formatAssetFileSize,
  formatAssetRuntime,
} from '@client/rendering/asset-metadata';
import { resolveVideoPlayback } from '@client/rendering/media';
import {
  applyGalleryCardPlaybackState,
  cleanupGalleryCardPlaybackState,
} from '@client/rendering/gallery-playback-state';

interface GalleryCardOptions {
  asset: ClientAsset;
  isSelected: boolean;
  isInlinePlaying: boolean;
  onToggleSelect: (assetId: string) => void;
  onOpenLightbox: (assetId: string) => void;
  onStartInlinePlayback: (assetId: string) => void;
  onStopInlinePlayback: () => void;
}

export const renderGalleryCard = (options: GalleryCardOptions): {
  element: HTMLElement;
  cleanup: () => void;
} => {
  const {
    asset,
    isSelected,
    isInlinePlaying,
    onToggleSelect,
    onOpenLightbox,
    onStartInlinePlayback,
    onStopInlinePlayback,
  } = options;
  const card = document.createElement('article');
  card.className = isSelected ? 'asset-card asset-card--selected' : 'asset-card';
  card.setAttribute('data-gallery-asset-id', asset.id);
  const videoPlayback = resolveVideoPlayback(asset);

  const mediaFrame = document.createElement('div');
  mediaFrame.className = 'asset-card__media-frame';
  mediaFrame.setAttribute('data-gallery-media-frame', '');
  applyGalleryCardPlaybackState(mediaFrame, {
    asset,
    isInlinePlaying,
    onOpenLightbox,
    onStopInlinePlayback,
  });

  if (asset.assetType === 'video') {
    const badge = document.createElement('span');
    badge.className = 'asset-card__badge';
    badge.textContent = 'Video';
    mediaFrame.append(badge);

    const playToggle = document.createElement('button');
    playToggle.className = isInlinePlaying
      ? 'asset-card__play-toggle asset-card__play-toggle--active'
      : 'asset-card__play-toggle';
    playToggle.type = 'button';
    playToggle.setAttribute('data-gallery-play-toggle', '');
    playToggle.textContent = isInlinePlaying ? 'Stop' : 'Play';
    playToggle.disabled = !videoPlayback.hasPlayableSource;
    playToggle.addEventListener('click', () => {
      if (isInlinePlaying) {
        onStopInlinePlayback();
      } else {
        onStartInlinePlayback(asset.id);
      }
    });
    mediaFrame.append(playToggle);
  }

  const title = document.createElement('h3');
  title.className = 'asset-card__title';
  title.textContent = asset.displayName;
  title.addEventListener('click', () => onOpenLightbox(asset.id));

  const meta = document.createElement('div');
  meta.className = 'asset-card__meta';

  const tagList = document.createElement('div');
  tagList.className = 'asset-card__tag-list';
  const visibleTags = asset.visibleTags.length > 0 ? asset.visibleTags : ['untagged'];
  visibleTags.forEach((tag) => {
    const pill = document.createElement('span');
    pill.className = 'asset-card__tag-pill';
    pill.textContent = tag;
    tagList.append(pill);
  });

  const detailList = document.createElement('div');
  detailList.className = 'asset-card__detail-list';
  const details = [
    asset.assetType === 'video' ? formatAssetRuntime(asset) : null,
    formatAssetAspectRatio(asset),
    formatAssetFileSize(asset.fileSizeBytes),
  ].filter((value): value is string => Boolean(value));
  details.forEach((detail) => {
    const item = document.createElement('span');
    item.className = 'asset-card__detail';
    item.textContent = detail;
    detailList.append(item);
  });
  meta.append(tagList, detailList);

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
  card.append(mediaFrame, title, meta, footer);
  return {
    element: card,
    cleanup: () => cleanupGalleryCardPlaybackState(mediaFrame),
  };
};
