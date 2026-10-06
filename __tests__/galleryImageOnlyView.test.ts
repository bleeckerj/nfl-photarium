/** @vitest-environment jsdom */

import React, { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ImageProps } from 'next/image';
import type Link from 'next/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalleryImageOnlyView } from '@/components/gallery/GalleryImageOnlyView';
import { GalleryViewModeToggle } from '@/components/gallery/GalleryViewModeToggle';
import { getGridClassName } from '@/components/gallery/gridSizing';
import { getStoredPreferences } from '@/components/gallery/storedPreferences';
import { loadPreferences } from '@/components/gallery/storage';
import type { CloudflareImage, GalleryViewFilters, GridSize } from '@/components/gallery/types';

vi.mock('next/image', () => ({
  default: ({ fill, unoptimized, ...props }: ImageProps) => {
    void fill;
    void unoptimized;
    return React.createElement('img', { ...props, src: typeof props.src === 'string' ? props.src : '' });
  },
}));
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<typeof Link>) => {
    void prefetch;
    return React.createElement('a', { ...props, href: String(props.href) });
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const image: CloudflareImage = {
  id: 'image-1', filename: 'portrait.jpg', displayName: 'Portrait',
  uploaded: '2026-10-06T00:00:00Z', variants: [],
  dimensions: { width: 400, height: 800 }, altText: 'Portrait beside a window',
  tags: ['_favorite_', 'x-search', 'portrait'], namespace: 'studio',
  description: 'A description that should stay hidden', parentId: 'parent-1',
  comfyMetadataDetected: true, aiCharacteristicsDetected: true,
};

const filters = (overrides: Partial<GalleryViewFilters> = {}): GalleryViewFilters => ({
  images: [image], selectedVariant: 'w=600', respectAspectRatio: false,
  bulkSelectionMode: false, selectedImageIds: new Set(), duplicateIds: new Set([image.id]),
  childrenMap: {}, familySummaryMap: {}, colorMetadataMap: {}, embeddingPendingMap: {},
  altLoadingMap: {}, displayNameLoadingMap: {}, favoriteLoadingMap: {},
  galleryReturnHrefSuffix: '?gns=studio&gpage=2',
  ...overrides,
});

let root: Root;
let container: HTMLDivElement;
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH', 'testhash');
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor);
  vi.unstubAllEnvs();
});

const renderGallery = async (overrides: Partial<ComponentProps<typeof GalleryImageOnlyView>> = {}) => {
  await act(async () => root.render(React.createElement(GalleryImageOnlyView, {
    gridSize: 'medium', filters: filters(), onToggleSelection: vi.fn(), onBeforeNavigate: vi.fn(),
    ...overrides,
  })));
};

describe('image-only gallery', () => {
  it('renders complete images with accessible descriptions and no visible metadata or controls', async () => {
    await renderGallery();
    expect(container.textContent).toBe('');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')?.alt).toBe(image.altText);
    expect(container.querySelector('img')?.className).toBe('object-contain');
    expect(container.querySelectorAll('button,input,label,svg')).toHaveLength(0);
    expect(container.querySelector('a')?.href).toContain('/images/image-1?gns=studio&gpage=2');
    expect(container.querySelector('[data-gallery-asset-id]')?.id).toBe('gallery-asset-image-1');
  });

  it.each<GridSize>(['small', 'medium', 'large', 'xlarge'])('retains %s grid sizing with smaller gaps', async (gridSize) => {
    await renderGallery({ gridSize });
    const grid = container.querySelector('#gallery-results-images');
    expect(grid?.className).toBe(getGridClassName(gridSize).replace('gap-4', 'gap-1'));
  });

  it('uses the chosen delivery size and saves return state when opening a detail page', async () => {
    const onBeforeNavigate = vi.fn();
    await renderGallery({ filters: filters({ selectedVariant: 'w=900' }), onBeforeNavigate });
    expect(container.querySelector('img')?.src).toContain('/image-1/w=900');
    const link = container.querySelector('a');
    link?.addEventListener('click', (event) => event.preventDefault());
    await act(async () => link?.click());
    expect(onBeforeNavigate).toHaveBeenCalledWith(image.id);
  });

  it('selects tiles without navigation or checkbox chrome and keeps a visible selection outline', async () => {
    const onToggleSelection = vi.fn();
    const onBeforeNavigate = vi.fn();
    await renderGallery({
      filters: filters({ bulkSelectionMode: true, selectedImageIds: new Set([image.id]) }),
      onToggleSelection, onBeforeNavigate,
    });
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.className).toContain('outline-blue-500');
    expect(container.textContent).toBe('');
    expect(container.querySelectorAll('a,input,label')).toHaveLength(0);
    await act(async () => button?.click());
    expect(onToggleSelection).toHaveBeenCalledWith(image.id);
    expect(onBeforeNavigate).not.toHaveBeenCalled();
  });

  it('preserves focus markers and SVG raster previews without adding badges', async () => {
    await renderGallery({ filters: filters({
      images: [{ ...image, filename: 'logo.svg', linkedAssetId: 'raster-1' }],
      focusedGalleryAssetId: image.id,
    }) });
    expect(container.querySelector('img')?.src).toContain('/raster-1/w=600');
    expect(container.querySelector('a')?.getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('a')?.style.scrollMarginTop).toBe('6rem');
    expect(container.textContent).toBe('');
  });

  it('shows video thumbnails and routes to video details without a VIDEO label', async () => {
    await renderGallery({ filters: filters({ images: [{
      ...image, assetType: 'video', videoThumbnailUrl: 'https://example.com/poster.jpg',
    }] }) });
    expect(container.querySelector('img')?.src).toBe('https://example.com/poster.jpg');
    expect(container.querySelector('a')?.href).toContain('/videos/image-1');
    expect(container.textContent).toBe('');
  });
});

describe('gallery view selection', () => {
  it('offers all three views and selects images only directly', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(React.createElement(GalleryViewModeToggle, { value: 'images', onChange })));
    const buttons = container.querySelectorAll('button');
    expect(Array.from(buttons, (button) => button.getAttribute('aria-label'))).toEqual([
      'Grid view', 'Images only view', 'List view',
    ]);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    await act(async () => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith('images');
  });

  it.each(['grid', 'list', 'images'])('restores the %s view in both preference readers', (viewMode) => {
    window.localStorage.setItem('galleryPreferences', JSON.stringify({ viewMode, gridSize: 'small' }));
    expect(getStoredPreferences(undefined, null).viewMode).toBe(viewMode);
    expect(loadPreferences().viewMode).toBe(viewMode);
    expect(getStoredPreferences(undefined, null).gridSize).toBe('small');
  });

  it('falls back to grid for an invalid saved view', () => {
    window.localStorage.setItem('galleryPreferences', JSON.stringify({ viewMode: 'unknown' }));
    expect(getStoredPreferences(undefined, null).viewMode).toBe('grid');
    expect(loadPreferences().viewMode).toBe('grid');
  });
});
