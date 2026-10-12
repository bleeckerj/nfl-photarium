'use client';

import { ProvenanceIndicator } from '@/components/asset-detail/ProvenanceIndicator';
import { useProvenanceReceipts } from './useProvenanceReceipts';

export function ProvenanceSection({ imageId, available }: { imageId: string; available?: boolean }) {
  const { receipts, loading, error } = useProvenanceReceipts(imageId, available);
  return (
    <section id="provenance" className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
      <h3 className="mb-2 font-semibold text-gray-900">Generation provenance</h3>
      <ProvenanceIndicator available={available} />
      {!available && <p className="text-gray-500">No provenance receipt retained.</p>}
      {loading && <p className="mt-2 text-gray-500">Loading receipts…</p>}
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      {receipts.map((receipt) => (
        <div key={receipt.receiptId} className="mt-3 space-y-1 border-t border-gray-100 pt-2">
          <p className="break-all font-mono">{receipt.model}</p>
          <p>{receipt.provider} · {new Date(receipt.createdAt).toLocaleString()}</p>
          <p>Requested: {receipt.requestedQuality ?? 'Unavailable'} · {receipt.requestedSize ?? 'Unavailable'}</p>
          <p>Returned: {receipt.returnedQuality ?? 'Unavailable'} · {receipt.returnedSize ?? 'Unavailable'}</p>
          <p>Image hash verified ({receipt.verification})</p>
          {receipt.requestId && <p className="break-all">Request: {receipt.requestId}</p>}
          {receipt.sourceImageIds.length > 0 && <p className="break-all">Sources: {receipt.sourceImageIds.join(', ')}</p>}
          <details><summary className="cursor-pointer">Hashes</summary>
            <p className="break-all font-mono">Generated: {receipt.generatedSha256}</p>
            <p className="break-all font-mono">Stored: {receipt.persistedSha256}</p>
          </details>
          <a
            className="inline-block text-sky-700 underline"
            href={`/api/images/${encodeURIComponent(imageId)}/provenance?receiptId=${receipt.receiptId}`}
          >Download provenance receipt</a>
        </div>
      ))}
    </section>
  );
}
