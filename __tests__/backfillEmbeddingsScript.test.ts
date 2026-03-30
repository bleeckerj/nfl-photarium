import { describe, expect, it } from 'vitest';

import {
  defaultCheckpointPath,
  liveStateSatisfiesRequest,
  parseArgs,
  resumeEntrySatisfiesRequest,
} from '../scripts/backfill-embeddings.mjs';

describe('backfill-embeddings script helpers', () => {
  it('derives a stable default checkpoint path from namespace and mode', () => {
    const options = parseArgs(['--namespace=cf-default', '--clip-only']);
    expect(defaultCheckpointPath(options)).toContain('embedding-backfill.cf-default.clip.missing.json');
  });

  it('defaults to all namespaces explicitly', () => {
    const options = parseArgs([]);
    expect(options.namespace).toBe('__all__');
    expect(defaultCheckpointPath(options)).toContain('embedding-backfill.all.clip-color.missing.json');
  });

  it('normalizes namespace flags and verbosity levels', () => {
    const options = parseArgs(['--namespace=__none__', '--throttle-ms=250', '-vvvvv']);
    expect(options.namespace).toBe('');
    expect(options.throttleMs).toBe(250);
    expect(options.verbose).toBe(5);
  });

  it('accepts a completed checkpoint entry for the matching request', () => {
    const options = parseArgs(['--color-only']);
    const entry = {
      status: 'success',
      force: false,
      requestedClip: false,
      requestedColor: true,
      clipReady: false,
      colorReady: true,
    };
    expect(resumeEntrySatisfiesRequest(entry, options)).toBe(true);
  });

  it('rejects a completed checkpoint entry when force mode differs', () => {
    const options = parseArgs(['--force']);
    const entry = {
      status: 'success',
      force: false,
      requestedClip: true,
      requestedColor: true,
      clipReady: true,
      colorReady: true,
    };
    expect(resumeEntrySatisfiesRequest(entry, options)).toBe(false);
  });

  it('checks current live embedding state against the requested mode', () => {
    const bothMode = parseArgs([]);
    const colorMode = parseArgs(['--color-only']);

    expect(liveStateSatisfiesRequest({ hasClipEmbedding: true, hasColorEmbedding: true }, bothMode)).toBe(true);
    expect(liveStateSatisfiesRequest({ hasClipEmbedding: true, hasColorEmbedding: false }, bothMode)).toBe(false);
    expect(liveStateSatisfiesRequest({ hasClipEmbedding: false, hasColorEmbedding: true }, colorMode)).toBe(true);
  });
});
