import type { ClientShortlistSubmission } from '../publishing-contract/types';

/**
 * Stored shortlist submission record.
 */
export interface ShortlistSubmissionRecord extends ClientShortlistSubmission {
  id: string;
  projectId: string;
  createdAt: string;
}
