import { describe, expect, it } from 'vitest';

describe('Flickr runtime scheduling', async () => {
  const { parseRuntimeDuration } = await import('../scripts/flickr-ingest/config.mjs');
  const { runWithConcurrency } = await import('../scripts/flickr-ingest/util.mjs');

  it('accepts milliseconds, seconds, minutes, and hours', () => {
    expect(parseRuntimeDuration('500')).toBe(500);
    expect(parseRuntimeDuration('500ms')).toBe(500);
    expect(parseRuntimeDuration('30s')).toBe(30_000);
    expect(parseRuntimeDuration('20m')).toBe(1_200_000);
    expect(parseRuntimeDuration('2h')).toBe(7_200_000);
    expect(parseRuntimeDuration('later')).toBe(0);
  });

  it('stops assigning new items while allowing started work to finish', async () => {
    const processed: number[] = [];
    let allowedStarts = 3;

    await runWithConcurrency([1, 2, 3, 4, 5], 1, async (item: number) => {
      processed.push(item);
      allowedStarts -= 1;
    }, {
      shouldStart: () => allowedStarts > 0,
    });

    expect(processed).toEqual([1, 2, 3]);
  });
});
