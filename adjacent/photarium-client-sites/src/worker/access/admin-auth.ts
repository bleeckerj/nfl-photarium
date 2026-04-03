import { constantTimeEquals } from './token';

/**
 * Bearer-token auth for internal admin publish endpoints.
 */
export const isAuthorizedAdminRequest = (request: Request, expectedToken: string): boolean => {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const suppliedToken = header.slice('Bearer '.length).trim();
  if (!suppliedToken || !expectedToken) return false;
  return constantTimeEquals(suppliedToken, expectedToken);
};
