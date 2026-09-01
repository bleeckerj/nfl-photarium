import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getPromptThisRecordMock, setPromptThisRecordMock } = vi.hoisted(() => ({
  getPromptThisRecordMock: vi.fn(),
  setPromptThisRecordMock: vi.fn(),
}));

vi.mock('@/server/promptThis', () => ({
  getPromptThisRecord: getPromptThisRecordMock,
  setPromptThisRecord: setPromptThisRecordMock,
}));

import { POST } from '@/app/api/images/[id]/prompt/route';

const ORIGINAL_ENV = { ...process.env };

function createRequest(body: Record<string, unknown>) {
  return new NextRequest(new Request('http://localhost/api/images/img-123/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function mockCloudflareImage() {
  return new Response(JSON.stringify({
    result: {
      id: 'img-123',
      filename: 'gallery-scene.png',
      variants: ['https://example.com/public'],
      meta: JSON.stringify({ folder: 'studio', tags: ['scene'] }),
    },
  }), { status: 200 });
}

function mockOpenAiPrompt(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200 });
}

describe('POST /api/images/:id/prompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getPromptThisRecordMock.mockResolvedValue(null);
    setPromptThisRecordMock.mockResolvedValue(undefined);
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_PROMPT_MODEL = 'prompt-model';
  });

  afterEach(() => vi.clearAllMocks());
  afterAll(() => { process.env = ORIGINAL_ENV; });

  it('generates High prompts with nuance and the larger output budget', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockCloudflareImage())
      .mockResolvedValueOnce(mockOpenAiPrompt('A highly detailed prompt.'));

    const response = await POST(createRequest({
      force: true,
      detailLevel: 'high',
      promptNuance: 'Emphasize the exact camera height and paper texture.',
    }), { params: Promise.resolve({ id: 'img-123' }) });
    const payload = await response.json();
    const openAiRequest = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);

    expect(response.status).toBe(200);
    expect(openAiRequest.max_tokens).toBe(4000);
    expect(openAiRequest.messages[1].content[0].text).toContain('exact camera height and paper texture');
    expect(payload.record).toMatchObject({
      detailLevel: 'high',
      promptNuance: 'Emphasize the exact camera height and paper texture.',
    });
    expect(setPromptThisRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      detailLevel: 'high',
      promptNuance: 'Emphasize the exact camera height and paper texture.',
    }));
  });

  it('regenerates when the requested level changes and clears High nuance in Standard', async () => {
    getPromptThisRecordMock.mockResolvedValue({
      imageId: 'img-123',
      prompt: 'Previous prompt',
      model: 'prompt-model',
      provider: 'openai',
      detailLevel: 'high',
      promptNuance: 'Previous nuance',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockCloudflareImage())
      .mockResolvedValueOnce(mockOpenAiPrompt('A standard prompt.'));

    const response = await POST(createRequest({ detailLevel: 'standard' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();
    const savedRecord = setPromptThisRecordMock.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(payload.generated).toBe(true);
    expect(savedRecord).toMatchObject({ detailLevel: 'standard' });
    expect(savedRecord).not.toHaveProperty('promptNuance');
  });

  it('rejects invalid detail levels before contacting Cloudflare or OpenAI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const response = await POST(createRequest({ detailLevel: 'extreme' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid detailLevel');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
