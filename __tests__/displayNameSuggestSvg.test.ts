/**
 * Regression cover for the reported SVG failure.
 *
 * The uploader's pre-upload "AI naming" pass sent SVG straight to OpenAI vision,
 * which only decodes png/jpeg/gif/webp. OpenAI's rejection was forwarded verbatim
 * into the import queue and read as though the upload itself had failed.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/display-name/suggest/route';

const TEST_URL = 'http://localhost/api/display-name/suggest';
const ORIGINAL_ENV = { ...process.env };

const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="633" height="47" viewBox="0 0 633 47">' +
    '<rect width="633" height="47" fill="#FF2D55"/></svg>',
  'utf8'
);

const createRequest = (formData: FormData) =>
  new NextRequest(new Request(TEST_URL, { method: 'POST', body: formData }));

const okOpenAiResponse = () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: 'crimson wordmark banner' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

/** Pull the image_url actually sent to OpenAI out of a recorded fetch call. */
const imageUrlFromCall = (call: unknown[]): string => {
  const init = call[1] as RequestInit;
  const body = JSON.parse(String(init.body));
  const parts = body.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
  const image = parts.find((part) => part.type === 'image_url');
  if (!image?.image_url?.url) throw new Error('no image_url in OpenAI payload');
  return image.image_url.url;
};

describe('POST /api/display-name/suggest with SVG input', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV, OPENAI_API_KEY: 'test-key' };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rasterizes an uploaded SVG instead of sending image/svg+xml', async () => {
    const fetchMock = vi.fn(async () => okOpenAiResponse());
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(SVG_BYTES)], { type: 'image/svg+xml' }),
      'SELA.svg'
    );
    formData.append('filename', 'SELA.svg');

    const response = await POST(createRequest(formData));
    expect(response.status).toBe(200);

    const sent = imageUrlFromCall(fetchMock.mock.calls[0]);
    expect(sent.startsWith('data:image/webp;base64,')).toBe(true);
    expect(sent).not.toContain('svg+xml');
  });

  it('fetches and rasterizes a remote .svg rather than forwarding the URL', async () => {
    const remoteUrl = 'https://cdn.example.com/assets/SELA.svg';
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === remoteUrl) {
        return new Response(new Uint8Array(SVG_BYTES), {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      return okOpenAiResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append('remoteUrl', remoteUrl);
    formData.append('filename', 'SELA.svg');

    const response = await POST(createRequest(formData));
    expect(response.status).toBe(200);

    const openAiCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('openai')
    );
    expect(openAiCall).toBeDefined();
    const sent = imageUrlFromCall(openAiCall as unknown[]);
    expect(sent.startsWith('data:image/webp;base64,')).toBe(true);
    expect(sent).not.toBe(remoteUrl);
  });

  it('still forwards remote raster URLs untouched', async () => {
    const remoteUrl = 'https://cdn.example.com/assets/photo.jpg';
    const fetchMock = vi.fn(async () => okOpenAiResponse());
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append('remoteUrl', remoteUrl);

    const response = await POST(createRequest(formData));
    expect(response.status).toBe(200);
    expect(imageUrlFromCall(fetchMock.mock.calls[0])).toBe(remoteUrl);
  });

  it('reports a clear error for an unparseable SVG instead of calling OpenAI', async () => {
    const fetchMock = vi.fn(async () => okOpenAiResponse());
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new TextEncoder().encode('this is not an svg')], { type: 'image/svg+xml' }),
      'broken.svg'
    );

    const response = await POST(createRequest(formData));
    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error).toContain('SVG');
  });
});
