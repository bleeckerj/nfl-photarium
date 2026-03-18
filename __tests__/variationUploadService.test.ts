import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadVariationFile, uploadVariationUrl } from '@/services/variationUploadService';

describe('variationUploadService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes image file uploads to the image upload endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 'img-1', url: 'https://cdn.example.com/img-1' }] }), { status: 200 })
    );

    const result = await uploadVariationFile({
      file: new File(['image'], 'photo.png', { type: 'image/png' }),
      namespace: 'ns-a',
      parentId: 'parent-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(result.ok).toBe(true);
    expect(result.payload.results).toEqual([{ id: 'img-1', url: 'https://cdn.example.com/img-1' }]);
  });

  it('routes video file uploads to the video upload endpoint and normalizes the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'vid-1', playbackUrl: 'https://videodelivery.net/stream-1/iframe' }), { status: 200 })
    );

    const result = await uploadVariationFile({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      namespace: 'ns-a',
      parentId: 'parent-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/page/upload-video',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(result.ok).toBe(true);
    expect(result.payload.results).toEqual([
      { id: 'vid-1', url: 'https://videodelivery.net/stream-1/iframe' }
    ]);
  });

  it('keeps archive uploads on the image upload endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 'zip-1', url: 'https://cdn.example.com/zip-1' }] }), { status: 200 })
    );

    await uploadVariationFile({
      file: new File(['zip'], 'batch.zip', { type: 'application/zip' }),
      namespace: 'ns-a',
      parentId: 'parent-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
  });

  it('routes image variation URLs to the image import endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 'img-2', url: 'https://cdn.example.com/img-2' }] }), { status: 200 })
    );

    const result = await uploadVariationUrl({
      url: 'https://cdn.example.com/photo.png',
      namespace: 'ns-a',
      parentId: 'parent-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/page/upload',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    );
    expect(result.ok).toBe(true);
    expect(result.payload.results).toEqual([{ id: 'img-2', url: 'https://cdn.example.com/img-2' }]);
  });

  it('routes video variation URLs to the video import endpoint and normalizes the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'vid-2', playbackUrl: 'https://videodelivery.net/stream-2/iframe' }), { status: 200 })
    );

    const result = await uploadVariationUrl({
      url: 'https://cdn.example.com/clip.webm',
      namespace: 'ns-a',
      parentId: 'parent-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/page/upload-video',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    );
    expect(result.ok).toBe(true);
    expect(result.payload.results).toEqual([
      { id: 'vid-2', url: 'https://videodelivery.net/stream-2/iframe' }
    ]);
  });
});
