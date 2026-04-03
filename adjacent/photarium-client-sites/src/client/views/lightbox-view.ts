import { clientCopy, getLightboxPositionCopy } from '@client/content/copy';
import { getLightboxAssetContext } from '@client/domain/selectors';
import type { AppState } from '@client/domain/types';
import { renderLightboxDownloadGroups } from '@client/rendering/lightbox-download-group';

export const renderLightboxView = (
  root: HTMLElement,
  state: AppState,
  handlers: {
    onClose: () => void;
    onToggleSelect: (assetId: string) => void;
    onShowPrevious: () => void;
    onShowNext: () => void;
  }
): void => {
  root.replaceChildren();
  if (!state.lightboxAssetId || !state.project) return;

  const context = getLightboxAssetContext(state);
  if (!context) return;

  const { asset } = context;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) handlers.onClose();
  });

  const panel = document.createElement('div');
  panel.className = 'lightbox__panel';

  const topbar = document.createElement('div');
  topbar.className = 'lightbox__topbar';

  const close = document.createElement('button');
  close.className = 'button button--ghost lightbox__close';
  close.type = 'button';
  close.textContent = clientCopy.lightboxBack;
  close.addEventListener('click', handlers.onClose);

  const position = document.createElement('p');
  position.className = 'lightbox__position';
  position.textContent = getLightboxPositionCopy(context.assetIndex, context.assetCount);

  const navigation = document.createElement('div');
  navigation.className = 'lightbox__navigation';

  const previous = document.createElement('button');
  previous.className = 'button button--ghost';
  previous.type = 'button';
  previous.textContent = clientCopy.previousImage;
  previous.disabled = !context.previousAssetId;
  previous.addEventListener('click', handlers.onShowPrevious);

  const next = document.createElement('button');
  next.className = 'button button--ghost';
  next.type = 'button';
  next.textContent = clientCopy.nextImage;
  next.disabled = !context.nextAssetId;
  next.addEventListener('click', handlers.onShowNext);

  navigation.append(previous, next);
  topbar.append(close, position, navigation);

  const body = document.createElement('div');
  body.className = 'lightbox__body';

  const stage = document.createElement('div');
  stage.className = 'lightbox__stage';

  const image = document.createElement('img');
  image.className = 'lightbox__image';
  image.src = `/a/${asset.id}/lightbox`;
  image.alt = asset.displayName;
  image.loading = 'eager';
  stage.append(image);

  const rail = document.createElement('aside');
  rail.className = 'lightbox__rail';

  const title = document.createElement('h2');
  title.className = 'lightbox__title';
  title.textContent = asset.displayName;

  const tags = document.createElement('p');
  tags.className = 'lightbox__tags';
  tags.textContent = `${clientCopy.tagsLabel}: ${asset.visibleTags.join(' · ') || 'Untagged'}`;

  const cluster = document.createElement('p');
  cluster.className = 'lightbox__cluster';
  cluster.textContent = asset.clusterLabel
    ? `${clientCopy.clusterLabel}: ${asset.clusterLabel}`
    : '';

  const description = document.createElement('p');
  description.className = 'lightbox__description';
  description.textContent = asset.description || clientCopy.noDescription;

  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'button button--primary lightbox__select';
  selectButton.textContent = state.selectedAssetIds.has(asset.id)
    ? clientCopy.removeFromShortlist
    : clientCopy.addToShortlist;
  selectButton.addEventListener('click', () => handlers.onToggleSelect(asset.id));

  const downloadsHeading = document.createElement('h3');
  downloadsHeading.className = 'lightbox__downloads-heading';
  downloadsHeading.textContent = clientCopy.downloadTitle;

  rail.append(title, tags);
  if (cluster.textContent) rail.append(cluster);
  rail.append(description, selectButton, downloadsHeading, renderLightboxDownloadGroups({
    assetId: asset.id,
    project: state.project,
  }));

  body.append(stage, rail);
  panel.append(topbar, body);
  overlay.append(panel);
  root.append(overlay);
};
