import type { UrlReviewManifest } from '@client/url-review/types';

export type UrlReviewMode = 'all' | 'selected';

export interface UrlReviewViewState {
  manifest: UrlReviewManifest;
  selectedUrls: ReadonlySet<string>;
  brokenUrls: ReadonlySet<string>;
  filter: string;
  mode: UrlReviewMode;
  statusMessage: string;
  statusTone: 'info' | 'error' | 'success';
}

export interface UrlReviewViewHandlers {
  onLoadFile: (file: File) => void;
  onLoadPastedUrls: (value: string) => void;
  onFilterChange: (value: string) => void;
  onToggleMode: () => void;
  onToggleUrl: (url: string) => void;
  onSelectVisible: () => void;
  onClearVisible: () => void;
  onExport: () => void;
  onCopy: () => void;
  onImageError: (url: string) => void;
  onRetryImage: (url: string) => void;
}

interface VisibleUrl {
  url: string;
  index: number;
}

const createButton = (
  label: string,
  onClick: () => void,
  options: { className?: string; disabled?: boolean } = {}
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.className ?? 'button';
  button.textContent = label;
  button.disabled = options.disabled ?? false;
  button.addEventListener('click', onClick);
  return button;
};

const getHostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unresolved source';
  }
};

const getVisibleUrls = (state: UrlReviewViewState): VisibleUrl[] => {
  const query = state.filter.trim().toLowerCase();
  return state.manifest.imageUrls.flatMap((url, index) => {
    if (state.mode === 'selected' && !state.selectedUrls.has(url)) return [];
    if (query && !`${url} ${getHostname(url)}`.toLowerCase().includes(query)) return [];
    return [{ url, index }];
  });
};

const renderImageCard = (
  item: VisibleUrl,
  state: UrlReviewViewState,
  handlers: UrlReviewViewHandlers
): HTMLElement => {
  const selected = state.selectedUrls.has(item.url);
  const card = document.createElement('article');
  card.className = selected ? 'url-review-card url-review-card--selected' : 'url-review-card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'url-review-card__header';
  const number = document.createElement('span');
  number.className = 'url-review-card__number';
  number.textContent = `Image ${item.index + 1}`;
  const stateLabel = document.createElement('span');
  stateLabel.className = selected ? 'url-review-card__state url-review-card__state--selected' : 'url-review-card__state';
  stateLabel.textContent = selected ? 'Keep' : 'Review';
  cardHeader.append(number, stateLabel);

  const stage = document.createElement('div');
  stage.className = 'url-review-card__stage';
  if (state.brokenUrls.has(item.url)) {
    const unavailable = document.createElement('div');
    unavailable.className = 'url-review-card__unavailable';
    unavailable.textContent = 'Preview unavailable';
    stage.append(unavailable);
  } else {
    const image = document.createElement('img');
    image.className = 'url-review-card__image';
    image.src = item.url;
    image.alt = `Candidate image ${item.index + 1}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => handlers.onImageError(item.url), { once: true });
    stage.append(image);
  }

  const source = document.createElement('p');
  source.className = 'url-review-card__source';
  source.textContent = getHostname(item.url);

  const url = document.createElement('p');
  url.className = 'url-review-card__url';
  url.textContent = item.url;

  const actions = document.createElement('div');
  actions.className = 'url-review-card__actions';
  const toggle = createButton(
    selected ? 'Remove from ingest' : 'Keep for ingest',
    () => handlers.onToggleUrl(item.url),
    { className: selected ? 'button button--primary' : 'button' }
  );
  const open = document.createElement('a');
  open.className = 'button button--ghost';
  open.href = item.url;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.textContent = 'Open image';
  actions.append(toggle, open);

  if (state.brokenUrls.has(item.url)) {
    actions.append(createButton('Retry preview', () => handlers.onRetryImage(item.url)));
  }

  card.append(cardHeader, stage, source, url, actions);
  return card;
};

export const renderUrlReviewView = (
  root: HTMLElement,
  state: UrlReviewViewState,
  handlers: UrlReviewViewHandlers
): void => {
  const visibleUrls = getVisibleUrls(state);
  const selectedCount = state.selectedUrls.size;
  const totalCount = state.manifest.imageUrls.length;

  root.replaceChildren();
  const page = document.createElement('main');
  page.className = 'url-review-page';

  const header = document.createElement('header');
  header.className = 'url-review-header';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'url-review-eyebrow';
  eyebrow.textContent = 'Photarium intake review';
  const title = document.createElement('h1');
  title.textContent = 'Choose the images worth keeping.';
  const summary = document.createElement('p');
  summary.className = 'url-review-summary';
  summary.textContent = 'Review the source images one by one, keep the useful ones, then export a clean URL list for ingestion.';
  header.append(eyebrow, title, summary);

  const metrics = document.createElement('div');
  metrics.className = 'url-review-metrics';
  [['Loaded', String(totalCount)], ['Visible', String(visibleUrls.length)], ['Kept', String(selectedCount)]].forEach(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'url-review-metric';
    const metricLabel = document.createElement('span');
    metricLabel.className = 'url-review-metric__label';
    metricLabel.textContent = label;
    const metricValue = document.createElement('strong');
    metricValue.className = 'url-review-metric__value';
    metricValue.textContent = value;
    metric.append(metricLabel, metricValue);
    metrics.append(metric);
  });
  header.append(metrics);

  const importPanel = document.createElement('section');
  importPanel.className = 'url-review-panel url-review-panel--import';
  const importHeading = document.createElement('h2');
  importHeading.textContent = 'Load a URL list';
  const importCopy = document.createElement('p');
  importCopy.textContent = `Current set: ${state.manifest.query} · ${state.manifest.source}`;
  const importActions = document.createElement('div');
  importActions.className = 'url-review-actions';
  const fileLabel = document.createElement('label');
  fileLabel.className = 'button';
  fileLabel.textContent = 'Choose JSON file';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handlers.onLoadFile(file);
  });
  fileLabel.append(fileInput);
  importActions.append(fileLabel);
  importPanel.append(importHeading, importCopy, importActions);

  const pasteField = document.createElement('label');
  pasteField.className = 'field url-review-paste';
  const pasteLabel = document.createElement('span');
  pasteLabel.textContent = 'Or paste image URLs, one per line';
  const pasteInput = document.createElement('textarea');
  pasteInput.placeholder = 'https://example.com/image-01.jpg\nhttps://example.com/image-02.jpg';
  pasteInput.rows = 3;
  pasteField.append(pasteLabel, pasteInput);
  const pasteButton = createButton('Load pasted URLs', () => handlers.onLoadPastedUrls(pasteInput.value));
  importPanel.append(pasteField, pasteButton);

  const controls = document.createElement('section');
  controls.className = 'url-review-panel url-review-panel--controls';
  const searchField = document.createElement('label');
  searchField.className = 'field url-review-search';
  const searchLabel = document.createElement('span');
  searchLabel.textContent = 'Filter by URL or host';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.value = state.filter;
  searchInput.placeholder = 'stevenahlgren.com';
  searchInput.addEventListener('input', () => handlers.onFilterChange(searchInput.value));
  searchField.append(searchLabel, searchInput);

  const controlActions = document.createElement('div');
  controlActions.className = 'url-review-actions';
  controlActions.append(
    createButton('Keep visible', handlers.onSelectVisible, { disabled: visibleUrls.length === 0 }),
    createButton('Clear visible', handlers.onClearVisible, { disabled: visibleUrls.length === 0 }),
    createButton(state.mode === 'selected' ? 'Show all images' : 'Show kept only', handlers.onToggleMode),
    createButton('Copy kept URLs', handlers.onCopy, { disabled: selectedCount === 0 }),
    createButton('Export kept JSON', handlers.onExport, { className: 'button button--primary', disabled: selectedCount === 0 })
  );
  controls.append(searchField, controlActions);

  const status = document.createElement('p');
  status.className = `url-review-status url-review-status--${state.statusTone}`;
  status.textContent = state.statusMessage;

  const grid = document.createElement('section');
  grid.className = 'url-review-grid';
  if (visibleUrls.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'url-review-empty';
    empty.textContent = state.mode === 'selected' ? 'No kept images match this filter.' : 'No images match this filter.';
    grid.append(empty);
  } else {
    visibleUrls.forEach((item) => grid.append(renderImageCard(item, state, handlers)));
  }

  page.append(header, importPanel, controls, status, grid);
  root.append(page);
};
