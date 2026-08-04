import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateAndPersistSemanticTagsMock } = vi.hoisted(() => ({
  generateAndPersistSemanticTagsMock: vi.fn(),
}));

vi.mock('@/server/semanticTagService', () => ({
  generateAndPersistSemanticTags: generateAndPersistSemanticTagsMock,
}));

import { enqueueSemanticTagJob, getSemanticTagJob } from '@/server/semanticTagQueue';
import { resetSemanticTagQueueStoreForTests } from '@/server/semanticTagQueueStore';

const waitForTerminalState = async (jobId: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await getSemanticTagJob(jobId);
    if (job?.state === 'succeeded' || job?.state === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return getSemanticTagJob(jobId);
};

describe('semantic tag queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTO_TAGS_ON_UPLOAD;
    process.env.SEMANTIC_TAG_QUEUE_MAX_ATTEMPTS = '1';
    resetSemanticTagQueueStoreForTests();
  });

  it('returns immediately and records a successful background result', async () => {
    generateAndPersistSemanticTagsMock.mockResolvedValue({
      tags: ['portrait'],
      appendedTags: ['portrait'],
      model: 'test-model',
      saved: true,
    });

    const queued = await enqueueSemanticTagJob('img-queued');
    expect(queued.state).toBe('queued');

    const completed = await waitForTerminalState(queued.jobId);
    expect(completed?.state).toBe('succeeded');
    expect(completed?.appendedTags).toEqual(['portrait']);
    expect(generateAndPersistSemanticTagsMock).toHaveBeenCalledWith({ imageId: 'img-queued' });
  });

  it('records a failure without throwing into the upload request', async () => {
    generateAndPersistSemanticTagsMock.mockRejectedValue(new Error('OpenAI unavailable'));

    const queued = await enqueueSemanticTagJob('img-failing');
    const initialState = queued.state;
    const completed = await waitForTerminalState(queued.jobId);

    expect(initialState).toBe('queued');
    expect(completed?.state).toBe('failed');
    expect(completed?.error).toBe('OpenAI unavailable');
  });

  it('supports an immediate feature-flag back-out without affecting uploads', async () => {
    process.env.AUTO_TAGS_ON_UPLOAD = 'false';

    const job = await enqueueSemanticTagJob('img-disabled');

    expect(job.state).toBe('disabled');
    expect(generateAndPersistSemanticTagsMock).not.toHaveBeenCalled();
  });
});
