import { FileClock } from 'lucide-react';

export function ProvenanceIndicator({ available, showLabel = true }: { available?: boolean; showLabel?: boolean }) {
  if (!available) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-white px-1.5 py-1 text-xs text-sky-800"
      title="Generation provenance receipt available"
      aria-label="Generation provenance receipt available"
      data-provenance-available="true"
    >
      <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
      {showLabel ? 'Provenance receipt' : null}
    </span>
  );
}
