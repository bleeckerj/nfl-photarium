import { describe, expect, it } from 'vitest';
import { handleRootEntry } from '../src/worker/routes/public/root';

const createContext = (overrides?: {
  url?: string;
  env?: Partial<Env>;
  assetResponse?: Response;
}) => {
  const request = new Request(overrides?.url ?? 'https://client.example.com/');
  return {
    req: {
      url: request.url,
      raw: request,
    },
    env: {
      LOCAL_DEV_MODE: 'false',
      PUBLIC_SITE_NAME: 'andSons',
      ACCESS_LINK_HASH_SECRET: 'access-secret',
      SESSION_SIGNING_SECRET: 'session-secret',
      IMAGES_ACCOUNT_HASH: 'hash',
      ASSETS: {
        fetch: async () => overrides?.assetResponse ?? new Response('<html>local shell</html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      },
      ...overrides?.env,
    },
  } as never;
};

describe('handleRootEntry', () => {
  it('redirects to the single configured gallery slug path', async () => {
    const response = await handleRootEntry(createContext({
      env: {
        CLIENT_ROOT_PROJECTS_JSON: JSON.stringify([
          {
            projectId: 'project-1',
            title: 'Spring',
            publicSlug: 'slug-1',
            accessKey: 'key-1',
            sharePath: '/p/slug-1?k=key-1',
            publishedAt: '2026-04-27T00:00:00.000Z',
          },
        ]),
      },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://client.example.com/p/slug-1');
  });

  it('renders a client-facing project index for multiple galleries', async () => {
    const response = await handleRootEntry(createContext({
      env: {
        CLIENT_ROOT_PROJECTS_JSON: JSON.stringify([
          {
            projectId: 'project-1',
            title: 'Spring',
            publicSlug: 'slug-1',
            accessKey: 'key-1',
            sharePath: '/p/slug-1?k=key-1',
            publishedAt: '2026-04-27T00:00:00.000Z',
          },
          {
            projectId: 'project-2',
            title: 'Summer',
            publicSlug: 'slug-2',
            accessKey: 'key-2',
            sharePath: '/p/slug-2?k=key-2',
            publishedAt: '2026-04-28T00:00:00.000Z',
          },
        ]),
      },
    }));

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Client Galleries');
    expect(html).toContain('Spring');
    expect(html).toContain('Summer');
    expect(html).toContain('href="/p/slug-1"');
    expect(html).toContain('href="/p/slug-2"');
    expect(html).not.toContain('Local development');
  });

  it('returns a client-safe not-found page when no gallery is configured', async () => {
    const response = await handleRootEntry(createContext());
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain('No client galleries are available at this URL.');
    expect(html).not.toContain('Local development');
  });

  it('serves the local shell only for localhost local-dev requests', async () => {
    const response = await handleRootEntry(createContext({
      url: 'http://localhost:8788/',
      env: {
        LOCAL_DEV_MODE: 'true',
      },
      assetResponse: new Response('<html>local shell</html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('local shell');
  });
});
