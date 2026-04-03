import type { ProjectSessionPayload } from './types';
import { createSessionToken, parseSessionToken } from './token';

const sessionCookieName = 'pcs_session';

const parseCookieHeader = (cookieHeader?: string | null): Record<string, string> => {
  if (!cookieHeader) return {};

  return cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, segment) => {
      const [name, ...rest] = segment.split('=');
      accumulator[name] = rest.join('=');
      return accumulator;
    }, {});
};

export const getSessionCookieName = (): string => sessionCookieName;

const createCookieAttributes = (secure: boolean, maxAge: number): string =>
  [
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');

export const buildSessionCookie = async (
  payload: ProjectSessionPayload,
  secret: string,
  secure: boolean
): Promise<string> => {
  const token = await createSessionToken(payload, secret);
  const maxAge = Math.max(1, payload.expiresAtEpochSeconds - Math.floor(Date.now() / 1000));
  return `${sessionCookieName}=${token}; ${createCookieAttributes(secure, maxAge)}`;
};

export const clearSessionCookie = (secure: boolean): string =>
  `${sessionCookieName}=; ${createCookieAttributes(secure, 0)}`;

export const readSessionCookie = async (
  request: Request,
  secret: string
): Promise<ProjectSessionPayload | null> => {
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  const token = cookies[sessionCookieName];
  if (!token) return null;
  return parseSessionToken(token, secret);
};
