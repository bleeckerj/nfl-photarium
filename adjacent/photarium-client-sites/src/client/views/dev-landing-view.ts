import { clientCopy } from '@client/content/copy';
import type { LocalDevStatusPayload } from '@client/api/dev-client';
import type { ShellElements } from '@client/bootstrap/shell-elements';

interface DevLandingState {
  status: 'loading' | 'ready' | 'creating' | 'error';
  devStatus: LocalDevStatusPayload | null;
  lastProjectUrl: string | null;
  errorMessage: string | null;
}

interface DevLandingHandlers {
  onCreateDemo: () => void;
  onResumeLastDemo: () => void;
}

const createDetailRow = (label: string, value: string): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'dev-panel__row';

  const labelElement = document.createElement('span');
  labelElement.className = 'dev-panel__label';
  labelElement.textContent = label;

  const valueElement = document.createElement('span');
  valueElement.className = 'dev-panel__value';
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  return row;
};

export const renderDevLandingView = (
  shell: ShellElements,
  state: DevLandingState,
  handlers: DevLandingHandlers
): void => {
  shell.projectTitle.textContent = clientCopy.localDevTitle;
  shell.projectSummary.textContent = clientCopy.localDevSummary;
  shell.toolbarCopy.textContent = clientCopy.localDevToolbar;
  shell.visibleCount.textContent = '—';
  shell.selectedCount.textContent = '—';
  shell.tagFilterBar.replaceChildren();
  shell.lightboxRoot.replaceChildren();
  shell.shortlistDrawer.replaceChildren();
  shell.shortlistDrawer.hidden = true;

  shell.galleryRoot.replaceChildren();

  const panel = document.createElement('section');
  panel.className = 'dev-panel';

  const intro = document.createElement('p');
  intro.className = 'dev-panel__intro';
  intro.textContent =
    state.status === 'error'
      ? clientCopy.localDevStatusUnavailable
      : clientCopy.localDevIntro;

  const details = document.createElement('div');
  details.className = 'dev-panel__details';
  details.append(
    createDetailRow(
      clientCopy.localDevWorkerStatusLabel,
      state.status === 'loading'
        ? clientCopy.localDevWorkerStatusLoading
        : state.status === 'error'
          ? clientCopy.localDevWorkerStatusError
          : clientCopy.localDevWorkerStatusReady
    ),
    createDetailRow(
      clientCopy.localDevOriginLabel,
      state.devStatus?.origin ?? clientCopy.localDevUnknownValue
    ),
    createDetailRow(
      clientCopy.localDevEnvironmentLabel,
      state.devStatus?.environmentLabel ?? clientCopy.localDevUnknownValue
    )
  );

  const actions = document.createElement('div');
  actions.className = 'dev-panel__actions';

  const createButton = document.createElement('button');
  createButton.className = 'button button--primary';
  createButton.type = 'button';
  createButton.disabled = state.status === 'creating';
  createButton.textContent =
    state.status === 'creating'
      ? clientCopy.localDevCreatingDemo
      : clientCopy.localDevCreateDemo;
  createButton.addEventListener('click', handlers.onCreateDemo);

  const resumeButton = document.createElement('button');
  resumeButton.className = 'button';
  resumeButton.type = 'button';
  resumeButton.disabled = !state.lastProjectUrl || state.status === 'creating';
  resumeButton.textContent = clientCopy.localDevResumeDemo;
  resumeButton.addEventListener('click', handlers.onResumeLastDemo);

  actions.append(createButton, resumeButton);

  const note = document.createElement('p');
  note.className = 'dev-panel__note';
  note.textContent = state.errorMessage
    ? state.errorMessage
    : state.lastProjectUrl
      ? clientCopy.localDevResumeAvailable
      : clientCopy.localDevNoLastProject;

  panel.append(intro, details, actions, note);
  shell.galleryRoot.append(panel);
};

