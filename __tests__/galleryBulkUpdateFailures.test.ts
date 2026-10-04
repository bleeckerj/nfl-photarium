/** @vitest-environment jsdom */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGalleryBulkActions } from '@/components/gallery/hooks/useGalleryBulkActions';
import { useGalleryBulkState } from '@/components/gallery/hooks/useGalleryBulkState';
import { useGallerySelection } from '@/components/gallery/hooks/useGallerySelection';
import type { CloudflareImage } from '@/components/gallery/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const initialImages: CloudflareImage[] = ['moved', 'failed'].map(id => ({
  id, filename: `${id}.jpg`, uploaded: '2026-10-04T20:00:00Z', variants: [], namespace: 'source',
}));
const toastPush = vi.fn();
const fetchImages = vi.fn().mockResolvedValue(undefined);
type Controls = ReturnType<typeof useGalleryBulkActions> & ReturnType<typeof useGallerySelection> & ReturnType<typeof useGalleryBulkState> & { images: CloudflareImage[] };
let controls: Controls;

function Harness({ namespace = 'source' }: { namespace?: string }) {
  const [images, setImages] = useState(initialImages);
  const bulk = useGalleryBulkState({});
  const selection = useGallerySelection({ images, duplicateGroups: [], duplicateIds: new Set(), bulkSelectionMode: bulk.bulkSelectionMode, setBulkSelectionMode: bulk.setBulkSelectionMode });
  const actions = useGalleryBulkActions({
    ...bulk, ...selection, images, setImages, toastPush, fetchImages, namespace,
    bulkApplyFolder: false, bulkApplyNamespace: true, bulkNamespaceInput: 'destination',
  });
  controls = { ...bulk, ...selection, ...actions, images };
  return null;
}

describe('gallery bulk move failures', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function mount(namespace = 'source') {
    await act(async () => root.render(React.createElement(Harness, { namespace })));
    await act(async () => {
      controls.setBulkSelectionMode(true);
      controls.setBulkEditOpen(true);
      controls.selectAllOnPage(initialImages);
    });
  }

  it('keeps failed images selected and retries only those images', async () => {
    let fail = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const rejected = fail && String(input).includes('/failed/');
      return new Response(JSON.stringify(rejected ? { error: 'Cloudflare is throttling image updates. Retry in 30 seconds.' } : { success: true }), { status: rejected ? 429 : 200 });
    });
    await mount();
    await act(async () => controls.applyBulkUpdates());

    expect(controls.images.map(image => image.id)).toEqual(['failed']);
    expect(controls.images[0].namespace).toBe('source');
    expect([...controls.selectedImageIds]).toEqual(['failed']);
    expect(controls.selectedImages.map(image => image.id)).toEqual(['failed']);
    expect(controls.bulkEditOpen).toBe(true);
    expect(controls.bulkSelectionMode).toBe(true);
    expect(toastPush).toHaveBeenCalledWith(expect.stringContaining('Updated 1, failed 1: failed.jpg: Cloudflare is throttling'));

    fail = false;
    await act(async () => controls.applyBulkUpdates());
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/images/moved/update', '/api/images/failed/update', '/api/images/failed/update',
    ]);
    expect(controls.images).toEqual([]);
    expect(controls.selectedCount).toBe(0);
    expect(controls.bulkEditOpen).toBe(false);
    expect(controls.bulkSelectionMode).toBe(false);
  });

  it('leaves gallery metadata and selection unchanged when every request rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection lost'));
    await mount('__all__');
    await act(async () => controls.applyBulkUpdates());
    expect(controls.images).toEqual(initialImages);
    expect([...controls.selectedImageIds]).toEqual(['moved', 'failed']);
    expect(controls.bulkEditOpen).toBe(true);
    expect(controls.bulkSelectionMode).toBe(true);
    expect(toastPush).toHaveBeenCalledWith('Bulk update failed (2/2): moved.jpg: Connection lost');
  });

  it('updates only confirmed successes when viewing all namespaces', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(
      String(input).includes('/failed/') ? '<html>Unavailable</html>' : '{"success":true}',
      { status: String(input).includes('/failed/') ? 502 : 200 },
    ));
    await mount('__all__');
    await act(async () => controls.applyBulkUpdates());
    expect(controls.images.map(image => image.namespace)).toEqual(['destination', 'source']);
    expect([...controls.selectedImageIds]).toEqual(['failed']);
    expect(toastPush).toHaveBeenCalledWith(expect.stringContaining('failed.jpg: Metadata update failed (HTTP 502)'));
  });
});
