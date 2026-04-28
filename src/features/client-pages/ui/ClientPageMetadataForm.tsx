'use client';

import { useEffect, useState } from 'react';
import { ClientPageProjectFields } from './ClientPageProjectFields';
import type { ClientPageProjectRecord } from '../types';
import type { ClientSiteSummary } from './api';

interface ClientPageMetadataFormProps {
  project: ClientPageProjectRecord;
  clientSites: ClientSiteSummary[];
  busy: boolean;
  onSave: (payload: {
    title: string;
    clientName?: string;
    clientSiteId?: string;
    notes?: string;
    expiresAt?: string | null;
    sourceNamespaces?: string[];
  }) => Promise<void>;
}

export function ClientPageMetadataForm({ project, clientSites, busy, onSave }: ClientPageMetadataFormProps) {
  const [title, setTitle] = useState(project.title);
  const [clientName, setClientName] = useState(project.clientName ?? '');
  const [clientSiteId, setClientSiteId] = useState(project.clientSiteId ?? '');
  const [notes, setNotes] = useState(project.notes ?? '');
  const [expiresAt, setExpiresAt] = useState(project.expiresAt ? project.expiresAt.slice(0, 10) : '');
  const [sourceNamespaces, setSourceNamespaces] = useState(project.sourceNamespaces);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);

  useEffect(() => {
    setTitle(project.title);
    setClientName(project.clientName ?? '');
    setClientSiteId(project.clientSiteId ?? '');
    setNotes(project.notes ?? '');
    setExpiresAt(project.expiresAt ? project.expiresAt.slice(0, 10) : '');
    setSourceNamespaces(project.sourceNamespaces);
  }, [project]);

  useEffect(() => {
    let active = true;
    fetch('/api/namespaces', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const nextNamespaces = Array.isArray(data?.namespaces)
          ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        setAvailableNamespaces(nextNamespaces);
      })
      .catch(() => {
        if (!active) return;
        setAvailableNamespaces([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      title,
      clientName: clientName || undefined,
      clientSiteId: clientSiteId || undefined,
      notes: notes || undefined,
      expiresAt: expiresAt || null,
      sourceNamespaces,
    });
  };

  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Project details</p>
        <p className="mt-1 text-sm text-stone-600">Edit the local draft record that drives publish and revision state.</p>
      </div>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <ClientPageProjectFields
          title={title}
          clientName={clientName}
          clientSiteId={clientSiteId}
          notes={notes}
          expiresAt={expiresAt}
          sourceNamespaces={sourceNamespaces}
          availableNamespaces={availableNamespaces}
          clientSites={clientSites}
          onTitleChange={setTitle}
          onClientNameChange={setClientName}
          onClientSiteIdChange={setClientSiteId}
          onNotesChange={setNotes}
          onExpiresAtChange={setExpiresAt}
          onSourceNamespacesChange={setSourceNamespaces}
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </form>
    </section>
  );
}
