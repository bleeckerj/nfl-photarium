'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import type { ClientPageProjectListItem } from '../types';
import { clientPageApi } from './api';
import { ClientPageStatusBadge } from './statusBadge';
import { formatDateOnly, formatDateTime } from './formatters';

interface ClientPagesIndexProps {
  initialProjects: ClientPageProjectListItem[];
}

export function ClientPagesIndex({ initialProjects }: ClientPagesIndexProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const toast = useToast();

  const withBusyProject = async (projectId: string, task: () => Promise<void>) => {
    try {
      setBusyProjectId(projectId);
      await task();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Client page action failed.');
    } finally {
      setBusyProjectId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Client pages</p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-900">Create and manage client-facing selects</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              Draft client pages inside Photarium, assign images from the existing catalog, and publish them into the shared public Cloudflare worker without building a new site each time.
            </p>
          </div>
          <Link
            href="/client-pages/new"
            className="rounded-md border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-mono text-white hover:bg-black"
          >
            New client page
          </Link>
        </div>
      </section>

      <section className="rounded-md border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-6 py-4">
          <p className="text-sm text-stone-600">{projects.length} saved client pages</p>
        </div>

        {projects.length === 0 ? (
          <div className="px-6 py-10 text-sm text-stone-500">
            No client pages yet. Create a draft to start assigning images.
          </div>
        ) : (
          <ul className="divide-y divide-stone-200">
            {projects.map((project) => (
              <li key={project.id} className="px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/client-pages/${project.id}`} className="text-lg font-semibold text-stone-900 hover:text-stone-700">
                        {project.title}
                      </Link>
                      <ClientPageStatusBadge status={project.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600">
                      <span>{project.selectedImageCount} selected</span>
                      <span>Client: {project.clientName || 'Not set'}</span>
                      <span>Updated: {formatDateTime(project.updatedAt)}</span>
                      <span>Expiry: {formatDateOnly(project.expiresAt) || 'Not set'}</span>
                    </div>
                    {project.shareUrl ? (
                      <p className="mt-2 break-all text-xs font-mono text-stone-500">{project.shareUrl}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/client-pages/${project.id}`}
                      className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      disabled={busyProjectId === project.id || project.selectedImageCount === 0}
                      onClick={() =>
                        withBusyProject(project.id, async () => {
                          const result = await clientPageApi.publishProject(project.id);
                          setProjects((current) =>
                            current.map((entry) =>
                              entry.id === project.id
                                ? {
                                    ...entry,
                                    ...result.project,
                                    selectedImageCount: result.project.selectedImageIds.length,
                                    shareUrl: result.shareUrl,
                                  }
                                : entry
                            )
                          );
                          toast.push('Client page published.');
                        })
                      }
                      className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      disabled={busyProjectId === project.id || !project.remoteProjectId}
                      onClick={() =>
                        withBusyProject(project.id, async () => {
                          const result = await clientPageApi.shadowProject(project.id);
                          setProjects((current) =>
                            current.map((entry) =>
                              entry.id === project.id
                                ? {
                                    ...entry,
                                    ...result.project,
                                    selectedImageCount: result.project.selectedImageIds.length,
                                    shareUrl: result.shareUrl ?? undefined,
                                  }
                                : entry
                            )
                          );
                          toast.push('Client page shadowed.');
                        })
                      }
                      className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                    >
                      Shadow
                    </button>
                    <button
                      type="button"
                      disabled={busyProjectId === project.id}
                      onClick={() =>
                        withBusyProject(project.id, async () => {
                          const result = await clientPageApi.archiveProject(project.id);
                          setProjects((current) =>
                            current.map((entry) =>
                              entry.id === project.id
                                ? {
                                    ...entry,
                                    ...result.project,
                                    selectedImageCount: result.project.selectedImageIds.length,
                                    shareUrl: result.shareUrl ?? undefined,
                                  }
                                : entry
                            )
                          );
                          toast.push('Client page archived.');
                        })
                      }
                      className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
