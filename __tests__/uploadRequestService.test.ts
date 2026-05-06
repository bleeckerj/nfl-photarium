import { describe, expect, it, vi } from 'vitest';
import { parseUploadResponsePayload, uploadFormDataWithRetry } from '@/services/uploadRequestService';

describe('uploadRequestService', () => {
  it('retries rejected upload fetches before returning a successful response', async () => {
    const formData = new FormData();
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'img-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const result = await uploadFormDataWithRetry('/api/upload', formData, {
      fetchImpl: fetchMock,
      delay: async () => undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response.ok).toBe(true);
    expect(result.result).toEqual({ id: 'img-1' });
  });

  it('does not retry non-retryable HTTP failures and preserves a useful error payload', async () => {
    const formData = new FormData();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('<html>payload too large</html>', {
        status: 413,
        statusText: 'Payload Too Large',
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const result = await uploadFormDataWithRetry('/api/upload', formData, {
      fetchImpl: fetchMock,
      delay: async () => undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(413);
    expect(result.result).toEqual({ error: 'Upload failed (413 Payload Too Large)' });
  });

  it('retries retryable HTTP upload failures', async () => {
    const formData = new FormData();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'img-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const result = await uploadFormDataWithRetry('/api/upload', formData, {
      fetchImpl: fetchMock,
      delay: async () => undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.result).toEqual({ id: 'img-2' });
  });

  it('parses non-JSON upload responses into fallback errors', async () => {
    const payload = await parseUploadResponsePayload(
      new Response('request body exceeded limit', {
        status: 413,
        statusText: 'Payload Too Large',
      })
    );

    expect(payload).toEqual({ error: 'request body exceeded limit' });
  });
});
