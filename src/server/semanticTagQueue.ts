import { randomUUID } from 'crypto';

import { generateAndPersistSemanticTags } from '@/server/semanticTagService';
import type { SemanticTagJob } from '@/types/semanticTagging';

const MAX_PENDING_JOBS = 100;
const JOB_RETENTION_MS = 15 * 60 * 1000;
const pendingJobs: SemanticTagJob[] = [];
const jobs = new Map<string, SemanticTagJob>();
let activeWorkers = 0;
let drainScheduled = false;

const isDisabled = () => {
  const value = process.env.AUTO_TAGS_ON_UPLOAD?.trim().toLowerCase();
  return value === '0' || value === 'false' || value === 'no' || value === 'off';
};

const now = () => new Date().toISOString();

const pruneJobs = () => {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [jobId, job] of jobs) {
    if (Date.parse(job.updatedAt) < cutoff && job.state !== 'queued' && job.state !== 'running') {
      jobs.delete(jobId);
    }
  }
};

const scheduleDrain = () => {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    drainQueue();
  }, 0);
};

const runJob = async (job: SemanticTagJob) => {
  job.state = 'running';
  job.updatedAt = now();
  try {
    const result = await generateAndPersistSemanticTags({ imageId: job.imageId });
    job.state = 'succeeded';
    job.generatedTags = result.tags;
    job.appendedTags = result.appendedTags;
    job.updatedAt = now();
  } catch (error) {
    job.state = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.updatedAt = now();
    console.warn('[semanticTagQueue] Semantic tag generation failed', {
      jobId: job.jobId,
      imageId: job.imageId,
      error: job.error,
    });
  }
};

const drainQueue = () => {
  while (activeWorkers < 1 && pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    if (!job) return;
    activeWorkers += 1;
    void runJob(job).finally(() => {
      activeWorkers = Math.max(0, activeWorkers - 1);
      pruneJobs();
      if (pendingJobs.length > 0) scheduleDrain();
    });
  }
};

export const isSemanticTaggingEnabledForUpload = () => !isDisabled();

export const enqueueSemanticTagJob = (imageId: string): SemanticTagJob => {
  pruneJobs();
  const timestamp = now();
  const job: SemanticTagJob = {
    jobId: randomUUID(),
    imageId,
    state: isDisabled() ? 'disabled' : 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (job.state === 'disabled') {
    jobs.set(job.jobId, job);
    return job;
  }

  if (pendingJobs.length >= MAX_PENDING_JOBS) {
    job.state = 'failed';
    job.error = 'Semantic tag queue is full';
    jobs.set(job.jobId, job);
    return job;
  }

  jobs.set(job.jobId, job);
  pendingJobs.push(job);
  scheduleDrain();
  return job;
};

export const getSemanticTagJob = (jobId: string): SemanticTagJob | undefined => {
  pruneJobs();
  return jobs.get(jobId);
};
