import defaultManifest from '../../../../steven-ahlgren-image-urls.json';
import './styles/url-review.css';
import {
  buildSelectionManifest,
  getUrlReviewStorageKey,
  parseUrlReviewManifest,
  type UrlReviewManifest,
} from '@client/url-review/types';
import { renderUrlReviewView, type UrlReviewMode, type UrlReviewViewState } from '@client/url-review/url-review-view';

const readStoredSelection = (manifest: UrlReviewManifest): Set<string> => {
  try {
    const stored = JSON.parse(localStorage.getItem(getUrlReviewStorageKey(manifest)) ?? '[]') as unknown;
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((url): url is string => manifest.imageUrls.includes(url)));
  } catch {
    return new Set();
  }
};

const saveStoredSelection = (manifest: UrlReviewManifest, selectedUrls: ReadonlySet<string>): void => {
  try {
    localStorage.setItem(getUrlReviewStorageKey(manifest), JSON.stringify([...selectedUrls]));
  } catch {
    // Selection remains usable when storage is unavailable.
  }
};

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'selected-images';

const downloadJson = (manifest: UrlReviewManifest): void => {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${slugify(manifest.query)}-selected.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const copyUrls = async (urls: string[]): Promise<void> => {
  await navigator.clipboard.writeText(urls.join('\n'));
};

const root = document.getElementById('url-review-root');
if (!root) throw new Error('URL review page is missing its root element.');

let manifest = parseUrlReviewManifest(defaultManifest);
let selectedUrls = readStoredSelection(manifest);
let brokenUrls = new Set<string>();
let filter = '';
let mode: UrlReviewMode = 'all';
let statusMessage = 'Nothing is selected yet. Mark an image to include it in the export.';
let statusTone: UrlReviewViewState['statusTone'] = 'info';

const setStatus = (message: string, tone: UrlReviewViewState['statusTone'] = 'info'): void => {
  statusMessage = message;
  statusTone = tone;
};

const render = (): void => {
  renderUrlReviewView(root, {
    manifest,
    selectedUrls,
    brokenUrls,
    filter,
    mode,
    statusMessage,
    statusTone,
  }, {
    onLoadFile: async (file) => {
      try {
        const nextManifest = parseUrlReviewManifest(JSON.parse(await file.text()) as unknown);
        manifest = nextManifest;
        selectedUrls = readStoredSelection(manifest);
        brokenUrls = new Set();
        filter = '';
        mode = 'all';
        setStatus(`Loaded ${manifest.imageUrls.length} image URLs from ${file.name}.` , 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'The JSON file could not be loaded.', 'error');
      }
      render();
    },
    onLoadPastedUrls: (value) => {
      try {
        const nextManifest = parseUrlReviewManifest({
          query: 'Pasted image URLs',
          source: 'Pasted into the URL review page',
          imageUrls: value.split(/\r?\n/),
        });
        manifest = nextManifest;
        selectedUrls = readStoredSelection(manifest);
        brokenUrls = new Set();
        filter = '';
        mode = 'all';
        setStatus(`Loaded ${manifest.imageUrls.length} pasted image URLs.`, 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'The pasted URLs could not be loaded.', 'error');
      }
      render();
    },
    onFilterChange: (value) => {
      filter = value;
      render();
    },
    onToggleMode: () => {
      mode = mode === 'all' ? 'selected' : 'all';
      render();
    },
    onToggleUrl: (url) => {
      const nextSelection = new Set(selectedUrls);
      if (nextSelection.has(url)) nextSelection.delete(url);
      else nextSelection.add(url);
      selectedUrls = nextSelection;
      saveStoredSelection(manifest, selectedUrls);
      setStatus(`${selectedUrls.size} image${selectedUrls.size === 1 ? '' : 's'} kept for export.`, 'success');
      render();
    },
    onSelectVisible: () => {
      const query = filter.trim().toLowerCase();
      const nextSelection = new Set(selectedUrls);
      manifest.imageUrls.forEach((url) => {
        const matches = !query || `${url} ${new URL(url).hostname}`.toLowerCase().includes(query);
        if (mode === 'all' && matches) nextSelection.add(url);
        if (mode === 'selected' && matches) nextSelection.add(url);
      });
      selectedUrls = nextSelection;
      saveStoredSelection(manifest, selectedUrls);
      setStatus(`${selectedUrls.size} image${selectedUrls.size === 1 ? '' : 's'} kept for export.`, 'success');
      render();
    },
    onClearVisible: () => {
      const query = filter.trim().toLowerCase();
      const nextSelection = new Set(selectedUrls);
      manifest.imageUrls.forEach((url) => {
        const matches = !query || `${url} ${new URL(url).hostname}`.toLowerCase().includes(query);
        if (matches) nextSelection.delete(url);
      });
      selectedUrls = nextSelection;
      saveStoredSelection(manifest, selectedUrls);
      setStatus(`${selectedUrls.size} image${selectedUrls.size === 1 ? '' : 's'} kept for export.`, 'success');
      render();
    },
    onExport: () => {
      downloadJson(buildSelectionManifest(manifest, selectedUrls));
      setStatus(`Exported ${selectedUrls.size} selected image URL${selectedUrls.size === 1 ? '' : 's'}.`, 'success');
      render();
    },
    onCopy: async () => {
      try {
        await copyUrls([...selectedUrls]);
        setStatus(`Copied ${selectedUrls.size} selected image URL${selectedUrls.size === 1 ? '' : 's'}.`, 'success');
      } catch {
        setStatus('The browser did not allow clipboard access. Use Export kept JSON instead.', 'error');
      }
      render();
    },
    onImageError: (url) => {
      brokenUrls = new Set(brokenUrls).add(url);
      setStatus('Some source servers did not allow an inline preview. The original URL remains available.', 'error');
      render();
    },
    onRetryImage: (url) => {
      const nextBroken = new Set(brokenUrls);
      nextBroken.delete(url);
      brokenUrls = nextBroken;
      render();
    },
  });
};

render();
