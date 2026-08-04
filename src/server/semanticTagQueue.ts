import { randomUUID } from 'crypto';

import { generateAndPersistSemanticTags } from '@/server/semanticTagService';
import type { SemanticTagJob } from '@/types/semanticTagging';
import { getSemanticTagQueueStore } from '@/server/semanticTagQueueStore';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 10 * 1000;
const WORKER_POLL_MS = 1_000;
const WORKER_ERROR_RETRY_MS = 5 * 1000;

const maxAttempts = () => {
  const configured = Number.parseInt(process.env.SEMANTIC_TAG_QUEUE_MAX_ATTEMPTS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : MAX_ATTEMPTS;
};

const now = () => new Date().toISOString();
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const isDisabled = () => ['0', 'false', 'no', 'off'].includes(process.env.AUTO_TAGS_ON_UPLOAD?.trim().toLowerCase() ?? '');

const fallbackJobs = new Map<string, SemanticTagJob>();
let memoryDrainScheduled = false;

export type EnqueueSemanticTagOptions = {
  enabled?: boolean;
  count?: number;
};

export const isSemanticTaggingEnabledForUpload = (options: EnqueueSemanticTagOptions = {}) => {
  if (options.enabled === false) return false;
  return !isDisabled();
};

const createJob = (imageId: string, state: SemanticTagJob['state'], count?: number): SemanticTagJob => ({
  jobId: randomUUID(),
  imageId,
  state,
  createdAt: now(),
  updatedAt: now(),
  attempts: 0,
  maxAttempts: maxAttempts(),
  ...(count === undefined ? {} : { requestedCount: count }),
  ...(state === 'disabled' ? { retryable: false } : {}),
});

const saveFallbackFailure = (imageId: string, error: unknown): SemanticTagJob => {
  const job: SemanticTagJob = {
    ...createJob(imageId, 'failed'),
    error: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
  fallbackJobs.set(job.jobId, job);
  return job;
};

async function processJob(jobId: string): Promise<SemanticTagJob | undefined> {
  const store = getSemanticTagQueueStore();
  const job = await store.getJob(jobId);
  if (!job || job.state !== 'queued') return job;

  const attempts = (job.attempts ?? 0) + 1;
  const running: SemanticTagJob = {
    ...job,
    state: 'running',
    attempts,
    leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(),
    updatedAt: now(),
  };
  await store.saveJob(running);
  await store.addLease(jobId, Date.now() + LEASE_MS);

  try {
    const result = await generateAndPersistSemanticTags({
      imageId: job.imageId,
      count: job.requestedCount,
    });
    const succeeded: SemanticTagJob = {
      ...running,
      state: 'succeeded',
      generatedTags: result.tags,
      appendedTags: result.appendedTags,
      retryable: false,
      leaseUntil: undefined,
      verifiedAt: now(),
      updatedAt: now(),
    };
    await store.removeLease(jobId);
    await store.saveJob(succeeded);
    return succeeded;
  } catch (error) {
    await store.removeLease(jobId);
    const message = error instanceof Error ? error.message : String(error);
    const retryable = attempts < (job.maxAttempts ?? MAX_ATTEMPTS);
    const failed: SemanticTagJob = {
      ...running,
      state: retryable ? 'queued' : 'failed',
      error: message,
      retryable,
      leaseUntil: undefined,
      nextAttemptAt: retryable
        ? new Date(Date.now() + BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1)).toISOString()
        : undefined,
      updatedAt: now(),
    };
    await store.saveJob(failed);
    if (retryable) await store.enqueueDelayed(jobId, Date.parse(failed.nextAttemptAt!));
    console.warn('[semanticTagQueue] Semantic tag generation failed', {
      jobId,
      imageId: job.imageId,
      attempts,
      retryable,
      error: message,
    });
    return failed;
  }
}

async function recoverExpiredJobs(): Promise<void> {
  const store = getSemanticTagQueueStore();
  for (const jobId of await store.takeExpiredLeases(Date.now())) {
    const job = await store.getJob(jobId);
    if (!job || job.state !== 'running') continue;
    const recovered: SemanticTagJob = {
      ...job,
      state: 'queued',
      leaseUntil: undefined,
      error: 'Worker lease expired; job returned to the queue.',
      retryable: true,
      updatedAt: now(),
    };
    await store.saveJob(recovered);
    await store.enqueue(jobId);
  }
}

async function moveReadyDelayedJobs(): Promise<void> {
  const store = getSemanticTagQueueStore();
  await store.takeReadyDelayed(Date.now());
}

export async function enqueueSemanticTagJob(
  imageId: string,
  options: EnqueueSemanticTagOptions = {},
): Promise<SemanticTagJob> {
  const disabled = !isSemanticTaggingEnabledForUpload(options);
  const job = createJob(imageId, disabled ? 'disabled' : 'queued', options.count);
  try {
    const persisted = await getSemanticTagQueueStore().createOrGetJob(job);
    if (persisted.state === 'queued' && process.env.NODE_ENV === 'test') scheduleMemoryDrain();
    return persisted;
  } catch (error) {
    const failed = saveFallbackFailure(imageId, error);
    console.error('[semanticTagQueue] Could not enqueue semantic tag job', {
      imageId,
      jobId: failed.jobId,
      error: failed.error,
    });
    return failed;
  }
}

export async function getSemanticTagJob(jobId: string): Promise<SemanticTagJob | undefined> {
  const fallback = fallbackJobs.get(jobId);
  if (fallback) return fallback;
  try {
    return await getSemanticTagQueueStore().getJob(jobId);
  } catch (error) {
    console.warn('[semanticTagQueue] Could not read semantic tag job', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function retrySemanticTagJob(jobId: string): Promise<SemanticTagJob | undefined> {
  const fallback = fallbackJobs.get(jobId);
  if (fallback) {
    fallbackJobs.delete(jobId);
    return enqueueSemanticTagJob(fallback.imageId, {
      count: fallback.requestedCount,
    });
  }
  const store = getSemanticTagQueueStore();
  const job = await store.getJob(jobId);
  if (!job || job.state === 'succeeded' || job.state === 'disabled') return job;
  const retried: SemanticTagJob = {
    ...job,
    state: 'queued',
    error: undefined,
    retryable: true,
    nextAttemptAt: undefined,
    updatedAt: now(),
  };
  await store.saveJob(retried);
  await store.enqueue(jobId);
  return retried;
}

export async function runSemanticTagWorker(options: { once?: boolean; signal?: AbortSignal } = {}): Promise<void> {
  do {
    try {
      await recoverExpiredJobs();
      await moveReadyDelayedJobs();
      const jobId = await getSemanticTagQueueStore().dequeue();
      if (jobId) {
        await processJob(jobId);
        if (options.once) return;
        continue;
      }
      if (options.once || options.signal?.aborted) return;
      await wait(WORKER_POLL_MS);
    } catch (error) {
      console.error('[semanticTagQueue] Worker cycle failed; retrying', error);
      if (options.once) throw error;
      if (options.signal?.aborted) return;
      await wait(WORKER_ERROR_RETRY_MS);
    }
  } while (!options.signal?.aborted);
}

function scheduleMemoryDrain(): void {
  if (memoryDrainScheduled) return;
  memoryDrainScheduled = true;
  setTimeout(() => {
    memoryDrainScheduled = false;
    void runSemanticTagWorker({ once: true });
  }, 0);
}
