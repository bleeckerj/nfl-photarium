/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GalleryHiddenInventory, { getHiddenVisibilityCount } from '@/components/gallery/GalleryHiddenInventory';
import GalleryUtilityRail from '@/components/gallery/GalleryUtilityRail';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const inventoryProps = {
  hiddenFolders: ['archive', 'ops'],
  hiddenTags: ['draft', 'private', 'scan', 'unused'],
  hiddenNamespaces: ['cf-temp'],
  onClearHiddenFolders: vi.fn(() => true),
  onClearHiddenTags: vi.fn(() => true),
  onClearHiddenNamespaces: vi.fn(() => true),
};

const utilityProps = {
  expanded: false,
  filtersCollapsed: false,
  showCli: true,
  hiddenFolders: ['archive'],
  hiddenTags: ['draft'],
  hiddenNamespaces: ['cf-temp'],
  onClearHiddenFolders: vi.fn(() => true),
  onClearHiddenTags: vi.fn(() => true),
  onClearHiddenNamespaces: vi.fn(() => true),
  videoResultsNotice: null,
  videoMeta: null,
  selectedCount: 0,
  onExpandChange: vi.fn(),
  onToggleFilters: vi.fn(),
  onToggleCli: vi.fn(),
  onLoadMoreVideos: vi.fn(),
  onSelectPage: vi.fn(),
  onOpenBulkEdit: vi.fn(),
  onClearSelection: vi.fn(),
  onScrollTop: vi.fn(),
  onScrollToUploader: vi.fn(),
};

describe('GalleryHiddenInventory', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    container?.remove();
    container = undefined;
  });

  it('counts hidden rules and truncates long category previews', () => {
    expect(getHiddenVisibilityCount(inventoryProps)).toBe(7);

    const markup = renderToStaticMarkup(
      React.createElement(GalleryHiddenInventory, { ...inventoryProps, variant: 'cli' })
    );

    expect(markup).toContain('HIDDEN · 2 folders · 4 tags · 1 namespace');
    expect(markup).toContain('draft, private, scan, …');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('opens, dismisses with Escape, dismisses outside, and clears a category', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(GalleryHiddenInventory, { ...inventoryProps, variant: 'cli' }));
    });

    const inspect = container.querySelector('button[aria-label^="7 hidden"]') as HTMLButtonElement;
    expect(inspect.getAttribute('aria-expanded')).toBe('false');

    await act(async () => inspect.click());
    expect(inspect.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Hidden from gallery');

    const clearTags = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Show all tags'
    );
    expect(clearTags).toBeDefined();
    await act(async () => clearTags?.click());
    expect(inventoryProps.onClearHiddenTags).toHaveBeenCalledTimes(1);

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(inspect.getAttribute('aria-expanded')).toBe('false');

    await act(async () => inspect.click());
    await act(async () => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(inspect.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the edge badge only for a populated collapsed utility rail', () => {
    const populatedMarkup = renderToStaticMarkup(React.createElement(GalleryUtilityRail, utilityProps));
    expect(populatedMarkup).toContain('gallery-hidden-inventory-utility-badge');
    expect(populatedMarkup).toContain('3 hidden rules. Inspect hidden visibility.');

    const emptyMarkup = renderToStaticMarkup(
      React.createElement(GalleryUtilityRail, {
        ...utilityProps,
        hiddenFolders: [],
        hiddenTags: [],
        hiddenNamespaces: [],
      })
    );
    expect(emptyMarkup).not.toContain('gallery-hidden-inventory-utility-badge');
  });

  it('keeps an empty visibility row in the expanded utility rail', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryUtilityRail, {
        ...utilityProps,
        expanded: true,
        hiddenFolders: [],
        hiddenTags: [],
        hiddenNamespaces: [],
      })
    );

    expect(markup).toContain('No hidden items');
    expect(markup).toContain('No hidden folders, tags, or namespaces.');
  });
});
