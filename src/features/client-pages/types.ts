import type {
  ClientSiteAccessPolicy,
  ClientSiteDownloadPresetPolicy,
  ClientSiteVisibleTagPolicy,
  ClientSiteStatus,
} from '@/features/client-sites-publishing/types';

export type ClientPageProjectStatus = ClientSiteStatus;

export interface ClientPageProjectRecord {
  id: string;
  title: string;
  clientName?: string;
  notes?: string;
  status: ClientPageProjectStatus;
  expiresAt?: string | null;
  selectedImageIds: string[];
  sourceNamespaces: string[];
  accessPolicy: ClientSiteAccessPolicy;
  visibleTagPolicy: ClientSiteVisibleTagPolicy;
  downloadPresetPolicy: ClientSiteDownloadPresetPolicy;
  remoteProjectId?: string;
  publicSlug?: string;
  accessKey?: string;
  lastPublishedRevisionId?: string;
  lastPublishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientPageProjectListItem extends ClientPageProjectRecord {
  selectedImageCount: number;
  shareUrl?: string;
}

export interface CreateClientPageProjectInput {
  title: string;
  clientName?: string;
  notes?: string;
  expiresAt?: string | null;
  sourceNamespaces?: string[];
}

export interface UpdateClientPageProjectInput {
  title?: string;
  clientName?: string;
  notes?: string;
  expiresAt?: string | null;
  sourceNamespaces?: string[];
}

export interface ReplaceClientPageSelectionInput {
  selectedImageIds: string[];
}

export interface ReorderClientPageSelectionInput {
  selectedImageIds: string[];
}

export interface ClientPagePublishResult {
  project: ClientPageProjectRecord;
  shareUrl: string;
  manifestRevisionId: string;
}

export interface ClientPagesStorePayload {
  projects: ClientPageProjectRecord[];
  updatedAt: string;
}
