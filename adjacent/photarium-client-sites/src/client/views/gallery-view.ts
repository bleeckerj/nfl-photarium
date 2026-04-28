import { clientCopy } from '@client/content/copy';
import { getVisibleAssets, groupAssetsByCluster } from '@client/domain/selectors';
import type { AppState, ClientAsset } from '@client/domain/types';
import { renderGalleryCard } from '@client/rendering/gallery-card';

export const renderGalleryView = (
  root: HTMLElement,
  state: AppState,
  handlers: {
    onToggleSelect: (assetId: string) => void;
    onOpenLightbox: (assetId: string) => void;
    onStartInlinePlayback: (assetId: string) => void;
    onStopInlinePlayback: () => void;
  }
): () => void => {
  const assets = getVisibleAssets(state);
  const cleanups: Array<() => void> = [];

  root.replaceChildren();

  if (assets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'gallery-empty';
    emptyState.textContent = clientCopy.emptyGallery;
    root.append(emptyState);
    return () => undefined;
  }

  groupAssetsByCluster(assets).forEach((group) => {
    const section = document.createElement('section');
    section.className = 'cluster-section';

    const title = document.createElement('h2');
    title.className = 'cluster-section__title';
    title.textContent = group.title;

    const grid = document.createElement('div');
    grid.className = 'asset-grid';

    group.assets.forEach((asset) => {
      const rendered = renderGalleryCard({
          asset,
          isSelected: state.selectedAssetIds.has(asset.id),
          isInlinePlaying: state.inlinePlayingAssetId === asset.id,
          onToggleSelect: handlers.onToggleSelect,
          onOpenLightbox: handlers.onOpenLightbox,
          onStartInlinePlayback: handlers.onStartInlinePlayback,
          onStopInlinePlayback: handlers.onStopInlinePlayback,
        });
      cleanups.push(rendered.cleanup);
      grid.append(rendered.element);
    });

    section.append(title, grid);
    root.append(section);
  });

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
};
