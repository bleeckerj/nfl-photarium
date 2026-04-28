import { getAssetPosterUrl, resolveVideoPlayback } from '@client/rendering/media';
import { attachResolvedVideoPlayback } from '@client/rendering/video-player';
import type { ClientAsset } from '@client/domain/types';

const galleryAssetSelector = '[data-gallery-asset-id]';
const galleryMediaFrameSelector = '[data-gallery-media-frame]';
const galleryPlayToggleSelector = '[data-gallery-play-toggle]';

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

const renderInlinePlaybackVideo = (
  asset: ClientAsset
): { element: HTMLElement; cleanup: () => void } => {
  const playback = resolveVideoPlayback(asset);

  const video = document.createElement('video');
  video.className = 'asset-card__image asset-card__video';
  video.controls = true;
  if (playback.posterUrl) {
    video.poster = playback.posterUrl;
  }

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
      cleanup();
    },
  };
};

const renderGalleryCardMedia = (
  asset: ClientAsset,
  isInlinePlaying: boolean,
  onOpenLightbox: (assetId: string) => void,
  onStopInlinePlayback: () => void
): { element: HTMLElement; cleanup: () => void } => {
  const playback = resolveVideoPlayback(asset);
  if (asset.assetType === 'video' && isInlinePlaying && playback.hasPlayableSource) {
    return renderInlinePlaybackVideo(asset);
  }

  return {
    element: renderImageButton(asset, onOpenLightbox),
    cleanup: () => undefined,
  };
};

export const applyGalleryCardPlaybackState = (
  mediaFrame: HTMLElement,
  options: {
    asset: ClientAsset;
    isInlinePlaying: boolean;
    onOpenLightbox: (assetId: string) => void;
    onStopInlinePlayback: () => void;
  }
): void => {
  mediaCleanupRegistry.get(mediaFrame)?.();

  const rendered = renderGalleryCardMedia(
    options.asset,
    options.isInlinePlaying,
    options.onOpenLightbox,
    options.onStopInlinePlayback
  );
  mediaFrame.replaceChildren(rendered.element);
  mediaCleanupRegistry.set(mediaFrame, rendered.cleanup);
  mediaFrame.setAttribute('data-inline-playing', String(options.isInlinePlaying));
};

export const cleanupGalleryCardPlaybackState = (mediaFrame: HTMLElement): void => {
  mediaCleanupRegistry.get(mediaFrame)?.();
  mediaCleanupRegistry.delete(mediaFrame);
  mediaFrame.removeAttribute('data-inline-playing');
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

    const mediaFrame = card.querySelector<HTMLElement>(galleryMediaFrameSelector);
    const playToggle = card.querySelector<HTMLButtonElement>(galleryPlayToggleSelector);
    if (!mediaFrame || !playToggle) return;

    const isInlinePlaying = options.inlinePlayingAssetId === assetId;
    playToggle.classList.toggle('asset-card__play-toggle--active', isInlinePlaying);
    playToggle.textContent = isInlinePlaying ? 'Stop' : 'Play';

    if (mediaFrame.getAttribute('data-inline-playing') === String(isInlinePlaying)) {
      return;
    }

    applyGalleryCardPlaybackState(mediaFrame, {
      asset,
      isInlinePlaying,
      onOpenLightbox: options.onOpenLightbox,
      onStopInlinePlayback: options.onStopInlinePlayback,
    });
  });
};
