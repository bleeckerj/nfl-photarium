import type { ClientSiteListItem, ClientSiteRecord } from '../types';

const omitSecret = (clientSite: ClientSiteRecord | ClientSiteListItem) => {
  const {
    publishSecret: _publishSecret,
    runtimeSecrets: _runtimeSecrets,
    ...safeClientSite
  } = clientSite;
  return safeClientSite;
};

export const toClientSiteResponse = (clientSite: ClientSiteRecord) => ({
  clientSite: omitSecret(clientSite),
});

export const toClientSiteListResponse = (clientSites: ClientSiteListItem[]) => ({
  clientSites: clientSites.map(omitSecret),
});
