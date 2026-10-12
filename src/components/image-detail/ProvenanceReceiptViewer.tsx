'use client';

import { useState } from 'react';
import { useProvenanceReceipt } from './useProvenanceReceipt';

export function ProvenanceReceiptViewer({ imageId, receiptId }: { imageId: string; receiptId: string }) {
  const [open, setOpen] = useState(false);
  const url = `/api/images/${encodeURIComponent(imageId)}/provenance?receiptId=${encodeURIComponent(receiptId)}`;
  const { json, error, loading } = useProvenanceReceipt(url, open);

  return (
    <div className="space-y-2 pt-1">
      <details onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded border border-gray-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sky-700">View provenance receipt</summary>
        {open && <div className="px-3 pb-3">
          {loading && <p role="status" className="text-gray-500">Loading receipt…</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {json && <pre aria-label="Provenance receipt JSON" tabIndex={0}
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-3 font-mono text-xs text-gray-800">{json}</pre>}
        </div>}
      </details>
      <a className="inline-block text-sky-700 underline" href={url}>Download provenance receipt</a>
    </div>
  );
}
