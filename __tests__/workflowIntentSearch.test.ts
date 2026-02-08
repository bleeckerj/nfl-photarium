import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockHash = Record<string, string | Buffer>;

const mockRedisState = {
  indexExists: false,
  hashes: new Map<string, MockHash>(),
  commands: [] as Array<{ command: string; args: Array<string | number | Buffer> }>,
  searchResult: [0] as [number, ...unknown[]],
};

class MockRedis {
  constructor(url: string, options: Record<string, unknown>) {
    void url;
    void options;
  }

  on(event: string, callback: (arg?: unknown) => void): void {
    void event;
    void callback;
  }

  async connect(): Promise<void> {}

  async quit(): Promise<void> {}

  async call(command: string, ...args: (string | number | Buffer)[]): Promise<unknown> {
    mockRedisState.commands.push({ command, args });

    if (command === 'FT.INFO') {
      if (!mockRedisState.indexExists) {
        throw new Error('Unknown Index name');
      }
      return ['index_name', 'idx:workflow_intent'];
    }

    if (command === 'FT.CREATE') {
      mockRedisState.indexExists = true;
      return 'OK';
    }

    if (command === 'FT.SEARCH') {
      return mockRedisState.searchResult;
    }

    throw new Error(`Unsupported command in mock: ${command}`);
  }

  async hset(key: string, data: Record<string, string | Buffer>): Promise<number> {
    const existing = mockRedisState.hashes.get(key) ?? {};
    mockRedisState.hashes.set(key, { ...existing, ...data });
    return 1;
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const hash = mockRedisState.hashes.get(key);
    if (!hash) return null;

    const output: Record<string, string> = {};
    for (const [field, value] of Object.entries(hash)) {
      if (typeof value === 'string') {
        output[field] = value;
      }
    }
    return output;
  }

  async hgetBuffer(key: string, field: string): Promise<Buffer | null> {
    const hash = mockRedisState.hashes.get(key);
    if (!hash) return null;
    const value = hash[field];
    return Buffer.isBuffer(value) ? value : null;
  }

  async del(key: string): Promise<number> {
    return mockRedisState.hashes.delete(key) ? 1 : 0;
  }
}

vi.mock('ioredis', () => ({ default: MockRedis }));

import {
  __resetWorkflowIntentSearchForTests,
  ensureWorkflowIntentIndex,
  isWorkflowIntentSearchAvailable,
  searchWorkflowIntentByEmbedding,
  storeWorkflowIntentEmbedding,
} from '@/server/comfy/workflowIntentSearch';

const buildEmbedding = () => Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0));

describe('workflowIntentSearch', () => {
  beforeEach(() => {
    mockRedisState.indexExists = false;
    mockRedisState.hashes.clear();
    mockRedisState.commands = [];
    mockRedisState.searchResult = [0];
    __resetWorkflowIntentSearchForTests();
  });

  it('creates workflow intent index when missing, then no-ops when present', async () => {
    await ensureWorkflowIntentIndex();
    await ensureWorkflowIntentIndex();

    const createCommands = mockRedisState.commands.filter((entry) => entry.command === 'FT.CREATE');
    expect(createCommands).toHaveLength(1);
    expect(mockRedisState.indexExists).toBe(true);
  });

  it('rejects invalid workflow intent embedding dimensions', async () => {
    await expect(
      storeWorkflowIntentEmbedding({
        imageId: 'bad-dim',
        workflowIntentEmbedding: [0.1, 0.2, 0.3],
        workflowIntentText: 'invalid',
        promptCandidates: [],
        nodeTypeSignatures: [],
        nodeSettingSignatures: [],
        embeddingModel: 'clip-ViT-B-32',
        embeddingVersion: 'v1',
        updatedAt: '2026-02-07T00:00:00.000Z',
      })
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it('stores embedding records and returns ANN search results', async () => {
    const embedding = buildEmbedding();

    await storeWorkflowIntentEmbedding({
      imageId: 'img-1',
      workflowIntentEmbedding: embedding,
      workflowIntentText: 'prompt_candidates: cinematic storm',
      promptCandidates: ['cinematic storm'],
      nodeTypeSignatures: ['CLIPTextEncode', 'KSampler'],
      nodeSettingSignatures: ['KSampler(steps=30,cfg=7)'],
      embeddingModel: 'clip-ViT-B-32',
      embeddingVersion: 'v1',
      updatedAt: '2026-02-07T00:00:00.000Z',
    });

    mockRedisState.searchResult = [
      1,
      'workflow_intent:img-1',
      [
        'workflow_intent_text',
        'prompt_candidates: cinematic storm',
        'prompt_candidates',
        'cinematic storm',
        'node_type_signatures',
        'CLIPTextEncode,KSampler',
        'node_setting_signatures',
        'KSampler(steps=30,cfg=7)',
        'embedding_model',
        'clip-ViT-B-32',
        'embedding_version',
        'v1',
        'score',
        '0.112',
      ],
    ];

    const results = await searchWorkflowIntentByEmbedding({ embedding, limit: 10, offset: 0 });

    expect(results).toHaveLength(1);
    expect(results[0].imageId).toBe('img-1');
    expect(results[0].score).toBeCloseTo(0.112);
    expect(results[0].promptCandidates).toEqual(['cinematic storm']);
    expect(results[0].nodeTypeSignatures).toEqual(['CLIPTextEncode', 'KSampler']);
  });

  it('reports search availability only when index exists', async () => {
    expect(await isWorkflowIntentSearchAvailable()).toBe(false);
    mockRedisState.indexExists = true;
    expect(await isWorkflowIntentSearchAvailable()).toBe(true);
  });
});
