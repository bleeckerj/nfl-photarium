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
    expect(options.namespace).toBe('ingest');
  });

  it('enables Cloudflare pushes by default for profile ingest', () => {
    const options = script.parseArgs(['ingest', '--username', 'demo']);

    expect(options.pushCloudflare).toBe(true);
  });

  it('allows profile ingest to opt out of Cloudflare pushes', () => {
    const options = script.parseArgs(['ingest', '--username', 'demo', '--no-push-cloudflare']);

    expect(options.pushCloudflare).toBe(false);
  });

  it('normalizes profile-ish usernames before deriving ingest paths', () => {
    const options = script.parseArgs([
      'ingest',
      '--username',
      'palisades_collective/',
    ]);

    expect(options.username).toBe('palisades_collective');
    expect(options.outputPath).toMatch(/data\/instagram\/palisades_collective\.ndjson$/);
    expect(options.checkpointPath).toMatch(/data\/instagram\/palisades_collective\.checkpoint\.json$/);
  });

  it('uses cf-instagram as the single-url upload namespace by default', () => {
    const options = script.parseArgs([
      'single-url',
      '--url',
      'https://www.instagram.com/p/abc123/',
    ]);

    expect(options.namespace).toBe('cf-instagram');
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

  it('appends upload metadata to the external upload form', async () => {
    const bodyValues: Array<FormDataEntryValue | null> = [];
    const namespaceValues: Array<FormDataEntryValue | null> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = init?.body as FormData;
      bodyValues.push(body.get('displayName'));
      namespaceValues.push(body.get('namespace'));
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
      namespace: 'ingest',
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
      namespace: ' ingest ',
      log: noopLogger,
      fetchedImage: { bytes: Buffer.from('image-bytes'), contentType: 'image/jpeg' },
    });

    expect(bodyValues).toEqual(['Ocean Cliffs', null]);
    expect(namespaceValues).toEqual(['ingest', 'ingest']);
  });

  it('sends Instagram captions and source metrics with image uploads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'img-instagram-1' }), { status: 200 }),
    );

    await script.pushImageToCloudflare({
      apiBase: 'http://localhost:3000',
      imageUrl: 'https://example.com/image.jpg',
      username: 'an_improbable_future',
      uploadTags: ['instagram', 'an_improbable_future'],
      shortcode: 'abc126',
      permalink: 'https://www.instagram.com/p/abc126/',
      sourcePageUrl: 'https://www.instagram.com/p/abc126/',
      description: 'A post caption',
      instagramSource: {
        username: 'an_improbable_future',
        shortcode: 'abc126',
        likeCount: 42,
        commentCount: 7,
        viewCount: 900,
      },
      namespace: 'cf-instagram',
      log: noopLogger,
      fetchedImage: { bytes: Buffer.from('image-bytes'), contentType: 'image/jpeg' },
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const uploadBody = init?.body as FormData;
    expect(uploadBody.get('description')).toBe('A post caption');
    expect(JSON.parse(String(uploadBody.get('instagramSource')))).toMatchObject({
      likeCount: 42,
      commentCount: 7,
      viewCount: 900,
    });
  });

  it('enriches an existing duplicate image with Instagram metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ duplicates: [{ id: 'existing-img-1' }] }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ imageId: 'existing-img-1' }), { status: 200 }));

    const result = await script.pushImageToCloudflare({
      apiBase: 'http://localhost:3000',
      imageUrl: 'https://example.com/image.jpg',
      username: 'demo',
      uploadTags: ['instagram', 'demo'],
      shortcode: 'abc127',
      permalink: 'https://www.instagram.com/p/abc127/',
      sourcePageUrl: 'https://www.instagram.com/p/abc127/',
      description: 'Backfilled caption',
      instagramSource: { likeCount: 3, commentCount: 1 },
      namespace: 'cf-instagram',
      log: noopLogger,
      fetchedImage: { bytes: Buffer.from('image-bytes'), contentType: 'image/jpeg' },
    });

    expect(result).toMatchObject({ alreadyExists: true, duplicateIds: ['existing-img-1'] });
    const [, init] = fetchMock.mock.calls[1];
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'http://localhost:3000/api/images/existing-img-1/extras',
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      description: 'Backfilled caption',
      instagramSource: { likeCount: 3, commentCount: 1 },
    });
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

  it('prefers full Instagram photo URLs over cropped og:image candidates', () => {
    const cropped =
      'https://scontent-lax3-2.cdninstagram.com/v/t51.82787-15/730226633_18413347660194929_2999636219339230040_n.jpg?stp=c287.0.864.863a_dst-jpg_e35_s640x640_tt6&_nc_cat=103&efg=eyJlZmdfdGFnIjoiRkVFRC5iZXN0X2ltYWdlX3VybGdlbi5DMyJ9';
    const full =
      'https://scontent-lax3-2.cdninstagram.com/v/t51.82787-15/730226633_18413347660194929_2999636219339230040_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=103&ig_cache_key=MzkyNjU4OTk3Mzg2MTMwMDQ0Nw%3D%3D.3-ccb7-5&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTQzOS5zZHIucmVndWxhcl9waG90by5DMyJ9';
    const unrelated =
      'https://scontent-lax3-2.cdninstagram.com/v/t51.82787-15/602832905_18384595480194929_6650267950416299315_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=107&ig_cache_key=Mzc5MTExOTY3OTE4OTMwMzMxMQ%3D%3D.3-ccb7-5&efg=eyJ2ZW5jb2RlX3RhZyI6IkNBUk9VU0VMX0lURU0ueHBpZHMuMTQ0MC5zZHIucmVndWxhcl9waG90by5DMyJ9';

    expect(singleUrlExtract.rankInstagramImageUrls([cropped, full])[0]).toBe(full);
    expect(singleUrlExtract.selectInstagramImageUrls([cropped, full, unrelated], { mediaType: 1 })).toEqual([full]);
    expect(singleUrlExtract.selectInstagramImageUrls([cropped, full, unrelated], { mediaType: 8 })).toHaveLength(3);
  });

  it('infers single-url post owners from Instagram metadata without using the auth account', () => {
    const fromProfileUrl = singleUrlExtract.inferInstagramOwnerUsername({
      profileUrl: 'https://www.instagram.com/shopatmatter/p/DZ-DMb6nPjf/',
    });
    const fromHandle = singleUrlExtract.inferInstagramOwnerUsername({
      twitterTitle: 'The Shop At MATTER (@shopatmatter) • Instagram photo',
    });
    const fromByline = singleUrlExtract.inferInstagramOwnerUsername({
      description: '17 likes, 0 comments - shopatmatter on June 24, 2026: "Caption."',
    });

    expect(fromProfileUrl).toEqual({ username: 'shopatmatter', source: 'profile_url' });
    expect(fromHandle).toEqual({ username: 'shopatmatter', source: 'meta_handle' });
    expect(fromByline).toEqual({ username: 'shopatmatter', source: 'meta_byline' });
  });
});
