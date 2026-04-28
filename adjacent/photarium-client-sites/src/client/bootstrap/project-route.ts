import { ClientSiteApi } from '@client/api/client';
import { clientCopy } from '@client/content/copy';
import {
  getGalleryStructureSignature,
  getLightboxAssetContext,
  getVisibleAssets,
} from '@client/domain/selectors';
import { AppStore } from '@client/state/store';
import { bindLightboxKeyboardNavigation } from '@client/interactions/lightbox-keyboard';
import { syncGalleryPlaybackState } from '@client/rendering/gallery-playback-state';
import { syncGallerySelectionState } from '@client/rendering/gallery-selection-state';
import { renderGalleryView } from '@client/views/gallery-view';
import { renderLightboxView } from '@client/views/lightbox-view';
import { renderShortlistView } from '@client/views/shortlist-view';
import { renderTagFilterView } from '@client/views/tag-filter-view';
import type { ShellElements } from './shell-elements';
import { getBootstrapErrorMessage } from './errors';
import { rememberLastProjectUrl } from '@client/dev/last-project';

interface ProjectRouteOptions {
  projectSlug: string;
  sharedAccessKey: string | null;
  pageUrl: URL;
}

const renderFatalError = (shell: ShellElements, message: string) => {
  shell.projectTitle.textContent = clientCopy.projectUnavailableTitle;
  shell.projectSummary.textContent = message;
  shell.toolbarCopy.textContent = '';
  shell.galleryRoot.replaceChildren();
  shell.tagFilterBar.replaceChildren();
  shell.lightboxRoot.replaceChildren();
  shell.shortlistDrawer.replaceChildren();
  shell.shortlistDrawer.hidden = true;

  const emptyState = document.createElement('div');
  emptyState.className = 'gallery-empty';
  emptyState.textContent = message;
  shell.galleryRoot.append(emptyState);
};

export const startProjectRoute = async (
  shell: ShellElements,
  options: ProjectRouteOptions
): Promise<void> => {
  shell.shortlistDrawer.hidden = false;

  const api = new ClientSiteApi(options.projectSlug);
  const store = new AppStore();
  let lastGalleryStructureSignature: string | null = null;
  let cleanupGalleryMedia: () => void = () => undefined;
  let cleanupLightboxMedia: () => void = () => undefined;

  const stepLightbox = (direction: 'previous' | 'next') => {
    const context = getLightboxAssetContext(store.getState());
    if (!context) return;

    const targetAssetId =
      direction === 'previous' ? context.previousAssetId : context.nextAssetId;

    if (targetAssetId) {
      store.setLightboxAssetId(targetAssetId);
    }
  };

  bindLightboxKeyboardNavigation({
    getState: () => store.getState(),
    onClose: () => store.setLightboxAssetId(null),
    onPrevious: () => stepLightbox('previous'),
    onNext: () => stepLightbox('next'),
  });

  const render = () => {
    const state = store.getState();
    if (state.project) {
      shell.projectTitle.textContent = state.project.title;
      shell.projectSummary.textContent = clientCopy.reviewSummary;
    }

    shell.toolbarCopy.textContent = clientCopy.toolbarHelper;

    const visibleAssets = getVisibleAssets(state);
    const galleryStructureSignature = getGalleryStructureSignature(state);

    shell.visibleCount.textContent = String(visibleAssets.length);
    shell.selectedCount.textContent = String(state.selectedAssetIds.size);

    renderTagFilterView(shell.tagFilterBar, state, (tag) => store.setActiveTag(tag));
    if (galleryStructureSignature !== lastGalleryStructureSignature) {
      cleanupGalleryMedia();
      cleanupGalleryMedia = renderGalleryView(shell.galleryRoot, state, {
        onToggleSelect: (assetId) => store.toggleAssetSelection(assetId),
        onOpenLightbox: (assetId) => {
          store.setInlinePlayingAssetId(null);
          store.setLightboxAssetId(assetId);
        },
        onStartInlinePlayback: (assetId) => {
          store.setLightboxAssetId(null);
          store.setInlinePlayingAssetId(assetId);
        },
        onStopInlinePlayback: () => store.setInlinePlayingAssetId(null),
      });
      lastGalleryStructureSignature = galleryStructureSignature;
    } else {
      syncGallerySelectionState(shell.galleryRoot, state.selectedAssetIds);
      syncGalleryPlaybackState(shell.galleryRoot, {
        assets: visibleAssets,
        inlinePlayingAssetId: state.inlinePlayingAssetId,
        onOpenLightbox: (assetId) => {
          store.setInlinePlayingAssetId(null);
          store.setLightboxAssetId(assetId);
        },
        onStopInlinePlayback: () => store.setInlinePlayingAssetId(null),
      });
    }
    cleanupLightboxMedia();
    cleanupLightboxMedia = renderLightboxView(shell.lightboxRoot, state, {
      onClose: () => store.setLightboxAssetId(null),
      onToggleSelect: (assetId) => store.toggleAssetSelection(assetId),
      onShowPrevious: () => stepLightbox('previous'),
      onShowNext: () => stepLightbox('next'),
    });
    renderShortlistView(shell.shortlistDrawer, state, {
      onToggleSelect: (assetId) => store.toggleAssetSelection(assetId),
      onToggleTray: () => store.toggleShortlistTray(),
      onToggleSubmit: () => {
        const nextExpanded = !store.getState().shortlistSubmitExpanded;
        if (nextExpanded && store.getState().submissionState !== 'idle') {
          store.setSubmissionState('idle');
        }
        store.setShortlistSubmitExpanded(nextExpanded);
      },
      onSubmit: async (input) => {
        try {
          store.setSubmissionState('submitting');
          await api.submitShortlist({
            ...input,
            selectedAssetIds: Array.from(store.getState().selectedAssetIds),
          });
          store.setSubmissionState('submitted');
          store.setShortlistSubmitExpanded(false);
          store.setShortlistTrayExpanded(true);
        } catch {
          store.setSubmissionState('error');
          store.setShortlistTrayExpanded(true);
          store.setShortlistSubmitExpanded(true);
        }
      },
    });
  };

  store.subscribe(render);

  try {
    if (options.sharedAccessKey) {
      await api.ensureSession(options.sharedAccessKey);
      options.pageUrl.searchParams.delete('k');
      window.history.replaceState(
        {},
        '',
        `${options.pageUrl.pathname}${options.pageUrl.search}${options.pageUrl.hash}`
      );
    }

    const [project, assets] = await Promise.all([api.fetchProject(), api.fetchAssets()]);
    store.setProject(project);
    store.setAssets(assets);
    rememberLastProjectUrl(`${window.location.origin}${options.pageUrl.pathname}`);
  } catch (error) {
    renderFatalError(shell, getBootstrapErrorMessage(error));
  }
};
