import { describe, expect, it } from 'vitest';
import { isAuthorizedAdminRequest } from '../src/worker/access/admin-auth';

describe('admin publish auth', () => {
  it('allows localhost publish requests without a secret in local dev mode', () => {
    const request = new Request('http://127.0.0.1:8788/api/admin/projects', {
      method: 'POST',
    });

    expect(
      isAuthorizedAdminRequest(request, {
        LOCAL_DEV_MODE: 'true',
        CLIENT_SITES_PUBLISH_SECRET: undefined,
        ADMIN_API_TOKEN: undefined,
      })
    ).toBe(true);
  });

  it('rejects unauthenticated non-local requests', () => {
    const request = new Request('https://photos.example.com/api/admin/projects', {
      method: 'POST',
    });

    expect(
      isAuthorizedAdminRequest(request, {
        LOCAL_DEV_MODE: 'false',
        CLIENT_SITES_PUBLISH_SECRET: 'publish-secret',
        ADMIN_API_TOKEN: undefined,
      })
    ).toBe(false);
  });

  it('accepts matching bearer secrets for deployed publish requests', () => {
    const request = new Request('https://photos.example.com/api/admin/projects', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer publish-secret',
      },
    });

    expect(
      isAuthorizedAdminRequest(request, {
        LOCAL_DEV_MODE: 'false',
        CLIENT_SITES_PUBLISH_SECRET: 'publish-secret',
        ADMIN_API_TOKEN: undefined,
      })
    ).toBe(true);
  });
});
