'use client';

import { useEffect, useState } from 'react';
import { ClientPageProjectFields } from './ClientPageProjectFields';
import { joinNamespaces } from './formatters';
import type { ClientPageProjectRecord } from '../types';

interface ClientPageMetadataFormProps {
  project: ClientPageProjectRecord;
  busy: boolean;
  onSave: (payload: {
    title: string;
    clientName?: string;
    notes?: string;
    expiresAt?: string | null;
    sourceNamespaces?: string[];
  }) => Promise<void>;
}

const splitNamespaces = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function ClientPageMetadataForm({ project, busy, onSave }: ClientPageMetadataFormProps) {
  const [title, setTitle] = useState(project.title);
  const [clientName, setClientName] = useState(project.clientName ?? '');
  const [notes, setNotes] = useState(project.notes ?? '');
  const [expiresAt, setExpiresAt] = useState(project.expiresAt ? project.expiresAt.slice(0, 10) : '');
  const [sourceNamespaces, setSourceNamespaces] = useState(joinNamespaces(project.sourceNamespaces));

  useEffect(() => {
    setTitle(project.title);
    setClientName(project.clientName ?? '');
    setNotes(project.notes ?? '');
    setExpiresAt(project.expiresAt ? project.expiresAt.slice(0, 10) : '');
    setSourceNamespaces(joinNamespaces(project.sourceNamespaces));
  }, [project]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      title,
      clientName: clientName || undefined,
      notes: notes || undefined,
      expiresAt: expiresAt || null,
      sourceNamespaces: splitNamespaces(sourceNamespaces),
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
          notes={notes}
          expiresAt={expiresAt}
          sourceNamespaces={sourceNamespaces}
          onTitleChange={setTitle}
          onClientNameChange={setClientName}
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
