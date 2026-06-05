import { describe, expect, it, vi } from 'vitest';

const { getGrainradManagedStatusMock } = vi.hoisted(() => ({
  getGrainradManagedStatusMock: vi.fn(),
}));

vi.mock('@/server/image-tools/grainradManagedRuntime', () => ({
  getGrainradManagedStatus: getGrainradManagedStatusMock,
}));

import { GET } from '@/app/api/image-tools/grainrad/status/route';

describe('GET /api/image-tools/grainrad/status', () => {
  it.each([
    ['external', false],
    ['managed-ready', true],
    ['managed-starting', true],
    ['managed-failed', true],
    ['disabled', false],
  ] as const)('returns %s Grainrad status', async (mode, managedEnabled) => {
    getGrainradManagedStatusMock.mockResolvedValueOnce({
      mode,
      managedEnabled,
      message: `${mode} status`,
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toEqual({
      mode,
      managedEnabled,
      message: `${mode} status`,
    });
  });
});
