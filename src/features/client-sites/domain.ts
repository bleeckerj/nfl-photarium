const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const cleanString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeHostnameInput = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Client site domain must not be empty.');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed).hostname;
  }

  return trimmed;
};

export const normalizeClientSiteHostname = (value: string): string => {
  const hostname = normalizeHostnameInput(value)
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^\.+/, '');

  if (!hostname) {
    throw new Error('Client site domain must not be empty.');
  }

  const labels = hostname.split('.');
  if (labels.some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new Error(`Invalid client site domain: ${value}`);
  }
  if (labels.some((label) => !/^[a-z0-9-]+$/.test(label))) {
    throw new Error(`Invalid client site domain: ${value}`);
  }

  return hostname;
};

export const buildClientSiteCustomDomain = (slug: string, baseDomain: string): string =>
  `${slug}.${normalizeClientSiteHostname(baseDomain)}`;

const resolveCustomDomainFlag = (): boolean | undefined => {
  const raw = cleanString(process.env.CLIENT_SITES_USE_CUSTOM_DOMAINS)?.toLowerCase();
  if (!raw) return undefined;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  throw new Error('CLIENT_SITES_USE_CUSTOM_DOMAINS must be a boolean-like value.');
};

export const getManagedClientSiteDomainConfig = () => {
  const enabled = resolveCustomDomainFlag();
  if (enabled === false) return null;

  const baseDomain = cleanString(process.env.CLIENT_SITES_BASE_DOMAIN);
  const zoneId = cleanString(process.env.CLIENT_SITES_ZONE_ID);

  if (!baseDomain && !zoneId && enabled === undefined) {
    return null;
  }
  if (!baseDomain || !zoneId) {
    throw new Error(
      'Client site custom domains require both CLIENT_SITES_BASE_DOMAIN and CLIENT_SITES_ZONE_ID.'
    );
  }

  return {
    baseDomain: normalizeClientSiteHostname(baseDomain),
    zoneId,
  };
};

export const resolveClientSiteCustomDomain = (slug: string, configuredDomain?: string | null) => {
  const explicitDomain = cleanString(configuredDomain);
  if (explicitDomain) {
    return normalizeClientSiteHostname(explicitDomain);
  }

  const managedConfig = getManagedClientSiteDomainConfig();
  if (!managedConfig) return undefined;
  return buildClientSiteCustomDomain(slug, managedConfig.baseDomain);
};

export const buildClientSiteBaseUrl = (hostname: string) =>
  `https://${normalizeClientSiteHostname(hostname)}`;
