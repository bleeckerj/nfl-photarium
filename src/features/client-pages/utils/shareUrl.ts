export const buildClientPageShareUrl = (
  baseUrl: string,
  publicSlug: string,
  accessKey: string
): string => {
  const url = new URL(baseUrl);
  url.pathname = `/p/${publicSlug}`;
  url.searchParams.set('k', accessKey);
  return url.toString();
};
