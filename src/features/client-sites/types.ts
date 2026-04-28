export type ClientSiteStatus = 'draft' | 'deployed' | 'inactive' | 'deleted';

export interface ClientSiteRootProjectRecord {
  projectId: string;
  title: string;
  publicSlug: string;
  accessKey: string;
  sharePath: string;
  publishedAt: string;
  expiresAt?: string | null;
}

export interface ClientSiteRootPresentationRecord {
  defaultProjectId?: string;
  defaultPublicSlug?: string;
  defaultAccessKey?: string;
  defaultSharePath?: string;
  defaultPublishedAt?: string;
  projects: ClientSiteRootProjectRecord[];
}

export interface ClientSiteBrandingRecord {
  faviconUrl?: string;
  logoUrl?: string;
  logoAlt?: string;
}

export interface ClientSiteDeploymentRecord {
  workerName: string;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  publicBaseUrl: string;
  workersDevUrl?: string;
  customDomain?: string;
  domainStatus?: 'pending' | 'attached' | 'detached' | 'error';
  domainLastCheckedAt?: string;
  lastDeployStatus?: 'idle' | 'success' | 'failed';
  lastDeployAt?: string;
  lastDeployMessage?: string;
}

export interface ClientSiteRecord {
  id: string;
  name: string;
  slug: string;
  status: ClientSiteStatus;
  publishSecret: string;
  runtimeSecrets: {
    accessLinkHashSecret: string;
    sessionSigningSecret: string;
  };
  branding?: ClientSiteBrandingRecord;
  rootPresentation?: ClientSiteRootPresentationRecord;
  deployment: ClientSiteDeploymentRecord;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ClientSiteListItem extends ClientSiteRecord {
  linkedProjectCount: number;
}

export interface CreateClientSiteInput {
  name: string;
  slug?: string;
  customDomain?: string;
}

export interface UpdateClientSiteInput {
  name?: string;
  customDomain?: string | null;
  status?: ClientSiteStatus;
}

export interface ClientSitesStorePayload {
  clientSites: ClientSiteRecord[];
  updatedAt: string;
}
