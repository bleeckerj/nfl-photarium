import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientSiteBaseUrl,
  buildClientSiteCustomDomain,
  getManagedClientSiteDomainConfig,
  resolveClientSiteCustomDomain,
} from '@/features/client-sites/domain';

describe('client site domain helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds managed client subdomains from the client slug', () => {
    expect(buildClientSiteCustomDomain('andsons', 'clients.example.com')).toBe(
      'andsons.clients.example.com'
    );
    expect(buildClientSiteBaseUrl('andsons.clients.example.com')).toBe(
      'https://andsons.clients.example.com'
    );
  });

  it('reads managed domain config from environment', () => {
    vi.stubEnv('CLIENT_SITES_BASE_DOMAIN', 'clients.example.com');
    vi.stubEnv('CLIENT_SITES_ZONE_ID', 'zone-123');

    expect(getManagedClientSiteDomainConfig()).toEqual({
      baseDomain: 'clients.example.com',
      zoneId: 'zone-123',
    });
    expect(resolveClientSiteCustomDomain('andsons')).toBe('andsons.clients.example.com');
  });

  it('allows explicit custom domains to override the managed pattern', () => {
    vi.stubEnv('CLIENT_SITES_BASE_DOMAIN', 'clients.example.com');
    vi.stubEnv('CLIENT_SITES_ZONE_ID', 'zone-123');

    expect(resolveClientSiteCustomDomain('andsons', 'photos.andsons.com')).toBe('photos.andsons.com');
  });
});
