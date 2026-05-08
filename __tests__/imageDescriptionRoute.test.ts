import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/images/[id]/description/route';

const {
  getImageExtrasRecordMock,
  patchImageExtrasRecordMock,
} = vi.hoisted(() => ({
  getImageExtrasRecordMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    imageId: 'img-123',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  }),
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: getImageExtrasRecordMock,
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

const ORIGINAL_ENV = { ...process.env };

function createRequest(body?: Record<string, unknown>) {
  const init: RequestInit = {
    method: 'POST',
  };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const base = new Request('http://localhost/api/images/img-123/description', init);
  return new NextRequest(base);
}

const mockImageResponse = (meta: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      result: {
        id: 'img-123',
        filename: 'gallery-scene.png',
        variants: ['https://example.com/public'],
        meta: JSON.stringify(meta),
      },
    }),
    { status: 200 }
  );

const mockDescriptionResponse = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    { status: 200 }
  );

describe('POST /api/images/:id/description', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getImageExtrasRecordMock.mockResolvedValue(null);
    patchImageExtrasRecordMock.mockResolvedValue({
      schemaVersion: 1,
      imageId: 'img-123',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    });
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_DESCRIPTION_MODEL = 'gpt-4.1-mini';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('persists the generated description appended to the client working copy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse({ folder: 'editorial' }))
      .mockResolvedValueOnce(mockDescriptionResponse('Generated scene description.'));

    const response = await POST(createRequest({ existingDescription: 'Existing text.' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      description: 'Generated scene description.',
      persistedDescription: 'Existing text.\n\nGenerated scene description.',
      saved: true,
    });
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith('img-123', {
      description: 'Existing text.\n\nGenerated scene description.',
    });
  });

  it('uses extras-backed stored description when no client working copy is provided', async () => {
    getImageExtrasRecordMock.mockResolvedValue({
      schemaVersion: 1,
      imageId: 'img-123',
      description: 'Extras text.',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse({ description: 'Cloudflare fallback.' }))
      .mockResolvedValueOnce(mockDescriptionResponse('Generated scene description.'));

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.persistedDescription).toBe('Extras text.\n\nGenerated scene description.');
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith('img-123', {
      description: 'Extras text.\n\nGenerated scene description.',
    });
  });

  it('does not reuse a stored description when the client sends an intentionally empty working copy', async () => {
    getImageExtrasRecordMock.mockResolvedValue({
      schemaVersion: 1,
      imageId: 'img-123',
      description: 'Inherited parent description.',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse({ description: 'Cloudflare fallback.' }))
      .mockResolvedValueOnce(mockDescriptionResponse('Fresh visual description.'));

    const response = await POST(createRequest({ existingDescription: '' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();
    const openAiRequest = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    const promptText = openAiRequest.messages[1].content[0].text;

    expect(response.status).toBe(200);
    expect(promptText).not.toContain('Inherited parent description.');
    expect(promptText).not.toContain('Cloudflare fallback.');
    expect(payload.persistedDescription).toBe('Fresh visual description.');
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith('img-123', {
      description: 'Fresh visual description.',
    });
  });

  it('does not report success when the generated description cannot be saved', async () => {
    patchImageExtrasRecordMock.mockRejectedValue(new Error('extras unavailable'));
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse())
      .mockResolvedValueOnce(mockDescriptionResponse('Generated scene description.'));

    const response = await POST(createRequest({ existingDescription: '' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Internal server error');
  });
});
