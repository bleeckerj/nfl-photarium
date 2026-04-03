import { describe, expect, it } from 'vitest';
import { createSessionToken, parseSessionToken } from '../src/worker/access/token';

describe('session token helpers', () => {
  it('round-trips a signed session payload', async () => {
    const token = await createSessionToken(
      {
        projectId: 'project-1',
        publicSlug: 'slug-1',
        revisionId: 'revision-1',
        expiresAtEpochSeconds: 2_000_000_000,
      },
      'secret'
    );

    const parsed = await parseSessionToken(token, 'secret');
    expect(parsed?.projectId).toBe('project-1');
    expect(parsed?.publicSlug).toBe('slug-1');
  });
});
