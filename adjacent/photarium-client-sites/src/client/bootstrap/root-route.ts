import { LocalDevApi } from '@client/api/dev-client';
import { RootClientApi } from '@client/api/root-client';
import type { ShellElements } from '@client/bootstrap/shell-elements';
import { startLocalDevLanding } from '@client/bootstrap/dev-landing';
import { renderRootEmptyView, renderRootIndexView } from '@client/views/root-index-view';

export const startRootRoute = async (shell: ShellElements): Promise<void> => {
  const api = new RootClientApi();
  const state = await api.fetchState();

  if (state.mode === 'redirect') {
    window.location.replace(state.sharePath);
    return;
  }

  if (state.mode === 'local-dev') {
    await startLocalDevLanding(shell);
    return;
  }

  if (state.mode === 'index') {
    renderRootIndexView(shell, {
      siteName: state.siteName,
      projects: state.projects,
    });
    return;
  }

  renderRootEmptyView(shell, state.siteName);
};
