import { afterEach, describe, expect, it, vi } from 'vitest';

const noopLogger = {
  trace() {},
  warn() {},
  info() {},
  error() {},
  success() {},
  debug() {},
  headline() {},
};

describe('instagram ingest script helpers', async () => {
  const script = await import('../scripts/instagram-ingest.mjs');
  const singleUrlExtract = await import('../scripts/instagram-ingest/single-url-extract.mjs');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses --ai-display-name for ingest', () => {
    const options = script.parseArgs([
      'ingest',
      '--username',
      'demo',
      '--push-cloudflare',
      '--ai-display-name',
    ]);

    expect(options.command).toBe('ingest');
    expect(options.pushCloudflare).toBe(true);
    expect(options.aiDisplayName).toBe(true);
  });

  it('fetches Instagram API paths with the browser session headers', async () => {
    const page = {
      evaluate: vi.fn(async (_fn, args) => {
        expect(args.apiPath).toBe('/api/v1/users/web_profile_info/?username=demo');
        expect(args.appId).toBeTruthy();
        return { status: 200, text: JSON.stringify({ data: { user: { id: '123' } } }) };
      }),
    };

    const result = await singleUrlExtract.igGet(
      page,
      '/api/v1/users/web_profile_info/?username=demo',
    );

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 200,
      json: { data: { user: { id: '123' } } },
      text: JSON.stringify({ data: { user: { id: '123' } } }),
    });
  });

  it('sends image bytes to the display-name suggest endpoint', async () => {
    let requestUrl = '';
    let filenameValue = '';
    let folderValue = '';
    let tagsValue = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requestUrl = String(input);
      const body = init?.body as FormData;
      filenameValue = String(body.get('filename'));
      folderValue = String(body.get('folder'));
      tagsValue = String(body.get('tags'));
      return new Response(JSON.stringify({ displayName: 'Ocean Cliffs', model: 'gpt-4.1-nano' }), {
        status: 200,
      });
    });

    const result = await script.suggestDisplayNameFromBuffer({
      apiBase: 'http://localhost:3000',
      imageBytes: Buffer.from('image-bytes'),
      imageMime: 'image/jpeg',
      filename: 'sample.jpg',
      folder: 'instagram',
      existingTags: ['instagram', 'demo'],
    });

    expect(requestUrl).toBe('http://localhost:3000/api/display-name/suggest');
    expect(filenameValue).toBe('sample.jpg');
    expect(folderValue).toBe('instagram');
    expect(tagsValue).toBe('instagram,demo');
    expect(result).toEqual({ displayName: 'Ocean Cliffs', model: 'gpt-4.1-nano' });
  });

  it('appends displayName to the external upload form only when provided', async () => {
    const bodyValues: Array<FormDataEntryValue | null> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = init?.body as FormData;
      bodyValues.push(body.get('displayName'));
      return new Response(JSON.stringify({ id: 'img-1', ok: true }), { status: 200 });
    });

    await script.pushImageToCloudflare({
      apiBase: 'http://localhost:3000',
      imageUrl: 'https://example.com/image.jpg',
      username: 'demo',
      uploadTags: ['instagram', 'demo'],
      shortcode: 'abc123',
      permalink: 'https://instagram.com/p/abc123/',
      sourcePageUrl: 'https://instagram.com/demo/',
      namespace: 'cf-default',
      log: noopLogger,
      displayName: 'Ocean Cliffs',
      fetchedImage: { bytes: Buffer.from('image-bytes'), contentType: 'image/jpeg' },
    });

    await script.pushImageToCloudflare({
      apiBase: 'http://localhost:3000',
      imageUrl: 'https://example.com/image.jpg',
      username: 'demo',
      uploadTags: ['instagram', 'demo'],
      shortcode: 'abc124',
      permalink: 'https://instagram.com/p/abc124/',
      sourcePageUrl: 'https://instagram.com/demo/',
      namespace: 'cf-default',
      log: noopLogger,
      fetchedImage: { bytes: Buffer.from('image-bytes'), contentType: 'image/jpeg' },
    });

    expect(bodyValues).toEqual(['Ocean Cliffs', null]);
  });

  it('continues uploading when AI display-name generation fails', async () => {
    const warn = vi.fn();
    let uploadDisplayName: FormDataEntryValue | null = 'unexpected';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://example.com/image.jpg') {
        return new Response('image-bytes', {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (url === 'http://localhost:3000/api/display-name/suggest') {
        return new Response(JSON.stringify({ error: 'AI unavailable' }), { status: 500 });
      }
      const body = init?.body as FormData;
      uploadDisplayName = body.get('displayName');
      return new Response(JSON.stringify({ id: 'img-1' }), { status: 200 });
    });

    const result = await script.ingestImageToCloudflare({
      apiBase: 'http://localhost:3000',
      imageUrl: 'https://example.com/image.jpg',
      username: 'demo',
      uploadTags: ['instagram', 'demo'],
      shortcode: 'abc125',
      permalink: 'https://instagram.com/p/abc125/',
      sourcePageUrl: 'https://instagram.com/demo/',
      namespace: 'cf-default',
      log: { ...noopLogger, warn },
      aiDisplayName: true,
    });

    expect(result.alreadyExists).toBe(false);
    expect(uploadDisplayName).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
