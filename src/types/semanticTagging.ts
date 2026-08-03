export type SemanticTagJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'disabled';

export type SemanticTagJob = {
  jobId: string;
  imageId: string;
  state: SemanticTagJobState;
  createdAt: string;
  updatedAt: string;
  generatedTags?: string[];
  appendedTags?: string[];
  error?: string;
};
