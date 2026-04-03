import type { CreateProjectRequest, ProjectStatusChange, PublishedProjectManifest } from '../publishing-contract/types';
import { createProjectRequestSchema, projectStatusChangeSchema, publishedProjectManifestSchema } from '../publishing-contract/schema';
import { ProjectRepository } from './repository';
import type { ProjectRecord } from './types';
import { createAccessKey, createOpaqueSlug, hashAccessKey } from '../access/token';

const defaultAccessPolicy = {
  mode: 'secret-link' as const,
  sessionTtlSeconds: 60 * 60 * 24 * 14,
};

const defaultVisibleTagPolicy = {
  mode: 'prefix-filter' as const,
  hiddenPrefixes: ['x-', 'internal:'],
  hiddenExact: ['x-search', 'x-clip', 'x-color'],
};

const defaultDownloadPresetPolicy = {
  viewPresets: [
    { name: 'grid', label: 'Grid', sourceVariant: 'public' },
    { name: 'lightbox', label: 'Lightbox', sourceVariant: 'public' },
  ],
  downloadPresets: [
    { name: 'web', label: 'Web', width: 1600, fit: 'scale-down' as const, quality: 82 },
    { name: 'review', label: 'Review', width: 2400, fit: 'scale-down' as const, quality: 90 },
  ],
  allowedOutputFormats: ['jpg', 'webp', 'png'] as const,
};

/**
 * Business logic for project creation, publishing, and lifecycle transitions.
 */
export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly accessHashSecret: string
  ) {}

  async createProject(input: unknown): Promise<{ project: ProjectRecord; accessKey: string }> {
    const parsed = createProjectRequestSchema.parse(input) as CreateProjectRequest;
    const accessKey = createAccessKey();
    const accessKeyHash = await hashAccessKey(accessKey, this.accessHashSecret);
    const nowIso = new Date().toISOString();

    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      publicSlug: createOpaqueSlug(),
      title: parsed.title,
      status: 'draft',
      accessKeyHash,
      expiresAt: parsed.expiresAt ?? null,
      accessPolicy: parsed.accessPolicy ?? defaultAccessPolicy,
      visibleTagPolicy: parsed.visibleTagPolicy ?? defaultVisibleTagPolicy,
      downloadPresetPolicy: parsed.downloadPresetPolicy ?? defaultDownloadPresetPolicy,
      currentRevisionId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repository.insert(project);
    return { project, accessKey };
  }

  parseManifest(input: unknown): PublishedProjectManifest {
    return publishedProjectManifestSchema.parse(input);
  }

  parseStatusChange(input: unknown): ProjectStatusChange {
    return projectStatusChangeSchema.parse(input);
  }
}
