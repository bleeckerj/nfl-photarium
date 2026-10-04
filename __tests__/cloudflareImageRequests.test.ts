import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudflareImageRateLimitError, createCloudflareImageRequester } from '@/server/cloudflareImageRequests';

const url = 'https://api.cloudflare.com/client/v4/accounts/account/images/v1/image';
const limited = (retryAfter?: string) => new Response(JSON.stringify({ errors: [{ message: 'Please wait and consider throttling your request speed' }] }), {
  status: 429,
  headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
});

describe('Cloudflare image metadata requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T20:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('paces concurrent reads and writes through the same queue', async () => {
    const starts: number[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      starts.push(Date.now());
      return new Response('{}');
    });
    const request = createCloudflareImageRequester();
    const operations = Promise.all([request(url), request(url, { method: 'PATCH', body: '{"metadata":{"namespace":"target"}}' }), request(url)]);
    await vi.runAllTimersAsync();
    await operations;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(starts.slice(1).map((time, index) => time - starts[index])).toEqual([300, 300]);
  });

  it('honors Retry-After and pauses other concurrent requests', async () => {
    const starts: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? limited('2') : new Response('{}');
    });
    const request = createCloudflareImageRequester();
    const operations = Promise.all([request(url), request(`${url}-other`)]);
    await vi.runAllTimersAsync();
    await operations;
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBe(2000);
    expect(starts[2] - starts[1]).toBe(300);
  });

  it('honors an HTTP date in Retry-After', async () => {
    const start = Date.now();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(limited(new Date(start + 5000).toUTCString()))
      .mockResolvedValueOnce(new Response('{}'));
    const request = createCloudflareImageRequester();
    const operation = request(url);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await operation;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a throttled write with exactly the same metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(limited('1'))
      .mockResolvedValueOnce(new Response('{}'));
    const init = { method: 'PATCH', body: '{"metadata":{"namespace":"target"}}' };
    const operation = createCloudflareImageRequester()(url, init);
    await vi.runAllTimersAsync();
    await operation;
    expect(fetchMock.mock.calls).toEqual([[url, init], [url, init]]);
  });

  it.each([undefined, 'invalid', '-1'])('bounds retries and preserves fallback cooldowns with Retry-After=%s', async retryAfter => {
    const starts: number[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      starts.push(Date.now());
      return starts.length <= 3 ? limited(retryAfter) : new Response('{}');
    });
    const request = createCloudflareImageRequester();
    const outcome = request(url).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(CloudflareImageRateLimitError);
    expect(error).toMatchObject({ retryAfterSeconds: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(starts.slice(1).map((time, index) => time - starts[index])).toEqual([30_000, 60_000]);
    const later = request(url);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await later;
    expect(starts[3] - starts[2]).toBe(120_000);
  });

  it('does not retry authorization failures or ambiguous network errors', async () => {
    const forbidden = new Response('{}', { status: 403 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(forbidden);
    await expect(createCloudflareImageRequester()(url)).resolves.toBe(forbidden);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(createCloudflareImageRequester()(url, { method: 'PATCH' })).rejects.toThrow('Connection lost');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
