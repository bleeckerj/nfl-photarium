import { describe, expect, it } from 'vitest';

describe('flickr ingest config', async () => {
  const { parseCliArgs } = await import('../scripts/flickr-ingest/config.mjs');

  it('parses album selectors and stackable verbosity flags', () => {
    const options = parseCliArgs([
      'ingest',
      '--selector',
      'album',
      '--album',
      'Road Trip',
      '--album-id',
      '721777',
      '--namespace',
      'cf-flickr',
      '-vvvv',
    ]);

    expect(options.errors).toEqual([]);
    expect(options.selector).toBe('album');
    expect(options.albums).toEqual(['Road Trip']);
    expect(options.albumIds).toEqual(['721777']);
    expect(options.verbosity).toBe(5);
  });

  it('rejects tag selectors without tags', () => {
    const options = parseCliArgs([
      'ingest',
      '--selector',
      'tag',
    ]);

    expect(options.errors).toContain('Tag selector requires at least one --tag.');
  });

  it('parses runtime units and rejects combining runtime with limit', () => {
    const runtime = parseCliArgs(['ingest', '--runtime', '1.5h']);
    expect(runtime.errors).toEqual([]);
    expect(runtime.runtimeMs).toBe(5_400_000);

    const conflicting = parseCliArgs(['ingest', '--runtime', '20m', '--limit', '25']);
    expect(conflicting.errors).toContain('--limit and --runtime are mutually exclusive.');
  });
});
