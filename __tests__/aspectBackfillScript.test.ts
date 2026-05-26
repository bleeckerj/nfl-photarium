import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('legacy aspect backfill script', () => {
  it('delegates to the canonical image metadata backfill without duplicating Redis keys', () => {
    const script = readFileSync(join(repoRoot, 'scripts/backfill-aspect-ratios.mjs'), 'utf8');

    expect(script).toContain('backfill-image-metadata.ts');
    expect(script).not.toContain('image:meta:');
    expect(script).not.toContain('aspect_ratio');
    expect(script).not.toContain('redis.hset');
    expect(script).not.toContain('pipeline.hget');
  });
});
