import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/page/scroll/stream/route';

type MockPage = {
  evaluate: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setCookie: ReturnType<typeof vi.fn>;
  setUserAgent: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
};

const createRequest = (body: Record<string, unknown>, signal?: AbortSignal) =>
  new NextRequest(
    new Request('http://localhost/api/import/page/scroll/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  );

const createMockBrowser = (options?: {
  gotoDelayMs?: number;
  mediaBatches?: unknown[];
}) => {
  const mediaBatches = [...(options?.mediaBatches || [])];
  const page: MockPage = {
    evaluate: vi.fn(async (pageFunction: unknown) => {
      const source = String(pageFunction);

      if (source.includes('document.body?.innerText?.slice(0, 4000)')) {
        return '';
      }
      if (source.includes('pickScrollTarget')) {
        return undefined;
      }
      if (source.includes('window.location.href')) {
        return 'https://example.com/page';
      }
      if (source.includes('const imgs = Array.from(document.querySelectorAll')) {
        return mediaBatches.shift() || [];
      }
      if (source.includes("return { target: 'window'")) {
        return { target: 'window', moved: true, atEnd: false };
      }
      if (source.includes('const nextLink = document.querySelector')) {
        return null;
      }

      return undefined;
    }),
    goto: vi.fn(async (url: string) => {
      if (options?.gotoDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.gotoDelayMs));
      }
      page.url.mockReturnValue(url);
      return { status: () => 200 };
    }),
    on: vi.fn(),
    setCookie: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    title: vi.fn(async () => ''),
    url: vi.fn(() => 'https://example.com/page'),
    waitForNetworkIdle: vi.fn(async () => undefined),
  };

  const browser = {
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
  };

  return { browser, page };
};

const makeMediaResults = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    mediaKind: 'image',
    src: `https://example.com/assets/image-${index + 1}.jpg`,
    srcset: '',
    dataSrcset: '',
    dataSrc: '',
    naturalWidth: 1200,
    naturalHeight: 800,
    poster: '',
    inMainContent: true,
    inUiChrome: false,
  }));

afterEach(() => {
  delete (globalThis as typeof globalThis & { __PHOTARIUM_TEST_PUPPETEER__?: unknown })
    .__PHOTARIUM_TEST_PUPPETEER__;
  vi.restoreAllMocks();
});

describe('POST /api/import/page/scroll/stream', () => {
  it('stops cleanly when the max asset cap is reached', async () => {
    const { browser } = createMockBrowser({
      mediaBatches: [makeMediaResults(10)],
    });

    (globalThis as typeof globalThis & { __PHOTARIUM_TEST_PUPPETEER__?: unknown })
      .__PHOTARIUM_TEST_PUPPETEER__ = {
      launch: vi.fn(async () => browser),
    };

    const response = await POST(
      createRequest({
        url: 'https://example.com/page',
        autoScrollUntilStable: true,
        maxAssets: 5,
        maxPages: 1,
        scrollDelayMs: 500,
      })
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect((text.match(/event: media/g) || []).length).toBe(5);
    expect(text).toContain('event: done');
    expect(text).toContain('Reached max assets (5)');
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('exits without an error event when the request is aborted', async () => {
    const controller = new AbortController();
    const { browser } = createMockBrowser({ gotoDelayMs: 50 });

    (globalThis as typeof globalThis & { __PHOTARIUM_TEST_PUPPETEER__?: unknown })
      .__PHOTARIUM_TEST_PUPPETEER__ = {
      launch: vi.fn(async () => browser),
    };

    const response = await POST(
      createRequest(
        {
          url: 'https://example.com/page',
          autoScrollUntilStable: true,
          maxAssets: 25,
          maxPages: 1,
          scrollDelayMs: 500,
        },
        controller.signal
      )
    );

    controller.abort();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('event: error');
    expect(browser.close).toHaveBeenCalled();
  });
});
