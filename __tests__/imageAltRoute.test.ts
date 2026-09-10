import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/images/[id]/alt/route';

const { patchImageExtrasRecordMock } = vi.hoisted(() => ({
  patchImageExtrasRecordMock: vi.fn(),
}));

vi.mock('@/server/imageExtras', () => ({
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

const imageId = 'img-alt';
const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/acct/images/v1/${imageId}`;
const imageResponse = (meta: Record<string, unknown> = {}) => Response.json({
  result: {
    id: imageId,
    filename: 'office.webp',
    variants: ['https://example.com/public'],
    meta,
  },
});
const completionResponse = (content: unknown) => Response.json({
  choices: [{ message: { content } }],
});
const generate = (id = imageId) => POST(
  new NextRequest(`http://localhost/api/images/${id}/alt`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);

describe('POST /api/images/:id/alt', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_ALT_MODEL', 'gpt-4.1-nano');
    patchImageExtrasRecordMock.mockReset().mockResolvedValue({ altText: 'saved' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('saves alt text in extras without PATCHing or pruning a full Cloudflare record', async () => {
    const meta = {
      namespace: 'office-hours',
      tags: ['office-hours', 'grainrad'],
      description: 'Existing description.'.repeat(41),
      altTag: 'Legacy alt text',
    };
    expect(Buffer.byteLength(JSON.stringify(meta))).toBeLessThan(1024);
    expect(Buffer.byteLength(JSON.stringify({ ...meta, altTag: 'A'.repeat(120) }))).toBeGreaterThan(1024);
    const originalMeta = structuredClone(meta);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(imageResponse(meta))
      .mockResolvedValueOnce(completionResponse(`  ${'A'.repeat(120)}  `));

    const response = await generate();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      altTag: 'A'.repeat(120),
      saved: true,
      droppedFields: [],
      metadataBytes: 0,
      metadataLimitBytes: 1024,
    });
    expect(patchImageExtrasRecordMock).toHaveBeenCalledTimes(1);
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(imageId, { altText: 'A'.repeat(120) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === cloudflareUrl)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(meta).toEqual(originalMeta);
  });

  it('joins text chunks and ignores non-text content', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(completionResponse([{ text: 'Two people' }, { text: 'at desks.' }, null, { text: 42 }]));

    const response = await generate();

    expect(response.status).toBe(200);
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(imageId, { altText: 'Two people at desks.' });
  });

  it('returns an error when extras persistence fails', async () => {
    patchImageExtrasRecordMock.mockRejectedValueOnce(new Error('extras unavailable'));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(completionResponse('Two people at desks.'));

    const response = await generate();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['', '   ', 'undefined', null, []])('rejects empty generated text: %j', async (content) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(completionResponse(content));

    const response = await generate();

    expect(response.status).toBe(422);
    expect(patchImageExtrasRecordMock).not.toHaveBeenCalled();
  });

  it('preserves Cloudflare fetch error status and message', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ errors: [{ message: 'Image not found' }] }, { status: 404 }),
    );

    const response = await generate();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Image not found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(patchImageExtrasRecordMock).not.toHaveBeenCalled();
  });

  it('preserves provider error status and message', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(Response.json({ error: { message: 'Rate limited' } }, { status: 429 }));

    const response = await generate();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Rate limited' });
    expect(patchImageExtrasRecordMock).not.toHaveBeenCalled();
  });

  it('validates image ID before generation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    expect((await generate('')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(patchImageExtrasRecordMock).not.toHaveBeenCalled();
  });
});
