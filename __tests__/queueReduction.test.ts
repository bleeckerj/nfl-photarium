import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildQueueReductionUpdate,
  importRemoteQueueImage,
} from '@/components/image-uploader/queueReduction';
import type { UploaderQueueItem } from '@/features/page-import/types';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('queue reduction helpers', () => {
  it('imports a remote image through the existing import proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: btoa('image-bytes'),
          type: 'image/webp',
          name: 'reduced.webp',
          originalUrl: 'https://cdn.example.com/source.gif',
          note: 'Adjusted for byte limit: converted to WebP',
        }),
        { status: 200 }
      )
    );
    global.fetch = fetchMock;

    const imported = await importRemoteQueueImage('https://cdn.example.com/source.gif');

    expect(fetchMock).toHaveBeenCalledWith('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://cdn.example.com/source.gif' }),
    });
    expect(imported.file.name).toBe('reduced.webp');
    expect(imported.file.type).toBe('image/webp');
    expect(imported.originalUrl).toBe('https://cdn.example.com/source.gif');
    expect(imported.processingNote).toBe('Adjusted for byte limit: converted to WebP');
  });

  it('surfaces import proxy errors for the queue note path', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Source blocked automated downloads' }), { status: 400 })
    );

    await expect(importRemoteQueueImage('https://cdn.example.com/source.gif')).rejects.toThrow(
      'Source blocked automated downloads'
    );
  });

  it('builds a queue update that replaces remote metadata with the reduced local file', () => {
    const target: UploaderQueueItem = {
      id: 'queue-1',
      assetType: 'image',
      filename: 'source.gif',
      remoteUrl: 'https://cdn.example.com/source.gif',
      metadata: {
        status: 'resolved',
        fileSizeBytes: 18 * 1024 * 1024,
        contentType: 'image/gif',
        dimensions: { width: 600, height: 338 },
      },
    };
    const nextFile = new File(['reduced'], 'source.webp', { type: 'image/webp' });

    const update = buildQueueReductionUpdate({
      target,
      nextFile,
      nextPreviewUrl: 'blob:preview',
      processingNote: 'Adjusted for byte limit: converted to WebP',
      dimensions: { width: 480, height: 270 },
      originalUrl: 'https://cdn.example.com/source.gif',
    });

    expect(update.file).toBe(nextFile);
    expect(update.filename).toBe('source.webp');
    expect(update.previewUrl).toBe('blob:preview');
    expect(update.originalUrl).toBe('https://cdn.example.com/source.gif');
    expect(update.processingNote).toBe('Adjusted for byte limit: converted to WebP');
    expect(update.metadata).toEqual({
      status: 'resolved',
      fileSizeBytes: nextFile.size,
      contentType: 'image/webp',
      dimensions: { width: 480, height: 270 },
    });
  });
});
