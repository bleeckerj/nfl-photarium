import { describe, expect, it } from 'vitest';
import {
  batchReadRedisHashFields,
  type RedisHashBatchClient,
} from '@/server/redisHashBatch';

describe('batchReadRedisHashFields', () => {
  it('splits large hash reads into bounded HMGET pipelines', async () => {
    const pipelineSizes: number[] = [];
    const requestedFields: string[][] = [];
    const client: RedisHashBatchClient = {
      pipeline: () => {
        const keys: string[] = [];
        return {
          hmget: (key, ...fields) => {
            keys.push(key);
            requestedFields.push(fields);
          },
          exec: async () => {
            pipelineSizes.push(keys.length);
            return keys.map((key) => [null, [`ratio:${key}`, 'vertical']] as [null, unknown]);
          },
        };
      },
    };
    const keys = Array.from({ length: 1_201 }, (_, index) => `image:${index}`);

    const result = await batchReadRedisHashFields(
      client,
      keys,
      ['aspect_ratio', 'aspect_ratio_class'],
      500,
    );

    expect(pipelineSizes).toEqual([500, 500, 201]);
    expect(requestedFields).toHaveLength(1_201);
    expect(requestedFields[0]).toEqual(['aspect_ratio', 'aspect_ratio_class']);
    expect(result).toHaveLength(1_201);
    expect(result.get('image:1200')).toEqual(['ratio:image:1200', 'vertical']);
  });
});
