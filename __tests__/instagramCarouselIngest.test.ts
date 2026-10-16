import { describe, expect, it, vi } from 'vitest';
import { instagramMediaIdFromShortcode, fetchSingleUrlRecordFromApiByShortcode } from '../scripts/instagram-ingest/media-api.mjs';
import { findInstagramMediaRecord } from '../scripts/instagram-ingest/page-media.mjs';
import { mapItemToRecord } from '../scripts/instagram-ingest/records.mjs';
import { extractSingleUrlRecord, selectInstagramImageUrls } from '../scripts/instagram-ingest/single-url-extract.mjs';
import {
  assertSingleUrlMediaComplete, assertSingleUrlUploadsComplete, mergeSingleUrlMediaRecord,
} from '../scripts/instagram-ingest/single-url-record.mjs';

const image = (name: string) => `https://scontent.cdninstagram.com/${name}.jpg`;
const child = (name: string) => ({
  media_type: 1,
  image_versions2: { candidates: [
    { url: image(`${name}-small`), width: 320, height: 400 },
    { url: image(name), width: 1080, height: 1350 },
  ] },
});
const carousel = {
  code: 'BAAAAAAAAAA', media_type: 8, carousel_media_count: 2,
  user: { username: 'source_owner', pk: '123' },
  image_versions2: { candidates: [{ url: image('cover'), width: 1080, height: 1350 }] },
  carousel_media: [child('slide-1'), child('slide-2')],
};

describe('Instagram carousel ingestion', () => {
  it('decodes numeric media IDs without floating-point precision loss', () => {
    expect(instagramMediaIdFromShortcode('BAAAAAAAAAA')).toBe('1152921504606846976');
    expect(instagramMediaIdFromShortcode('B-')).toBe('126');
    expect(instagramMediaIdFromShortcode('../bad')).toBeNull();
  });

  it('uses the numeric media ID for the authenticated media-info request', async () => {
    const page = { evaluate: vi.fn(async (_fn, args) => {
      expect(args.apiPath).toBe('/api/v1/media/1152921504606846976/info/');
      return { status: 200, text: JSON.stringify({ items: [carousel] }) };
    }) };
    const record = await fetchSingleUrlRecordFromApiByShortcode(page, carousel.code, '', null, {
      debug: vi.fn(), warn: vi.fn(),
    });
    expect(record?.imageUrls).toEqual([image('slide-1'), image('slide-2')]);
    expect(record?.username).toBe('source_owner');
  });

  it('finds deeply nested post data and excludes avatars and other posts', () => {
    const payload = { require: [['ScheduledServerJS', { __bbox: { result: { data: {
      unrelated: { ...carousel, code: 'OTHER' },
      viewer: { profile_pic_url: image('avatar') },
      xdt_api__v1__media__shortcode__web_info: { items: [carousel] },
    } } } }]] };
    const record = findInstagramMediaRecord(payload, carousel.code, 'fallback');
    expect(record?.imageUrls).toEqual([image('slide-1'), image('slide-2')]);
    expect(record?.carouselMediaCount).toBe(2);
    expect(record?.extractedMediaCount).toBe(2);
    expect(findInstagramMediaRecord(payload, 'MISSING', 'fallback')).toBeNull();
  });

  it('maps GraphQL sidecars using the largest resource for each ordered child', () => {
    const graph = {
      shortcode: 'SIDECAR', __typename: 'XDTGraphSidecar', owner: { username: 'owner', id: '12' },
      edge_sidecar_to_children: { edges: ['first', 'second'].map((name) => ({ node: {
        __typename: 'GraphImage', display_resources: [
          { src: image(`${name}-small`), config_width: 320, config_height: 400 },
          { src: image(name), config_width: 1080, config_height: 1350 },
        ],
      } })) },
    };
    const record = findInstagramMediaRecord({ data: { xdt_shortcode_media: graph } }, 'SIDECAR', '');
    expect(record?.imageUrls).toEqual([image('first'), image('second')]);
    expect(record?.mediaType).toBe(8);
    expect(record?.username).toBe('owner');
  });

  it('preserves explicit img_index selection and the parent post context', () => {
    const record = findInstagramMediaRecord({ items: [carousel] }, carousel.code, '', 2);
    expect(record?.imageUrls).toEqual([image('slide-2')]);
    expect(record?.shortcode).toBe(carousel.code);
    expect(record?.username).toBe('source_owner');
    expect(record?.mediaType).toBe(1);
    expect(record?.permalink).toBe(`https://www.instagram.com/p/${carousel.code}/?img_index=2`);
    expect(() => assertSingleUrlMediaComplete(record)).not.toThrow();
  });

  it('excludes unrelated network videos when structured post data is available', async () => {
    const handlers: Array<(response: { url(): string; headers(): Record<string, string> }) => void> = [];
    const page = {
      on: vi.fn((_event: string, handler: (typeof handlers)[number]) => { handlers.push(handler); }),
      off: vi.fn(),
      goto: vi.fn(async () => {
        for (const handler of handlers) handler({
          url: () => 'https://scontent.cdninstagram.com/unrelated.mp4',
          headers: () => ({ 'content-type': 'video/mp4' }),
        });
      }),
      waitForNetworkIdle: vi.fn(async () => {}),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ imageUrls: [image('cover')], videoUrls: [], notes: [] })
        .mockResolvedValueOnce([JSON.stringify({ items: [carousel] })]),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), trace: vi.fn() };
    const record = await extractSingleUrlRecord(page, `https://www.instagram.com/p/${carousel.code}/`, '', logger);
    expect(record.imageUrls).toEqual([image('slide-1'), image('slide-2')]);
    expect(record.videoUrls).toEqual([]);
    expect(record.video_source).toBe('none');
    expect(page.off).toHaveBeenCalledTimes(2);
  });

  it('preserves slide order instead of ranking carousel URLs by quality score', () => {
    const urls = [image('first'), `${image('second')}?stp=dst-jpg_e35_tt6`];
    expect(selectInstagramImageUrls(urls, { mediaType: 8 })).toEqual(urls);
  });

  it('replaces page-wide candidates with the authoritative carousel list', () => {
    const record = { ...mapItemToRecord(carousel, '', null), imageUrls: [image('cropped-cover')], username_source: 'unresolved', video_source: 'none' };
    mergeSingleUrlMediaRecord(record, mapItemToRecord(carousel, '', null), 'api_fallback');
    expect(record.imageUrls).toEqual([image('slide-1'), image('slide-2')]);
    expect(() => assertSingleUrlMediaComplete(record)).not.toThrow();
  });

  it('rejects a partially extracted carousel', () => {
    const record = mapItemToRecord({ ...carousel, carousel_media_count: 3 }, '', null);
    expect(() => assertSingleUrlMediaComplete(record)).toThrow('expected_slides=3 extracted_slides=2');
  });

  it('reports failure when any slide failed to upload or has no persisted ID', () => {
    const record = { ...mapItemToRecord(carousel, '', null), cloudflare: [
      { ok: true, id: 'saved-1' }, { ok: false, id: null },
    ] };
    const options = { pushCloudflare: true, skipVideoPush: false, outputPath: '/tmp/instagram.ndjson' };
    expect(() => assertSingleUrlUploadsComplete(record, options)).toThrow('persisted=1 expected=2 failed=1');
    record.cloudflare[1] = { ok: true, id: 'saved-2' };
    expect(() => assertSingleUrlUploadsComplete(record, options)).not.toThrow();
    record.cloudflare[1] = { ok: true, id: null };
    expect(() => assertSingleUrlUploadsComplete(record, options)).toThrow('persisted=1 expected=2 failed=0');
  });
});
