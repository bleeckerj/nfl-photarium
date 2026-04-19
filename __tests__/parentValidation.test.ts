import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCachedImagesMock } = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

import { validateParentForNewChild } from '@/server/parentValidation';

describe('validateParentForNewChild', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getCachedImagesMock.mockReset();
  });

  it('allows uploads without a parent id', async () => {
    const result = await validateParentForNewChild(undefined);

    expect(result).toEqual({ ok: true });
    expect(getCachedImagesMock).not.toHaveBeenCalled();
  });

  it('keeps canonical parent ids unchanged', async () => {
    getCachedImagesMock.mockResolvedValue([{ id: 'parent', namespace: 'ns-parent' }]);

    const result = await validateParentForNewChild('parent');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalParentId).toBe('parent');
      expect(result.canonicalParentNamespace).toBe('ns-parent');
      expect(result.redirectedFromParentId).toBeUndefined();
    }
  });

  it('redirects variant parent ids to the canonical parent id and logs the redirect', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    getCachedImagesMock.mockResolvedValue([
      { id: 'canonical', namespace: 'ns-canonical' },
      { id: 'variant', parentId: 'canonical' },
    ]);

    const result = await validateParentForNewChild('variant');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalParentId).toBe('canonical');
      expect(result.canonicalParentNamespace).toBe('ns-canonical');
      expect(result.redirectedFromParentId).toBe('variant');
    }
    expect(infoSpy).toHaveBeenCalledWith(
      '[parentValidation] Redirecting variant parent to canonical parent',
      expect.objectContaining({
        requestedParentId: 'variant',
        canonicalParentId: 'canonical',
      })
    );
  });

  it('returns a clear manual-verification error when canonical parent resolution fails', async () => {
    getCachedImagesMock
      .mockResolvedValueOnce([{ id: 'variant', parentId: 'missing-canonical' }])
      .mockResolvedValueOnce([{ id: 'variant', parentId: 'missing-canonical' }]);

    const result = await validateParentForNewChild('variant');

    expect(getCachedImagesMock).toHaveBeenNthCalledWith(1, false);
    expect(getCachedImagesMock).toHaveBeenNthCalledWith(2, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/verify the image hierarchy manually/i);
    }
  });

  it('returns a clear error when parent relationships are cyclical', async () => {
    getCachedImagesMock.mockResolvedValue([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);

    const result = await validateParentForNewChild('a');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/cyclical parent relationship/i);
    }
  });
});
