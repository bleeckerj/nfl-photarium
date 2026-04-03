import { LocalDevApi } from '@client/api/dev-client';
import type { ShellElements } from '@client/bootstrap/shell-elements';
import { rememberLastProjectUrl, readLastProjectUrl } from '@client/dev/last-project';
import { renderDevLandingView } from '@client/views/dev-landing-view';

interface DevLandingState {
  status: 'loading' | 'ready' | 'creating' | 'error';
  devStatus: Awaited<ReturnType<LocalDevApi['fetchStatus']>> | null;
  lastProjectUrl: string | null;
  errorMessage: string | null;
}

export const startLocalDevLanding = async (shell: ShellElements): Promise<void> => {
  const api = new LocalDevApi();
  const state: DevLandingState = {
    status: 'loading',
    devStatus: null,
    lastProjectUrl: readLastProjectUrl(),
    errorMessage: null,
  };

  const render = () =>
    renderDevLandingView(shell, state, {
      onCreateDemo: async () => {
        try {
          state.status = 'creating';
          state.errorMessage = null;
          render();

          const demo = await api.createDemo();
          rememberLastProjectUrl(demo.projectUrl.replace(/\?.*$/, ''));
          window.location.assign(demo.projectUrl);
        } catch {
          state.status = 'error';
          state.errorMessage = 'Unable to create a fresh local demo.';
          render();
        }
      },
      onResumeLastDemo: () => {
        if (!state.lastProjectUrl) return;
        window.location.assign(state.lastProjectUrl);
      },
    });

  render();

  try {
    state.devStatus = await api.fetchStatus();
    state.status = 'ready';
  } catch {
    state.status = 'error';
    state.errorMessage = 'Local dev status could not be loaded.';
  }

  render();
};

