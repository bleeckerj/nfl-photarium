'use client';

import { useMemo } from 'react';

interface ClientPageProjectFieldsProps {
  title: string;
  clientName: string;
  clientSiteId: string;
  notes: string;
  expiresAt: string;
  sourceNamespaces: string[];
  availableNamespaces: string[];
  clientSites: Array<{
    id: string;
    name: string;
    status: string;
    deployment: {
      publicBaseUrl: string;
    };
  }>;
  onTitleChange: (value: string) => void;
  onClientNameChange: (value: string) => void;
  onClientSiteIdChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onExpiresAtChange: (value: string) => void;
  onSourceNamespacesChange: (value: string[]) => void;
}

const fieldClassName =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none';

export function ClientPageProjectFields({
  title,
  clientName,
  clientSiteId,
  notes,
  expiresAt,
  sourceNamespaces,
  availableNamespaces,
  clientSites,
  onTitleChange,
  onClientNameChange,
  onClientSiteIdChange,
  onNotesChange,
  onExpiresAtChange,
  onSourceNamespacesChange,
}: ClientPageProjectFieldsProps) {
  const visibleNamespaces = useMemo(
    () => Array.from(new Set([...availableNamespaces, ...sourceNamespaces])).sort((left, right) => left.localeCompare(right)),
    [availableNamespaces, sourceNamespaces]
  );

  const toggleNamespace = (namespace: string, checked: boolean) => {
    if (checked) {
      onSourceNamespacesChange(
        Array.from(new Set([...sourceNamespaces, namespace])).sort((left, right) => left.localeCompare(right))
      );
      return;
    }

    onSourceNamespacesChange(sourceNamespaces.filter((entry) => entry !== namespace));
  };

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
          Client site
        </span>
        <select
          value={clientSiteId}
          onChange={(event) => onClientSiteIdChange(event.target.value)}
          className={fieldClassName}
        >
          <option value="">Unassigned</option>
          {clientSites.map((clientSite) => (
            <option key={clientSite.id} value={clientSite.id}>
              {clientSite.name} ({clientSite.status}) - {clientSite.deployment.publicBaseUrl}
            </option>
          ))}
        </select>
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
        <div className="rounded-md border border-stone-300 bg-white p-3">
          {visibleNamespaces.length === 0 ? (
            <p className="text-sm text-stone-500">No namespaces available yet.</p>
          ) : (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {visibleNamespaces.map((namespace) => {
                const checked = sourceNamespaces.includes(namespace);
                return (
                  <label key={namespace} className="flex items-center gap-3 text-sm text-stone-900">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleNamespace(namespace, event.target.checked)}
                      className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500"
                    />
                    <span className="font-mono">{namespace}</span>
                    {!availableNamespaces.includes(namespace) ? (
                      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-mono uppercase tracking-[0.14em] text-amber-900">
                        Saved
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">
            Client pages can only target registered namespaces from the gallery.
          </p>
        </div>
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
