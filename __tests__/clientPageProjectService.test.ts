import { describe, expect, it } from 'vitest';
import { ClientPageProjectService } from '@/features/client-pages/projectService';
import type { ClientPageProjectRecord } from '@/features/client-pages/types';
import type { ClientPageProjectStore } from '@/features/client-pages/storage/fileStore';

class InMemoryClientPageProjectStore implements ClientPageProjectStore {
  constructor(private projects: ClientPageProjectRecord[] = []) {}

  async list(): Promise<ClientPageProjectRecord[]> {
    return [...this.projects];
  }

  async get(projectId: string): Promise<ClientPageProjectRecord | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async writeProjects(projects: ClientPageProjectRecord[]): Promise<void> {
    this.projects = [...projects];
  }
}

describe('ClientPageProjectService', () => {
  it('creates draft projects with default policies and explicit metadata', async () => {
    const service = new ClientPageProjectService(new InMemoryClientPageProjectStore());

    const project = await service.createProject({
      title: '  Client Review  ',
      clientName: ' ACME ',
      notes: ' internal notes ',
      sourceNamespaces: ['campaign-b', 'campaign-a', 'campaign-a'],
    });

    expect(project.title).toBe('Client Review');
    expect(project.clientName).toBe('ACME');
    expect(project.notes).toBe('internal notes');
    expect(project.status).toBe('draft');
    expect(project.selectedImageIds).toEqual([]);
    expect(project.sourceNamespaces).toEqual(['campaign-a', 'campaign-b']);
    expect(project.accessPolicy.mode).toBe('secret-link');
  });

  it('replaces selection with a deduped explicit membership list', async () => {
    const store = new InMemoryClientPageProjectStore();
    const service = new ClientPageProjectService(store);
    const created = await service.createProject({ title: 'Review set' });

    const updated = await service.replaceSelection(created.id, {
      selectedImageIds: ['img-1', 'img-2', 'img-1', 'img-3'],
    });

    expect(updated.selectedImageIds).toEqual(['img-1', 'img-2', 'img-3']);

    const persisted = await service.getProject(created.id);
    expect(persisted?.selectedImageIds).toEqual(['img-1', 'img-2', 'img-3']);
  });

  it('lists projects with derived share URLs and selected counts', async () => {
    const service = new ClientPageProjectService(
      new InMemoryClientPageProjectStore([
        {
          id: 'project-1',
          title: 'Published selects',
          status: 'published',
          expiresAt: null,
          selectedImageIds: ['img-1', 'img-2'],
          sourceNamespaces: [],
          accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
          visibleTagPolicy: {
            mode: 'prefix-filter',
            hiddenPrefixes: ['internal:', 'x-'],
            hiddenExact: [],
          },
          downloadPresetPolicy: {
            viewPresets: [
              { name: 'grid', label: 'Grid', sourceVariant: 'public' },
              { name: 'lightbox', label: 'Lightbox', sourceVariant: 'public' },
            ],
            downloadPresets: [
              { name: 'web', label: 'Web', width: 1600, fit: 'scale-down', quality: 82 },
              { name: 'review', label: 'Review', width: 2400, fit: 'scale-down', quality: 90 },
            ],
            allowedOutputFormats: ['jpg', 'webp', 'png'],
          },
          remoteProjectId: 'remote-1',
          publicSlug: 'opaque-slug',
          accessKey: 'secret-key',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T12:00:00.000Z',
          lastPublishedAt: '2026-04-01T12:00:00.000Z',
          lastPublishedRevisionId: 'revision-1',
        },
      ])
    );

    const projects = await service.listProjects('https://photos.example.com');

    expect(projects).toHaveLength(1);
    expect(projects[0].selectedImageCount).toBe(2);
    expect(projects[0].shareUrl).toBe('https://photos.example.com/p/opaque-slug?k=secret-key');
  });
});
