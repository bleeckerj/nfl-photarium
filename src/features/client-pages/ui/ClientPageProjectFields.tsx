'use client';

interface ClientPageProjectFieldsProps {
  title: string;
  clientName: string;
  notes: string;
  expiresAt: string;
  sourceNamespaces: string;
  onTitleChange: (value: string) => void;
  onClientNameChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onExpiresAtChange: (value: string) => void;
  onSourceNamespacesChange: (value: string) => void;
}

const fieldClassName =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none';

export function ClientPageProjectFields({
  title,
  clientName,
  notes,
  expiresAt,
  sourceNamespaces,
  onTitleChange,
  onClientNameChange,
  onNotesChange,
  onExpiresAtChange,
  onSourceNamespacesChange,
}: ClientPageProjectFieldsProps) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Title
        </span>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          className={fieldClassName}
          placeholder="Spring campaign selects"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Client name
        </span>
        <input
          value={clientName}
          onChange={(event) => onClientNameChange(event.target.value)}
          className={fieldClassName}
          placeholder="Optional"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Expiry
        </span>
        <input
          type="date"
          value={expiresAt}
          onChange={(event) => onExpiresAtChange(event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Source namespaces
        </span>
        <input
          value={sourceNamespaces}
          onChange={(event) => onSourceNamespacesChange(event.target.value)}
          className={fieldClassName}
          placeholder="campaign-a, campaign-b"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Notes
        </span>
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          className={`${fieldClassName} min-h-28 resize-y`}
          placeholder="Internal notes for the operator."
        />
      </label>
    </div>
  );
}
