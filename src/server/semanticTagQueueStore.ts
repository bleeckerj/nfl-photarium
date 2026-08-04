import type { SemanticTagJob } from '@/types/semanticTagging';

export type SemanticTagQueueStore = {
  createOrGetJob(job: SemanticTagJob): Promise<SemanticTagJob>;
  getJob(jobId: string): Promise<SemanticTagJob | undefined>;
  saveJob(job: SemanticTagJob): Promise<void>;
  dequeue(): Promise<string | undefined>;
  enqueue(jobId: string): Promise<void>;
  enqueueDelayed(jobId: string, runAt: number): Promise<void>;
  takeReadyDelayed(now: number): Promise<string[]>;
  addLease(jobId: string, leaseUntil: number): Promise<void>;
  removeLease(jobId: string): Promise<void>;
  takeExpiredLeases(now: number): Promise<string[]>;
};

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  lpush(key: string, value: string): Promise<number>;
  rpop(key: string): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrem(key: string, member: string): Promise<number>;
  del(key: string): Promise<number>;
  connect(): Promise<void>;
  on(event: string, callback: (error?: unknown) => void): void;
};

const REDIS_PREFIX = 'photarium:semantic-tags:';
const JOB_KEY = (jobId: string) => `${REDIS_PREFIX}job:${jobId}`;
const IMAGE_KEY = (imageId: string) => `${REDIS_PREFIX}image:${imageId}`;
const PENDING_KEY = `${REDIS_PREFIX}pending`;
const DELAYED_KEY = `${REDIS_PREFIX}delayed`;
const LEASES_KEY = `${REDIS_PREFIX}leases`;

const parseJob = (value: string | null): SemanticTagJob | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as SemanticTagJob;
    return parsed && typeof parsed.jobId === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

class RedisSemanticTagQueueStore implements SemanticTagQueueStore {
  private client: RedisClient | null = null;
  private connectionPromise: Promise<void> | null = null;

  private async getClient(): Promise<RedisClient> {
    if (this.client) return this.client;
    if (!this.connectionPromise) {
      this.connectionPromise = this.connect();
    }
    await this.connectionPromise;
    if (!this.client) throw new Error('Semantic tag Redis client was not initialized');
    return this.client;
  }

  private async connect(): Promise<void> {
    try {
      const Redis = (await import(/* webpackIgnore: true */ 'ioredis' as string)).default;
      const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      });
      client.on('error', (error: unknown) => {
        console.error('[semanticTagQueue] Redis error', error instanceof Error ? error.message : error);
      });
      await client.connect();
      this.client = client as unknown as RedisClient;
    } catch (error) {
      this.connectionPromise = null;
      throw new Error(`Semantic tag queue Redis unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createOrGetJob(job: SemanticTagJob): Promise<SemanticTagJob> {
    const client = await this.getClient();
    const existingId = await client.get(IMAGE_KEY(job.imageId));
    if (existingId) {
      const existing = parseJob(await client.get(JOB_KEY(existingId)));
      if (existing && existing.state !== 'failed') return existing;
      if (existing?.state === 'failed' && existing.retryable !== false) return existing;
    }

    await client.set(JOB_KEY(job.jobId), JSON.stringify(job));
    const claimed = await client.set(IMAGE_KEY(job.imageId), job.jobId, 'NX');
    if (claimed === null) {
      const winnerId = await client.get(IMAGE_KEY(job.imageId));
      const winner = winnerId ? parseJob(await client.get(JOB_KEY(winnerId))) : undefined;
      if (winner) return winner;
    }
    if (job.state === 'queued') await client.lpush(PENDING_KEY, job.jobId);
    return job;
  }

  async getJob(jobId: string): Promise<SemanticTagJob | undefined> {
    return parseJob(await (await this.getClient()).get(JOB_KEY(jobId)));
  }

  async saveJob(job: SemanticTagJob): Promise<void> {
    await (await this.getClient()).set(JOB_KEY(job.jobId), JSON.stringify(job));
  }

  async dequeue(): Promise<string | undefined> {
    return (await (await this.getClient()).rpop(PENDING_KEY)) ?? undefined;
  }

  async enqueue(jobId: string): Promise<void> {
    await (await this.getClient()).lpush(PENDING_KEY, jobId);
  }

  async enqueueDelayed(jobId: string, runAt: number): Promise<void> {
    await (await this.getClient()).zadd(DELAYED_KEY, runAt, jobId);
  }

  async takeReadyDelayed(now: number): Promise<string[]> {
    const client = await this.getClient();
    const jobIds = await client.zrangebyscore(DELAYED_KEY, 0, now);
    for (const jobId of jobIds) {
      await client.zrem(DELAYED_KEY, jobId);
      await client.lpush(PENDING_KEY, jobId);
    }
    return jobIds;
  }

  async addLease(jobId: string, leaseUntil: number): Promise<void> {
    await (await this.getClient()).zadd(LEASES_KEY, leaseUntil, jobId);
  }

  async removeLease(jobId: string): Promise<void> {
    await (await this.getClient()).zrem(LEASES_KEY, jobId);
  }

  async takeExpiredLeases(now: number): Promise<string[]> {
    const client = await this.getClient();
    const jobIds = await client.zrangebyscore(LEASES_KEY, 0, now);
    for (const jobId of jobIds) await client.zrem(LEASES_KEY, jobId);
    return jobIds;
  }
}

class MemorySemanticTagQueueStore implements SemanticTagQueueStore {
  private readonly jobs = new Map<string, SemanticTagJob>();
  private readonly imageJobs = new Map<string, string>();
  private readonly pending: string[] = [];
  private readonly delayed = new Map<string, number>();
  private readonly leases = new Map<string, number>();

  async createOrGetJob(job: SemanticTagJob): Promise<SemanticTagJob> {
    const existingId = this.imageJobs.get(job.imageId);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && existing.state !== 'failed') return existing;
      if (existing?.state === 'failed' && existing.retryable !== false) return existing;
    }
    this.jobs.set(job.jobId, job);
    this.imageJobs.set(job.imageId, job.jobId);
    if (job.state === 'queued') this.pending.push(job.jobId);
    return job;
  }

  async getJob(jobId: string): Promise<SemanticTagJob | undefined> { return this.jobs.get(jobId); }
  async saveJob(job: SemanticTagJob): Promise<void> { this.jobs.set(job.jobId, job); }
  async dequeue(): Promise<string | undefined> { return this.pending.shift(); }
  async enqueue(jobId: string): Promise<void> { this.pending.push(jobId); }
  async enqueueDelayed(jobId: string, runAt: number): Promise<void> { this.delayed.set(jobId, runAt); }
  async takeReadyDelayed(now: number): Promise<string[]> {
    const ready = [...this.delayed.entries()].filter((entry) => entry[1] <= now).map(([jobId]) => jobId);
    for (const jobId of ready) {
      this.delayed.delete(jobId);
      this.pending.push(jobId);
    }
    return ready;
  }
  async addLease(jobId: string, leaseUntil: number): Promise<void> { this.leases.set(jobId, leaseUntil); }
  async removeLease(jobId: string): Promise<void> { this.leases.delete(jobId); }
  async takeExpiredLeases(now: number): Promise<string[]> {
    const expired = [...this.leases.entries()].filter((entry) => entry[1] <= now).map(([jobId]) => jobId);
    for (const jobId of expired) this.leases.delete(jobId);
    return expired;
  }
}

let store: SemanticTagQueueStore | undefined;

export function getSemanticTagQueueStore(): SemanticTagQueueStore {
  if (store) return store;
  store = process.env.NODE_ENV === 'test' || process.env.SEMANTIC_TAG_QUEUE_STORAGE === 'memory'
    ? new MemorySemanticTagQueueStore()
    : new RedisSemanticTagQueueStore();
  return store;
}

export function resetSemanticTagQueueStoreForTests(): void {
  store = undefined;
}
