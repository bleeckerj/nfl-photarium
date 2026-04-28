import { randomBytes } from 'node:crypto';

const SLUG_SEPARATOR_PATTERN = /[^a-z0-9]+/g;

export const slugifyClientSiteName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(SLUG_SEPARATOR_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export const buildClientSiteWorkerName = (slug: string): string => `photarium-client-${slug}`;

export const buildClientSiteD1Name = (slug: string): string => `photarium-client-${slug}`;

export const buildClientSiteAssetNamespace = (slug: string): string => `${slug}-a`;

export const createClientSitePublishSecret = (): string => randomBytes(24).toString('hex');

export const createClientSiteRuntimeSecret = (): string => randomBytes(32).toString('hex');
