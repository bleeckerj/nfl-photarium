import type { ClientSitePublishRequest } from './types';

const LOCAL_PUBLISH_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const normalizePublishTargetBaseUrl = (input: string): string => {
  const url = new URL(input);
  return url.origin;
};

export const isLocalPublishTarget = (input: string): boolean => {
  const url = new URL(input);
  return LOCAL_PUBLISH_HOSTNAMES.has(url.hostname);
};

export const resolvePublishSecret = (request: ClientSitePublishRequest): string | undefined => {
  const publishSecret = request.publishSecret?.trim();
  if (publishSecret) return publishSecret;
  const legacySecret = request.adminApiToken?.trim();
  if (legacySecret) return legacySecret;
  return undefined;
};

export const buildPublishHeaders = (publishSecret?: string): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (publishSecret) {
    headers.Authorization = `Bearer ${publishSecret}`;
  }

  return headers;
};
