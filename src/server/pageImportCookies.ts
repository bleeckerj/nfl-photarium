const MAX_COOKIE_HEADER_LENGTH = 8192;

export const normalizeCookieHeader = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\r\n]+/g, ' ').trim();
  if (!sanitized) return null;
  if (sanitized.length > MAX_COOKIE_HEADER_LENGTH) {
    throw new Error(`Cookie header too long (max ${MAX_COOKIE_HEADER_LENGTH} chars)`);
  }
  return sanitized;
};

type PuppeteerCookieLike = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
};

export const cookieHeaderToPuppeteerCookies = (
  pageUrl: string,
  cookieHeader: string
): PuppeteerCookieLike[] => {
  const domain = new URL(pageUrl).hostname;
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIndex = part.indexOf('=');
      if (eqIndex <= 0) return null;
      const name = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (!name) return null;
      return {
        name,
        value,
        domain,
        path: '/',
        secure: true,
      } as PuppeteerCookieLike;
    })
    .filter((item): item is PuppeteerCookieLike => Boolean(item));
};
