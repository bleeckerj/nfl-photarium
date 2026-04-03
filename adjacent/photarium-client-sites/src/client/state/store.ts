import type { AppState, ClientAsset, ClientProject } from '@client/domain/types';

type Listener = (state: AppState) => void;

const initialState: AppState = {
  project: null,
  assets: [],
  activeTag: null,
  selectedAssetIds: new Set<string>(),
  lightboxAssetId: null,
  shortlistTrayExpanded: false,
  shortlistSubmitExpanded: false,
  submissionState: 'idle',
};

export class AppStore {
  private state: AppState = initialState;
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setProject(project: ClientProject): void {
    this.update({ project });
  }

  setAssets(assets: ClientAsset[]): void {
    this.update({ assets });
  }

  setActiveTag(activeTag: string | null): void {
    this.update({ activeTag });
  }

  setLightboxAssetId(lightboxAssetId: string | null): void {
    this.update({ lightboxAssetId });
  }

  setShortlistTrayExpanded(shortlistTrayExpanded: boolean): void {
    this.update({
      shortlistTrayExpanded,
      shortlistSubmitExpanded: shortlistTrayExpanded ? this.state.shortlistSubmitExpanded : false,
    });
  }

  toggleShortlistTray(): void {
    this.setShortlistTrayExpanded(!this.state.shortlistTrayExpanded);
  }

  setShortlistSubmitExpanded(shortlistSubmitExpanded: boolean): void {
    this.update({
      shortlistTrayExpanded: shortlistSubmitExpanded ? true : this.state.shortlistTrayExpanded,
      shortlistSubmitExpanded,
    });
  }

  setSubmissionState(submissionState: AppState['submissionState']): void {
    this.update({ submissionState });
  }

  toggleAssetSelection(assetId: string): void {
    const selectedAssetIds = new Set(this.state.selectedAssetIds);
    if (selectedAssetIds.has(assetId)) {
      selectedAssetIds.delete(assetId);
    } else {
      selectedAssetIds.add(assetId);
    }

    this.update({
      selectedAssetIds,
      shortlistSubmitExpanded: selectedAssetIds.size === 0 ? false : this.state.shortlistSubmitExpanded,
    });
  }

  getState(): AppState {
    return this.state;
  }

  private update(partial: Partial<AppState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };

    this.listeners.forEach((listener) => listener(this.state));
  }
}
