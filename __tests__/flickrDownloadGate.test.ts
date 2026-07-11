import { describe, expect, it, vi } from 'vitest';

describe('Flickr shared download gate', async () => {
  const { createSharedDownloadGate } = await import('../scripts/flickr-ingest/util.mjs');

  it('uses an escalating shared cooldown when Retry-After is absent', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const gate = createSharedDownloadGate({
      defaultRateLimitCooldownMs: 60_000,
      maxRateLimitCooldownMs: 180_000,
    });

    expect(gate.reportRateLimit()).toEqual({
      cooldownMs: 60_000,
      blockedUntil: 61_000,
      consecutiveRateLimits: 1,
    });
    expect(gate.reportRateLimit()).toEqual({
      cooldownMs: 120_000,
      blockedUntil: 121_000,
      consecutiveRateLimits: 2,
    });
    expect(gate.reportRateLimit()).toEqual({
      cooldownMs: 180_000,
      blockedUntil: 181_000,
      consecutiveRateLimits: 3,
    });
    vi.restoreAllMocks();
  });

  it('honors Retry-After and resets escalation after success', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const gate = createSharedDownloadGate();

    expect(gate.reportRateLimit(90_000).cooldownMs).toBe(90_000);
    gate.reportSuccess();
    expect(gate.reportRateLimit().consecutiveRateLimits).toBe(1);
    vi.restoreAllMocks();
  });
});
