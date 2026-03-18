import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/page/route';

const ORIGINAL_ENV = { ...process.env };

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/import/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/import/page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns discovered image and video candidates, including blob videos', async () => {
    const html = `
      <html>
        <body>
          <img src="/images/photo.jpg" />
          <video aria-label="clip.mp4">
            <source src="blob:https://www.canva.com/abc-123" type="video/mp4" />
          </video>
          <video src="https://cdn.example.com/loop.mp4"></video>
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === 'https://example.com/page') {
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }
      if (url === 'https://example.com/images/photo.jpg' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '20480',
          },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await POST(createRequest({ url: 'https://example.com/page' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.images)).toBe(true);
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://example.com/images/photo.jpg',
        }),
      ])
    );
    expect(payload.videos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'blob:https://www.canva.com/abc-123',
          isBlob: true,
        }),
        expect.objectContaining({
          url: 'https://cdn.example.com/loop.mp4',
          isBlob: false,
        }),
      ])
    );
    expect(payload.media.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('filters likely UI chrome assets from discovered media', async () => {
    const html = `
      <html>
        <body>
          <img src="https://images1.example.com/init/gfx/home/BrowseCatalogCategoryImages/1x/Fasteners.png" />
          <img src="https://images1.example.com/init/gfx/MastheadLogo.svg" />
          <img src="https://images1.example.com/init/gfx/circleX.svg" />
          <img src="https://www.example.com/webreports.gif?campaign=abc" />
          <img src="https://www.example.com/204.asp?c=1" />
          <img src="https://redirect.prod.experiment.routing.cloudfront.aws.a2z.com/x.png?timestamp=1771683572910" />
          <img src="https://s.amazon-adsystem.com/ecm3?ex=mediarithmics&id=vec-158842352820&gdpr=0&gdpr_consent=" />
          <img src="https://cdn.example.com/products/flue-exhauster-main.jpg" />
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === 'https://example.com/page') {
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }
      if (url === 'https://cdn.example.com/products/flue-exhauster-main.jpg' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '24576',
          },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await POST(createRequest({ url: 'https://example.com/page' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual([
      expect.objectContaining({
        url: 'https://cdn.example.com/products/flue-exhauster-main.jpg',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.com/products/flue-exhauster-main.jpg',
      expect.objectContaining({ method: 'HEAD' })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('circleX.svg'),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('webreports.gif'),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/204.asp'),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('experiment.routing.cloudfront.aws.a2z.com/x.png'),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('s.amazon-adsystem.com/ecm3'),
      expect.anything()
    );
  });

  it('keeps small substantive icon assets that are not generic ui chrome', async () => {
    const html = `
      <html>
        <body>
          <div id="sidebar">
            <nav id="nav">
              <img src="https://www.example.com/img/folder_applications.png" />
              <img src="https://www.example.com/img/icon_architecture.png" />
              <img src="https://www.example.com/img/logo.png" />
              <img src="https://www.example.com/img/donate_en.gif" />
            </nav>
          </div>
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === 'https://example.com/page') {
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }
      if (url === 'https://www.example.com/img/folder_applications.png' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '2048',
          },
        }));
      }
      if (url === 'https://www.example.com/img/icon_architecture.png' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '3072',
          },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await POST(createRequest({ url: 'https://example.com/page', minBytes: 1024 }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://www.example.com/img/folder_applications.png',
        }),
        expect.objectContaining({
          url: 'https://www.example.com/img/icon_architecture.png',
        }),
      ])
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/img/logo.png'),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/img/donate_en.gif'),
      expect.anything()
    );
  });

  it('includes ui chrome and small assets when explicitly requested', async () => {
    const html = `
      <html>
        <body>
          <div id="sidebar">
            <nav id="nav">
              <img src="https://www.example.com/img/folder_applications.png" />
              <img src="https://www.example.com/img/logo.png" />
            </nav>
          </div>
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === 'https://example.com/page') {
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }
      if (init?.method === 'HEAD' && (url === 'https://www.example.com/img/folder_applications.png' || url === 'https://www.example.com/img/logo.png')) {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '2048',
          },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await POST(createRequest({
      url: 'https://example.com/page',
      includeUiChrome: true,
      includeSmallAssets: true,
      minBytes: 1024,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://www.example.com/img/folder_applications.png' }),
        expect.objectContaining({ url: 'https://www.example.com/img/logo.png' }),
      ])
    );
    expect(payload.includeUiChrome).toBe(true);
    expect(payload.includeSmallAssets).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.example.com/img/logo.png',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('filters tiny tracker-like pixels using size hints even when minBytes is low', async () => {
    const html = `
      <html>
        <body>
          <img src="https://cdn.example.com/pixel.png?width=1&height=1&cb=123" />
          <img src="https://cdn.example.com/products/fume-exhauster-main.jpg" />
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === 'https://example.com/page') {
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }
      if (url === 'https://cdn.example.com/pixel.png?width=1&height=1&cb=123' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '128',
          },
        }));
      }
      if (url === 'https://cdn.example.com/products/fume-exhauster-main.jpg' && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '24576',
          },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await POST(createRequest({ url: 'https://example.com/page', minBytes: 0 }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual([
      expect.objectContaining({
        url: 'https://cdn.example.com/products/fume-exhauster-main.jpg',
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/pixel.png?width=1&height=1'),
      expect.anything()
    );
  });
});
