import { CLIP_EMBEDDING_DIM } from '@/server/embeddingService';

interface RedisClient {
  call(command: string, ...args: (string | number | Buffer)[]): Promise<unknown>;
  hset(key: string, data: Record<string, string | Buffer>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  del(key: string): Promise<number>;
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  connect(): Promise<void>;
  on(event: string, callback: (arg?: unknown) => void): void;
}

const WORKFLOW_INTENT_INDEX_NAME = 'idx:workflow_intent';
const WORKFLOW_INTENT_KEY_PREFIX = 'workflow_intent:';
const WORKFLOW_INTENT_VECTOR_FIELD = 'workflow_intent_embedding';

export type WorkflowIntentVectorRecord = {
  imageId: string;
  workflowIntentEmbedding: number[];
  workflowIntentText: string;
  promptCandidates: string[];
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  embeddingModel: string;
  embeddingVersion: string;
  updatedAt: string;
};

export type WorkflowIntentSearchResult = {
  imageId: string;
  score: number;
  workflowIntentText?: string;
  promptCandidates?: string[];
  nodeTypeSignatures?: string[];
  nodeSettingSignatures?: string[];
  embeddingModel?: string;
  embeddingVersion?: string;
};

let redisClient: RedisClient | null = null;
let connectionPromise: Promise<void> | null = null;

function vectorToBuffer(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index], index * 4);
  }
  return buffer;
}

function decodeCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateEmbeddingDimensions(embedding: number[]): void {
  if (embedding.length !== CLIP_EMBEDDING_DIM) {
    throw new Error(
      `workflow intent embedding dimension mismatch: expected ${CLIP_EMBEDDING_DIM}, got ${embedding.length}`
    );
  }
}

async function connect(): Promise<void> {
  const Redis = (await import(/* webpackIgnore: true */ 'ioredis' as string)).default;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (error: Error) => {
    console.error('[WorkflowIntentSearch] Redis error:', error.message);
  });

  await client.connect();
  redisClient = client as unknown as RedisClient;
}

async function getRedisClient(): Promise<RedisClient> {
  if (redisClient) return redisClient;

  if (connectionPromise) {
    await connectionPromise;
    if (!redisClient) {
      throw new Error('[WorkflowIntentSearch] Redis client failed to initialize');
    }
    return redisClient;
  }

  connectionPromise = connect();
  await connectionPromise;
  if (!redisClient) {
    throw new Error('[WorkflowIntentSearch] Redis client failed to initialize');
  }
  return redisClient;
}

export async function ensureWorkflowIntentIndex(): Promise<void> {
  const client = await getRedisClient();

  try {
    await client.call('FT.INFO', WORKFLOW_INTENT_INDEX_NAME);
    return;
  } catch {
    // Index does not exist and will be created below.
  }

  await client.call(
    'FT.CREATE',
    WORKFLOW_INTENT_INDEX_NAME,
    'ON',
    'HASH',
    'PREFIX',
    '1',
    WORKFLOW_INTENT_KEY_PREFIX,
    'SCHEMA',
    'image_id',
    'TAG',
    'SORTABLE',
    'workflow_intent_text',
    'TEXT',
    'prompt_candidates',
    'TEXT',
    'node_type_signatures',
    'TEXT',
    'node_setting_signatures',
    'TEXT',
    'embedding_model',
    'TAG',
    'embedding_version',
    'TAG',
    WORKFLOW_INTENT_VECTOR_FIELD,
    'VECTOR',
    'FLAT',
    '6',
    'TYPE',
    'FLOAT32',
    'DIM',
    String(CLIP_EMBEDDING_DIM),
    'DISTANCE_METRIC',
    'COSINE'
  );
}

export async function storeWorkflowIntentEmbedding(data: WorkflowIntentVectorRecord): Promise<void> {
  validateEmbeddingDimensions(data.workflowIntentEmbedding);

  const client = await getRedisClient();
  const key = `${WORKFLOW_INTENT_KEY_PREFIX}${data.imageId}`;

  const fields: Record<string, string | Buffer> = {
    image_id: data.imageId,
    workflow_intent_text: data.workflowIntentText,
    prompt_candidates: data.promptCandidates.join(','),
    node_type_signatures: data.nodeTypeSignatures.join(','),
    node_setting_signatures: data.nodeSettingSignatures.join(','),
    embedding_model: data.embeddingModel,
    embedding_version: data.embeddingVersion,
    updated_at: data.updatedAt,
    [WORKFLOW_INTENT_VECTOR_FIELD]: vectorToBuffer(data.workflowIntentEmbedding),
  };

  await client.hset(key, fields);
}

export async function getWorkflowIntentEmbedding(
  imageId: string
): Promise<WorkflowIntentVectorRecord | null> {
  const client = await getRedisClient();
  const key = `${WORKFLOW_INTENT_KEY_PREFIX}${imageId}`;

  const hashData = await client.hgetall(key);
  if (!hashData || Object.keys(hashData).length === 0) {
    return null;
  }

  const vectorField = await (
    client as unknown as {
      hgetBuffer: (lookupKey: string, field: string) => Promise<Buffer | null>;
    }
  ).hgetBuffer(key, WORKFLOW_INTENT_VECTOR_FIELD);

  if (!vectorField || !Buffer.isBuffer(vectorField)) {
    return null;
  }

  const embedding: number[] = [];
  for (let index = 0; index < vectorField.length; index += 4) {
    embedding.push(vectorField.readFloatLE(index));
  }

  return {
    imageId,
    workflowIntentEmbedding: embedding,
    workflowIntentText: hashData.workflow_intent_text ?? '',
    promptCandidates: decodeCsv(hashData.prompt_candidates),
    nodeTypeSignatures: decodeCsv(hashData.node_type_signatures),
    nodeSettingSignatures: decodeCsv(hashData.node_setting_signatures),
    embeddingModel: hashData.embedding_model ?? '',
    embeddingVersion: hashData.embedding_version ?? '',
    updatedAt: hashData.updated_at ?? '',
  };
}

function parseSearchResults(searchResult: [number, ...unknown[]]): WorkflowIntentSearchResult[] {
  const [, ...items] = searchResult;
  const parsed: WorkflowIntentSearchResult[] = [];

  for (let index = 0; index < items.length; index += 2) {
    const redisKey = String(items[index]);
    const fields = items[index + 1] as string[];

    const fieldMap: Record<string, string> = {};
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 2) {
      fieldMap[String(fields[fieldIndex])] = String(fields[fieldIndex + 1] ?? '');
    }

    parsed.push({
      imageId: redisKey.replace(WORKFLOW_INTENT_KEY_PREFIX, ''),
      score: Number.parseFloat(fieldMap.score) || 0,
      workflowIntentText: fieldMap.workflow_intent_text,
      promptCandidates: decodeCsv(fieldMap.prompt_candidates),
      nodeTypeSignatures: decodeCsv(fieldMap.node_type_signatures),
      nodeSettingSignatures: decodeCsv(fieldMap.node_setting_signatures),
      embeddingModel: fieldMap.embedding_model,
      embeddingVersion: fieldMap.embedding_version,
    });
  }

  return parsed;
}

export async function searchWorkflowIntentByEmbedding(params: {
  embedding: number[];
  limit?: number;
  offset?: number;
}): Promise<WorkflowIntentSearchResult[]> {
  validateEmbeddingDimensions(params.embedding);

  const client = await getRedisClient();
  const limit = Math.min(250, Math.max(1, params.limit ?? 20));
  const offset = Math.max(0, params.offset ?? 0);
  const knnCount = offset + limit;

  const redisResult = (await client.call(
    'FT.SEARCH',
    WORKFLOW_INTENT_INDEX_NAME,
    `*=>[KNN ${knnCount} @${WORKFLOW_INTENT_VECTOR_FIELD} $vec AS score]`,
    'PARAMS',
    '2',
    'vec',
    vectorToBuffer(params.embedding),
    'SORTBY',
    'score',
    'LIMIT',
    String(offset),
    String(limit),
    'RETURN',
    '7',
    'workflow_intent_text',
    'prompt_candidates',
    'node_type_signatures',
    'node_setting_signatures',
    'embedding_model',
    'embedding_version',
    'score',
    'DIALECT',
    '2'
  )) as [number, ...unknown[]];

  return parseSearchResults(redisResult);
}

export async function deleteWorkflowIntentEmbedding(imageId: string): Promise<void> {
  const client = await getRedisClient();
  await client.del(`${WORKFLOW_INTENT_KEY_PREFIX}${imageId}`);
}

export async function listWorkflowIntentEmbeddingImageIds(): Promise<string[]> {
  const client = await getRedisClient();
  const ids: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      'MATCH',
      `${WORKFLOW_INTENT_KEY_PREFIX}*`,
      'COUNT',
      '200'
    );
    cursor = nextCursor;
    for (const key of keys) {
      if (key.startsWith(WORKFLOW_INTENT_KEY_PREFIX)) {
        ids.push(key.slice(WORKFLOW_INTENT_KEY_PREFIX.length));
      }
    }
  } while (cursor !== '0');

  return ids;
}

export async function isWorkflowIntentSearchAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    await client.call('FT.INFO', WORKFLOW_INTENT_INDEX_NAME);
    return true;
  } catch {
    return false;
  }
}

export function __resetWorkflowIntentSearchForTests(): void {
  redisClient = null;
  connectionPromise = null;
}
