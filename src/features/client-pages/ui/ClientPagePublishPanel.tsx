'use client';

import { ClientPageStatusBadge } from './statusBadge';
import { formatDateTime } from './formatters';
import type { ClientPageProjectRecord } from '../types';
import type { ClientPageAssetIssue } from '../types';

interface ClientPagePublishPanelProps {
  project: ClientPageProjectRecord;
  shareUrl: string | null;
  publishBusy: boolean;
  lifecycleBusy: boolean;
  onPublish: () => void;
  onCopyLink: () => void;
  onShadow: () => void;
  onArchive: () => void;
  repairIssues: ClientPageAssetIssue[];
  repairBusy: boolean;
  onRepair: () => void;
}

export function ClientPagePublishPanel({
  project,
  shareUrl,
  publishBusy,
  lifecycleBusy,
  onPublish,
  onCopyLink,
  onShadow,
  onArchive,
  repairIssues,
  repairBusy,
  onRepair,
}: ClientPagePublishPanelProps) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Publish</p>
          <p className="mt-1 text-sm text-stone-600">Send this explicit asset set to the public Cloudflare client-pages worker.</p>
        </div>
        <ClientPageStatusBadge status={project.status} />
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">Selected assets</dt>
          <dd className="mt-1 text-stone-900">{project.selectedImageIds.length}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">Last published</dt>
          <dd className="mt-1 text-stone-900">{formatDateTime(project.lastPublishedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">Client URL</dt>
          <dd className="mt-1 break-all text-stone-900">{shareUrl ?? 'Not published yet'}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-2">
        {repairIssues.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-medium">{repairIssues.length} selected asset(s) cannot be published.</p>
            <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono">
              {repairIssues.map((issue) => (
                <li key={issue.id}>
                  {issue.assetType}: {issue.filename} — missing {issue.missing.join(', ')}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onRepair}
              disabled={repairBusy || publishBusy || lifecycleBusy}
              className="mt-3 w-full rounded-md border border-amber-700 px-3 py-2 font-mono text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {repairBusy ? 'Removing unusable assets…' : 'Remove unusable assets'}
            </button>
            <p className="mt-2 text-amber-800">This clears the client-page association only; source assets remain in Photarium.</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onPublish}
          disabled={publishBusy || project.selectedImageIds.length === 0}
          className="w-full rounded-md border border-stone-900 bg-stone-900 px-3 py-2 text-sm font-mono text-white hover:bg-black disabled:opacity-60"
        >
          {publishBusy ? 'Publishing…' : project.remoteProjectId ? 'Republish client page' : 'Publish client page'}
        </button>
        <button
          type="button"
          onClick={onCopyLink}
          disabled={!shareUrl}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          Copy client link
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onShadow}
          disabled={lifecycleBusy || !project.remoteProjectId}
          className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          Shadow
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={lifecycleBusy}
          className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          Archive
        </button>
      </div>
    </section>
  );
}
