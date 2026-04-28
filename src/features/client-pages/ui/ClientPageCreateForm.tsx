'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClientPageProjectFields } from './ClientPageProjectFields';
import { clientPageApi, type ClientSiteSummary } from './api';
import { useToast } from '@/components/Toast';

export function ClientPageCreateForm() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientSiteId, setClientSiteId] = useState('');
  const [notes, setNotes] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sourceNamespaces, setSourceNamespaces] = useState<string[]>([]);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [clientSites, setClientSites] = useState<ClientSiteSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    clientPageApi
      .listClientSites()
      .then(setClientSites)
      .catch(() => {
        // Keep the create form usable even when the optional lookup fails.
      });

    fetch('/api/namespaces', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const nextNamespaces = Array.isArray(data?.namespaces)
          ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        setAvailableNamespaces(nextNamespaces);
      })
      .catch(() => {
        setAvailableNamespaces([]);
      });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      const result = await clientPageApi.createProject({
        title,
        clientName: clientName || undefined,
        clientSiteId: clientSiteId || undefined,
        notes: notes || undefined,
        expiresAt: expiresAt || null,
        sourceNamespaces,
      });
      toast.push('Client page draft created.');
      router.push(`/client-pages/${result.project.id}`);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to create client page.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-stone-200 bg-white p-6">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">New client page</p>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Create a local draft in Photarium, link it to a deployed client site, then assign images and publish it to that dedicated worker.
        </p>
      </div>

      <div className="mt-4">
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
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/client-pages')}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm font-mono text-stone-700 hover:bg-stone-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-mono text-white hover:bg-black disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </form>
  );
}
