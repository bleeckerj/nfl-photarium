import { clientCopy, getLightboxPositionCopy } from '@client/content/copy';
import { getLightboxAssetContext } from '@client/domain/selectors';
import type { AppState } from '@client/domain/types';
import { renderLightboxDownloadGroups } from '@client/rendering/lightbox-download-group';
import { formatVideoDuration, getAssetPosterUrl, resolveVideoPlayback } from '@client/rendering/media';
import { attachResolvedVideoPlayback } from '@client/rendering/video-player';

export const renderLightboxView = (
  root: HTMLElement,
  state: AppState,
  handlers: {
    onClose: () => void;
    onToggleSelect: (assetId: string) => void;
    onShowPrevious: () => void;
    onShowNext: () => void;
  }
): () => void => {
  root.replaceChildren();
  if (!state.lightboxAssetId || !state.project) return () => undefined;

  const context = getLightboxAssetContext(state);
  if (!context) return () => undefined;

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
  let cleanup: () => void = () => undefined;
  let disposed = false;

  if (asset.assetType === 'video') {
    const playback = resolveVideoPlayback(asset);
    if (playback.hasPlayableSource) {
      const video = document.createElement('video');
      video.className = 'lightbox__image';
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      if (playback.posterUrl) {
        video.poster = playback.posterUrl;
      }
      void attachResolvedVideoPlayback(video, playback).then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        cleanup = dispose;
      });
      stage.append(video);
    } else {
      const unavailable = document.createElement('div');
      unavailable.className = 'lightbox__media-unavailable';
      unavailable.textContent = 'Video playback is unavailable for this asset.';
      stage.append(unavailable);
    }
  } else {
    const image = document.createElement('img');
    image.className = 'lightbox__image';
    image.src = `/a/${asset.id}/lightbox`;
    image.alt = asset.displayName;
    image.loading = 'eager';
    stage.append(image);
  }

  const rail = document.createElement('aside');
  rail.className = 'lightbox__rail';

  const title = document.createElement('h2');
  title.className = 'lightbox__title';
  title.textContent = asset.displayName;

  const tags = document.createElement('p');
  tags.className = 'lightbox__tags';
  tags.textContent = `${clientCopy.tagsLabel}: ${asset.visibleTags.join(' · ') || 'Untagged'}`;

  const duration = asset.assetType === 'video' ? formatVideoDuration(resolveVideoPlayback(asset).durationSeconds) : null;
  const durationMeta = document.createElement('p');
  durationMeta.className = 'lightbox__cluster';
  durationMeta.textContent = duration ? `Duration: ${duration}` : '';

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
  downloadsHeading.textContent = asset.assetType === 'video' ? clientCopy.playbackTitle : clientCopy.downloadTitle;

  rail.append(title, tags);
  if (durationMeta.textContent) rail.append(durationMeta);
  if (cluster.textContent) rail.append(cluster);
  rail.append(description, selectButton, downloadsHeading, renderLightboxDownloadGroups({
    asset,
    project: state.project,
  }));

  body.append(stage, rail);
  panel.append(topbar, body);
  overlay.append(panel);
  root.append(overlay);
  return () => {
    disposed = true;
    cleanup();
  };
};
