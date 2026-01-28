export type DeleteFamilyJobStatus = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  requestedId: string;
  rootId: string;
  total: number;
  attempted: number;
  deleted: number;
  failed: number;
  concurrency: number;
  vectorsDeleted: boolean;
  startedAt: number;
  finishedAt?: number;
  lastError?: string;
};

type JobStore = Map<string, DeleteFamilyJobStatus>;

const STORE_KEY = Symbol.for('photarium.deleteFamilyJobs');
const globalObject = globalThis as typeof globalThis & { [STORE_KEY]?: JobStore };

const getStore = (): JobStore => {
  if (!globalObject[STORE_KEY]) {
    globalObject[STORE_KEY] = new Map();
  }
  return globalObject[STORE_KEY]!;
};

const randomId = () => {
  // Good enough for UI progress tracking.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export function createDeleteFamilyJob(input: Omit<DeleteFamilyJobStatus, 'jobId' | 'attempted' | 'deleted' | 'failed' | 'status' | 'startedAt'>): DeleteFamilyJobStatus {
  const jobId = randomId();
  const job: DeleteFamilyJobStatus = {
    jobId,
    status: 'running',
    requestedId: input.requestedId,
    rootId: input.rootId,
    total: input.total,
    attempted: 0,
    deleted: 0,
    failed: 0,
    concurrency: input.concurrency,
    vectorsDeleted: input.vectorsDeleted,
    startedAt: Date.now(),
  };

  getStore().set(jobId, job);
  return job;
}

export function getDeleteFamilyJob(jobId: string): DeleteFamilyJobStatus | undefined {
  return getStore().get(jobId);
}

export function bumpDeleteFamilyJobAttempt(jobId: string, outcome: { ok: boolean; error?: string }): void {
  const store = getStore();
  const job = store.get(jobId);
  if (!job) return;

  job.attempted += 1;
  if (outcome.ok) {
    job.deleted += 1;
  } else {
    job.failed += 1;
    if (outcome.error) {
      job.lastError = outcome.error;
    }
  }

  store.set(jobId, { ...job });
}

export function completeDeleteFamilyJob(jobId: string, success: boolean, lastError?: string): void {
  const store = getStore();
  const job = store.get(jobId);
  if (!job) return;

  job.status = success ? 'completed' : 'failed';
  job.finishedAt = Date.now();
  if (lastError) job.lastError = lastError;

  store.set(jobId, { ...job });
}
