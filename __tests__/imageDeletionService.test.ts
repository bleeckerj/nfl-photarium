import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildImageDeleteUrl,
  deleteImage,
  startDeleteFamilyJob,
} from '@/services/imageDeletionService';

describe('imageDeletionService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds encoded single-image delete URLs', () => {
    expect(buildImageDeleteUrl('img 1/2')).toBe('/api/images/img%201%2F2');
  });

  it('deletes images through the encoded endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await expect(deleteImage('img 1/2')).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/images/img%201%2F2', { method: 'DELETE' });
  });

  it('surfaces server delete errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Cannot delete parent' }), { status: 502 })
    );

    await expect(deleteImage('parent-1')).rejects.toThrow('Cannot delete parent');
  });

  it('starts delete-family jobs through the encoded endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 })
    );

    await expect(startDeleteFamilyJob('img 1/2')).resolves.toBe('job-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/images/img%201%2F2/delete-family',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE_FAMILY', async: true }),
      }
    );
  });
});
