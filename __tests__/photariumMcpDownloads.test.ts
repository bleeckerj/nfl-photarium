import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { downloadImageById, downloadOriginalImageById } from '../mcp-server/src/runtime/discovery/downloads';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), {
  headers: {
    'content-type': 'image/png',
    'content-disposition': 'attachment; filename="source.png"',
    'x-photarium-variant-served': 'original',
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MCP source image downloads', () => {
  it('recovers a temporary failure without switching to a delivery variant', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Cloudflare unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadOriginalImageById('source')).resolves.toMatchObject({
      base64: 'AQID', filename: 'source.png', contentType: 'image/png', variantUsed: 'original', fallbackUsed: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/source/download?variant=original'))).toBe(true);
    expect(delay).toHaveBeenCalledWith(250);
  });

  it.each([408, 429, 500, 502, 504])('retries a temporary HTTP %i response', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadImageById('source', 'original')).resolves.toMatchObject({ base64: 'AQID' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadImageById('source', 'original')).resolves.toMatchObject({ base64: 'AQID' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a response body interrupted after headers arrive', async () => {
    const interrupted = imageResponse();
    vi.spyOn(interrupted, 'arrayBuffer').mockRejectedValue(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }));
    const fetchMock = vi.fn().mockResolvedValueOnce(interrupted).mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadImageById('source', 'original')).resolves.toMatchObject({ base64: 'AQID' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404])('does not retry permanent HTTP %i errors', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadImageById('source', 'original')).rejects.toThrow(`API error (${status})`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not retry cancelled requests', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadImageById('source')).rejects.toThrow('Cancelled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds retries and retains both original and fallback errors', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => Response.json({
      error: url.includes('variant=original') ? 'Original unavailable' : 'Fallback unavailable',
    }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadOriginalImageById('source')).rejects.toThrow(
      'Source image source download failed. Original: API error (503): {"error":"Original unavailable"}. Fallback: API error (503): {"error":"Fallback unavailable"}',
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(vi.mocked(delay).mock.calls.map(([ms]) => ms)).toEqual([250, 750, 250, 750]);
  });

  it('preserves the existing fallback contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Original forbidden', { status: 403 }))
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadOriginalImageById('source')).resolves.toMatchObject({
      fallbackUsed: true, variantUsed: 'default', fallbackReason: 'API error (403): Original forbidden',
    });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/source\/download$/);
    expect(delay).not.toHaveBeenCalled();
  });

  it('keeps the discovery client exports available', async () => {
    const client = await import('../mcp-server/src/runtime/discovery/client');
    expect(client.downloadImageById).toBe(downloadImageById);
    expect(client.downloadOriginalImageById).toBe(downloadOriginalImageById);
  });
});
