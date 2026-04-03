import type {
  DownloadPresetPolicy,
  ProjectLifecycleStatus,
  SecretLinkAccessPolicy,
  VisibleTagPolicy,
} from '../publishing-contract/types';

/**
 * Persistent project record stored in D1.
 */
export interface ProjectRecord {
  id: string;
  publicSlug: string;
  title: string;
  status: ProjectLifecycleStatus;
  accessKeyHash: string;
  expiresAt?: string | null;
  accessPolicy: SecretLinkAccessPolicy;
  visibleTagPolicy: VisibleTagPolicy;
  downloadPresetPolicy: DownloadPresetPolicy;
  currentRevisionId?: string | null;
  createdAt: string;
  updatedAt: string;
}
