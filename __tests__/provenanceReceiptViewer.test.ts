/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvenanceReceiptViewer } from '@/components/image-detail/ProvenanceReceiptViewer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });

describe('provenance receipt viewer', () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchReceipt = vi.fn();

  beforeEach(async () => {
    fetchReceipt.mockReset();
    vi.stubGlobal('fetch', fetchReceipt);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(React.createElement(ProvenanceReceiptViewer, { imageId: 'image-1', receiptId: 'receipt-1' })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function toggle(open: boolean) {
    const details = container.querySelector('details')!;
    await act(async () => {
      details.open = open;
      details.dispatchEvent(new Event('toggle'));
    });
  }

  it('fetches on opening and displays escaped formatted JSON alongside the download', async () => {
    expect(fetchReceipt).not.toHaveBeenCalled();
    const json = { schema_version: 1, request: { prompt: '<script>private receipt</script>' } };
    fetchReceipt.mockResolvedValue(new Response(JSON.stringify(json)));
    await toggle(true);
    expect(fetchReceipt).toHaveBeenCalledWith('/api/images/image-1/provenance?receiptId=receipt-1&view=inline', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(json, null, 2));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/api/images/image-1/provenance?receiptId=receipt-1');
  });

  it('shows a retrieval error and retries when reopened', async () => {
    fetchReceipt.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await toggle(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Close and reopen to retry');
    await toggle(false);
    fetchReceipt.mockResolvedValueOnce(new Response('{"schema_version":1}'));
    await toggle(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('schema_version');
  });

  it('aborts pending retrieval when closed', async () => {
    fetchReceipt.mockImplementation(() => new Promise<Response>(() => {}));
    await toggle(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading receipt…');
    const signal: AbortSignal = fetchReceipt.mock.calls[0][1].signal;
    await toggle(false);
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('pre')).toBeNull();
  });
});
