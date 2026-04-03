import type {
  ClientSiteAccessPolicy,
  ClientSiteDownloadPresetPolicy,
  ClientSiteVisibleTagPolicy,
} from './types';

export const defaultClientSiteAccessPolicy: ClientSiteAccessPolicy = {
  mode: 'secret-link',
  sessionTtlSeconds: 60 * 60 * 24 * 14,
};

export const defaultClientSiteVisibleTagPolicy: ClientSiteVisibleTagPolicy = {
  mode: 'prefix-filter',
  hiddenPrefixes: ['x-', 'internal:'],
  hiddenExact: ['x-search', 'x-clip', 'x-color'],
};

export const defaultClientSiteDownloadPresetPolicy: ClientSiteDownloadPresetPolicy = {
  viewPresets: [
    { name: 'grid', label: 'Grid', sourceVariant: 'public' },
    { name: 'lightbox', label: 'Lightbox', sourceVariant: 'public' },
  ],
  downloadPresets: [
    { name: 'web', label: 'Web', width: 1600, fit: 'scale-down', quality: 82 },
    { name: 'review', label: 'Review', width: 2400, fit: 'scale-down', quality: 90 },
  ],
  allowedOutputFormats: ['jpg', 'webp', 'png'],
};

