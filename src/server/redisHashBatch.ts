export type RedisHashBatchClient = {
  pipeline: () => {
    hmget: (key: string, ...fields: string[]) => unknown;
    exec: () => Promise<Array<[Error | null, unknown]> | null>;
  };
};

const DEFAULT_HASH_BATCH_SIZE = 500;

/**
 * Read hash fields without constructing one unbounded Redis pipeline.
 *
 * Gallery filters can inspect tens of thousands of assets at once. Splitting
 * those reads keeps ioredis from assembling the entire request as one large
 * UTF-8 stream buffer while preserving the input order within each batch.
 */
export async function batchReadRedisHashFields(
  client: RedisHashBatchClient,
  keys: readonly string[],
  fields: readonly string[],
  batchSize = DEFAULT_HASH_BATCH_SIZE,
): Promise<Map<string, unknown[]>> {
  const valuesByKey = new Map<string, unknown[]>();
  const safeBatchSize = Math.max(1, Math.floor(batchSize));

  for (let start = 0; start < keys.length; start += safeBatchSize) {
    const batchKeys = keys.slice(start, start + safeBatchSize);
    const pipeline = client.pipeline();
    for (const key of batchKeys) {
      pipeline.hmget(key, ...fields);
    }

    const responses = await pipeline.exec();
    if (!responses) continue;

    for (let index = 0; index < batchKeys.length; index += 1) {
      const [error, rawValues] = responses[index] ?? [];
      if (error || !Array.isArray(rawValues)) continue;
      valuesByKey.set(batchKeys[index], rawValues);
    }
  }

  return valuesByKey;
}
