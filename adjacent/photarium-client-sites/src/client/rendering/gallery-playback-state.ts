import { getAssetPosterUrl, resolveVideoPlayback } from '@client/rendering/media';
import { attachResolvedVideoPlayback } from '@client/rendering/video-player';
import type { ClientAsset } from '@client/domain/types';

const galleryAssetSelector = '[data-gallery-asset-id]';
const galleryMediaSlotSelector = '[data-gallery-media-slot]';
const galleryPlayToggleSelector = '[data-gallery-play-toggle]';
const galleryPauseToggleSelector = '[data-gallery-pause-toggle]';

const mediaCleanupRegistry = new WeakMap<HTMLElement, () => void>();

const renderImageButton = (asset: ClientAsset, onOpenLightbox: (assetId: string) => void): HTMLElement => {
  const imageButton = document.createElement('button');
  imageButton.className = 'asset-card__image-button';
  imageButton.type = 'button';

  const mediaUrl = getAssetPosterUrl(asset, 'grid');
  if (mediaUrl) {
    const image = document.createElement('img');
    image.className = 'asset-card__image';
    image.src = mediaUrl;
    image.alt = asset.displayName;
    image.loading = 'lazy';
    imageButton.append(image);
  } else {
    const empty = document.createElement('div');
    empty.className = 'asset-card__image asset-card__image--empty';
    empty.textContent = asset.assetType === 'video' ? 'Video' : 'Image';
    imageButton.append(empty);
  }

  imageButton.addEventListener('click', () => onOpenLightbox(asset.id));
  return imageButton;
};

const bindPauseToggle = (
  video: HTMLVideoElement,
  pauseToggle: HTMLButtonElement
): (() => void) => {
  const handleToggleClick = () => {
    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };
  const handlePlay = () => {
    pauseToggle.textContent = 'Pause';
  };
  const handlePause = () => {
    pauseToggle.textContent = 'Play';
  };

  pauseToggle.textContent = 'Play';
  pauseToggle.hidden = false;
  pauseToggle.addEventListener('click', handleToggleClick);
  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);

  return () => {
    pauseToggle.removeEventListener('click', handleToggleClick);
    video.removeEventListener('play', handlePlay);
    video.removeEventListener('pause', handlePause);
    pauseToggle.hidden = true;
  };
};

const renderInlinePlaybackVideo = (
  asset: ClientAsset,
  pauseToggle: HTMLButtonElement | null
): { element: HTMLElement; cleanup: () => void } => {
  const playback = resolveVideoPlayback(asset);

  const video = document.createElement('video');
  video.className = 'asset-card__image asset-card__video';
  video.controls = true;
  if (playback.posterUrl) {
    video.poster = playback.posterUrl;
  }

  const cleanupPauseToggle = pauseToggle ? bindPauseToggle(video, pauseToggle) : () => undefined;

  let cleanup: () => void = () => undefined;
  let disposed = false;

  void attachResolvedVideoPlayback(video, playback, {
    autoplay: true,
    muted: true,
  }).then((dispose) => {
    if (disposed) {
      dispose();
      return;
    }
    cleanup = dispose;
  });

  return {
    element: video,
    cleanup: () => {
      disposed = true;
      cleanupPauseToggle();
      cleanup();
    },
  };
};

const renderGalleryCardMedia = (
  asset: ClientAsset,
  isInlinePlaying: boolean,
  pauseToggle: HTMLButtonElement | null,
  onOpenLightbox: (assetId: string) => void
): { element: HTMLElement; cleanup: () => void } => {
  const playback = resolveVideoPlayback(asset);
  if (asset.assetType === 'video' && isInlinePlaying && playback.hasPlayableSource) {
    return renderInlinePlaybackVideo(asset, pauseToggle);
  }

  if (pauseToggle) {
    pauseToggle.hidden = true;
  }

  return {
    element: renderImageButton(asset, onOpenLightbox),
    cleanup: () => undefined,
  };
};

export const applyGalleryCardPlaybackState = (
  mediaSlot: HTMLElement,
  options: {
    asset: ClientAsset;
    isInlinePlaying: boolean;
    pauseToggle: HTMLButtonElement | null;
    onOpenLightbox: (assetId: string) => void;
  }
): void => {
  mediaCleanupRegistry.get(mediaSlot)?.();

  const rendered = renderGalleryCardMedia(
    options.asset,
    options.isInlinePlaying,
    options.pauseToggle,
    options.onOpenLightbox
  );
  mediaSlot.replaceChildren(rendered.element);
  mediaCleanupRegistry.set(mediaSlot, rendered.cleanup);
  mediaSlot.setAttribute('data-inline-playing', String(options.isInlinePlaying));
};

export const cleanupGalleryCardPlaybackState = (mediaSlot: HTMLElement): void => {
  mediaCleanupRegistry.get(mediaSlot)?.();
  mediaCleanupRegistry.delete(mediaSlot);
  mediaSlot.removeAttribute('data-inline-playing');
};

export const syncGalleryPlaybackState = (
  root: HTMLElement,
  options: {
    assets: ClientAsset[];
    inlinePlayingAssetId: string | null;
    onOpenLightbox: (assetId: string) => void;
    onStopInlinePlayback: () => void;
  }
): void => {
  const assetsById = new Map(options.assets.map((asset) => [asset.id, asset]));

  root.querySelectorAll<HTMLElement>(galleryAssetSelector).forEach((card) => {
    const assetId = card.getAttribute('data-gallery-asset-id');
    if (!assetId) return;

    const asset = assetsById.get(assetId);
    if (!asset || asset.assetType !== 'video') return;

    const mediaSlot = card.querySelector<HTMLElement>(galleryMediaSlotSelector);
    const playToggle = card.querySelector<HTMLButtonElement>(galleryPlayToggleSelector);
    const pauseToggle = card.querySelector<HTMLButtonElement>(galleryPauseToggleSelector);
    if (!mediaSlot || !playToggle) return;

    const isInlinePlaying = options.inlinePlayingAssetId === assetId;
    playToggle.classList.toggle('asset-card__play-toggle--active', isInlinePlaying);
    playToggle.textContent = isInlinePlaying ? 'Stop' : 'Play';

    if (mediaSlot.getAttribute('data-inline-playing') === String(isInlinePlaying)) {
      return;
    }

    applyGalleryCardPlaybackState(mediaSlot, {
      asset,
      isInlinePlaying,
      pauseToggle,
      onOpenLightbox: options.onOpenLightbox,
    });
  });
};
