import { describe, expect, it } from 'vitest';

describe('flickr ingest checkpoint helpers', async () => {
  const checkpoint = await import('../scripts/flickr-ingest/checkpoint.mjs');

  it('skips resumable success entries when lastUpdate is unchanged', () => {
    expect(
      checkpoint.shouldSkipCheckpointEntry(
        {
          status: 'uploaded',
          flickrLastUpdate: '123',
        },
        '123',
        true
      )
    ).toBe(true);
  });

  it('does not skip when resume is disabled or updates changed', () => {
    expect(
      checkpoint.shouldSkipCheckpointEntry(
        {
          status: 'uploaded',
          flickrLastUpdate: '123',
        },
        '456',
        true
      )
    ).toBe(false);

    expect(
      checkpoint.shouldSkipCheckpointEntry(
        {
          status: 'uploaded',
          flickrLastUpdate: '123',
        },
        '123',
        false
      )
    ).toBe(false);
  });

  it('counts only durable successful checkpoint entries', () => {
    expect(checkpoint.countSuccessfulCheckpointEntries({
      entries: {
        one: { status: 'uploaded' },
        two: { status: 'duplicate' },
        three: { status: 'unsupported' },
        four: { status: 'failed' },
      },
    })).toBe(2);
  });
});
