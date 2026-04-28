import { randomUUID } from 'node:crypto';
import { defaultClientPageAccessPolicy, defaultClientPageDownloadPresetPolicy, defaultClientPageVisibleTagPolicy } from './defaults';
import type {
  ClientPageProjectListItem,
  ClientPageProjectRecord,
  CreateClientPageProjectInput,
  ReplaceClientPageSelectionInput,
  UpdateClientPageProjectInput,
} from './types';
import type { ClientPageProjectStore } from './storage/fileStore';
import { ClientPageSelectionService } from './selectionService';
import { upsertRegistryNamespaces } from '@/server/namespaceRegistry';

const cleanOptionalString = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeNamespaces = (namespaces?: string[]) =>
  Array.from(
    new Set(
      (namespaces ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

export class ClientPageProjectService {
  constructor(
    private readonly store: ClientPageProjectStore,
    private readonly selectionService = new ClientPageSelectionService(),
    private readonly registerNamespaces: (namespaces: string[]) => Promise<void> = upsertRegistryNamespaces
  ) {}

  async listProjects(publicBaseUrl?: string): Promise<ClientPageProjectListItem[]> {
    const projects = await this.store.list();
    return projects.map((project) => ({
      ...project,
      selectedImageCount: project.selectedImageIds.length,
      shareUrl:
        publicBaseUrl && project.publicSlug && project.accessKey
          ? `${publicBaseUrl.replace(/\/$/, '')}/p/${project.publicSlug}?k=${project.accessKey}`
          : undefined,
    }));
  }

  async getProject(projectId: string): Promise<ClientPageProjectRecord | null> {
    return this.store.get(projectId);
  }

  async createProject(input: CreateClientPageProjectInput): Promise<ClientPageProjectRecord> {
    const title = input.title.trim();
    if (!title) {
      throw new Error('Project title is required.');
    }

    const projects = await this.store.list();
    const nowIso = new Date().toISOString();
    const project: ClientPageProjectRecord = {
      id: randomUUID(),
      title,
      clientName: cleanOptionalString(input.clientName),
      clientSiteId: cleanOptionalString(input.clientSiteId),
      notes: cleanOptionalString(input.notes),
      status: 'draft',
      expiresAt: input.expiresAt ?? null,
      selectedImageIds: [],
      sourceNamespaces: normalizeNamespaces(input.sourceNamespaces),
      accessPolicy: defaultClientPageAccessPolicy,
      visibleTagPolicy: defaultClientPageVisibleTagPolicy,
      downloadPresetPolicy: defaultClientPageDownloadPresetPolicy,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.writeProjects([project, ...projects]);
    await this.registerNamespaces(project.sourceNamespaces);
    return project;
  }

  async updateProject(projectId: string, patch: UpdateClientPageProjectInput): Promise<ClientPageProjectRecord> {
    const projects = await this.store.list();
    const target = projects.find((project) => project.id === projectId);
    if (!target) {
      throw new Error('Project not found.');
    }

    const nextTitle = patch.title === undefined ? target.title : patch.title.trim();
    if (!nextTitle) {
      throw new Error('Project title is required.');
    }

    const updatedProject: ClientPageProjectRecord = {
      ...target,
      title: nextTitle,
      clientName: patch.clientName === undefined ? target.clientName : cleanOptionalString(patch.clientName),
      clientSiteId: patch.clientSiteId === undefined ? target.clientSiteId : cleanOptionalString(patch.clientSiteId),
      notes: patch.notes === undefined ? target.notes : cleanOptionalString(patch.notes),
      expiresAt: patch.expiresAt === undefined ? target.expiresAt : patch.expiresAt,
      sourceNamespaces:
        patch.sourceNamespaces === undefined
          ? target.sourceNamespaces
          : normalizeNamespaces(patch.sourceNamespaces),
      updatedAt: new Date().toISOString(),
    };

    await this.store.writeProjects(
      projects.map((project) => (project.id === projectId ? updatedProject : project))
    );
    await this.registerNamespaces(updatedProject.sourceNamespaces);
    return updatedProject;
  }

  async replaceSelection(
    projectId: string,
    input: ReplaceClientPageSelectionInput
  ): Promise<ClientPageProjectRecord> {
    const projects = await this.store.list();
    const target = projects.find((project) => project.id === projectId);
    if (!target) {
      throw new Error('Project not found.');
    }

    const updatedProject: ClientPageProjectRecord = {
      ...target,
      selectedImageIds: this.selectionService.replaceSelection(input.selectedImageIds),
      updatedAt: new Date().toISOString(),
    };

    await this.store.writeProjects(
      projects.map((project) => (project.id === projectId ? updatedProject : project))
    );
    return updatedProject;
  }

  async updateStoredProject(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    const projects = await this.store.list();
    const hasExisting = projects.some((entry) => entry.id === project.id);
    if (!hasExisting) {
      throw new Error('Project not found.');
    }

    const nextProject = {
      ...project,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeProjects(
      projects.map((entry) => (entry.id === project.id ? nextProject : entry))
    );
    return nextProject;
  }
}
