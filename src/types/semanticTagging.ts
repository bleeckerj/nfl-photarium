export type SemanticTagJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'disabled';

export type SemanticTagJob = {
  jobId: string;
  imageId: string;
  state: SemanticTagJobState;
  createdAt: string;
  updatedAt: string;
  attempts?: number;
  maxAttempts?: number;
  requestedCount?: number;
  nextAttemptAt?: string;
  leaseUntil?: string;
  retryable?: boolean;
  generatedTags?: string[];
  appendedTags?: string[];
  error?: string;
  verifiedAt?: string;
};
