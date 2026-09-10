/** @vitest-environment jsdom */

import React, { act, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCanonicalGalleryFocusFromSearch, resolveGalleryRequestFocus } from '@/components/gallery/focusNavigation';
import { useGalleryFocusNavigation } from '@/components/gallery/hooks/useGalleryFocusNavigation';
import { useGalleryRefreshLifecycle } from '@/components/gallery/hooks/useGalleryRefreshLifecycle';
import type { CloudflareImage, ImageGalleryRef } from '@/components/gallery/types';
import { queryGalleryAssets } from '@/server/galleryQuery';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const makeImage = (id: string, uploaded: string): CloudflareImage => ({
  id, filename: `${id}.jpg`, uploaded, variants: [], namespace: 'cf-nokia',
});

describe('gallery focus pagination', () => {
  let root: Root;
  let container: HTMLDivElement;
  let assets: CloudflareImage[];
  const requests: Array<{ page: number; focus?: string }> = [];
  const galleryRef = React.createRef<ImageGalleryRef>();
  const clearFilters = vi.fn();
  const clearColorSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requests.length = 0;
    assets = Array.from({ length: 430 }, (_, index) => makeImage(
      `image-${index}`, new Date(Date.UTC(2026, 7, 5) - index * 1000).toISOString(),
    ));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function Harness({ search, loading = false, refreshTrigger = 0 }: { search: string; loading?: boolean; refreshTrigger?: number }) {
    const target = useRef(parseCanonicalGalleryFocusFromSearch(search));
    const applied = useRef(false);
    const skip = useRef(false);
    const didInit = useRef(false);
    const returning = useRef(false);
    const [page, setPage] = useState(1);
    const pageRef = useRef(page);
    const [result, setResult] = useState(() => queryGalleryAssets(assets, {}, 1, 120, target.current?.assetId));
    const fetchImages = useCallback(async (options: { firstPage?: boolean } = {}) => {
      const requestedPage = options.firstPage ? 1 : pageRef.current;
      const focus = resolveGalleryRequestFocus({ target: target.current, namespace: 'cf-nokia', applied: applied.current, firstPage: options.firstPage });
      requests.push({ page: requestedPage, focus });
      setResult(queryGalleryAssets(assets, {}, requestedPage, 120, focus));
    }, []);
    useGalleryRefreshLifecycle({
      fetchImages, focusAppliedRef: applied, imageCount: result.images.length, loading,
      perfLoggingEnabled: false, ref: galleryRef, refreshTrigger, resetToFirstPage: setPage,
      returningFromDetailRef: returning, serverPagination: result,
    });
    useGalleryFocusNavigation({
      initialFocusTargetRef: target, namespace: 'cf-nokia', clearFilters, clearColorSearch,
      galleryImages: result.images, filteredImages: result.images, loading, pageIndex: page,
      serverFocus: result.focus, setCurrentPage: setPage, focusAppliedRef: applied, focusReconcileSkipRef: skip,
    });
    useEffect(() => {
      pageRef.current = page;
      if (!didInit.current) { didInit.current = true; return; }
      if (skip.current) { skip.current = false; return; }
      void fetchImages();
    }, [fetchImages, page]);
    return React.createElement('div', null,
      React.createElement('output', null, `Page ${page} / ${result.totalPages}`),
      React.createElement('button', { onClick: () => setPage(1) }, 'First'),
      React.createElement('button', { onClick: () => setPage(result.totalPages) }, 'Last'),
      React.createElement('ul', null, result.images.map((image) => React.createElement('li', { key: image.id, 'data-gallery-asset-id': image.id }, image.filename))),
    );
  }

  const ids = () => Array.from(container.querySelectorAll('[data-gallery-asset-id]'), (node) => node.getAttribute('data-gallery-asset-id'));
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };

  it.each(['?focus=image-0', '?gns=cf-nokia&focus=image-0'])('changes the rendered images from page one to page four after %s', async (search) => {
    await act(async () => root.render(React.createElement(Harness, { search })));
    expect(ids()[0]).toBe('image-0');
    await click('Last');
    expect(container.querySelector('output')?.textContent).toBe('Page 4 / 4');
    expect(ids()).toHaveLength(70);
    expect(ids()[0]).toBe('image-360');
    expect(requests.at(-1)).toEqual({ page: 4, focus: undefined });
    await click('First');
    expect(ids()[0]).toBe('image-0');
    expect(ids()).toHaveLength(120);
  });

  it('reconciles a legacy focus on page three and then allows ordinary navigation', async () => {
    await act(async () => root.render(React.createElement(Harness, { search: '?focus=image-240' })));
    expect(container.querySelector('output')?.textContent).toBe('Page 3 / 4');
    expect(ids()[0]).toBe('image-240');
    await click('First');
    expect(ids()[0]).toBe('image-0');
    expect(requests.at(-1)).toEqual({ page: 1, focus: undefined });
  });

  it('shows a newly uploaded image even when focus has not completed', async () => {
    await act(async () => root.render(React.createElement(Harness, { search: '?focus=image-240', loading: true })));
    assets = [makeImage('new-dng-upload', '2026-09-10T05:14:00Z'), ...assets];
    await act(async () => { galleryRef.current?.refreshImages(); });
    expect(ids()[0]).toBe('new-dng-upload');
    expect(requests.at(-1)).toEqual({ page: 1, focus: undefined });
    await act(async () => root.render(React.createElement(Harness, { search: '?focus=image-240', loading: false })));
    await click('Last');
    expect(ids()[0]).toBe('image-359');
    expect(requests.at(-1)?.focus).toBeUndefined();
  });

  it('releases pending focus through the refresh-trigger fallback as well', async () => {
    const props = { search: '?focus=image-240', loading: true };
    await act(async () => root.render(React.createElement(Harness, props)));
    assets = [makeImage('new-upload', '2026-09-10T05:14:00Z'), ...assets];
    await act(async () => root.render(React.createElement(Harness, { ...props, refreshTrigger: 1 })));
    expect(ids()[0]).toBe('new-upload');
    expect(requests.at(-1)?.focus).toBeUndefined();
  });

  it('keeps explicitly scoped focus requests out of other namespaces', () => {
    expect(resolveGalleryRequestFocus({ target: { assetId: 'image-240', namespace: 'cf-other' }, namespace: 'cf-nokia', applied: false })).toBeUndefined();
  });
});
