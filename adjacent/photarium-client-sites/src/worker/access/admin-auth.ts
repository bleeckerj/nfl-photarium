import { constantTimeEquals } from './token';
import { isLocalDevMode } from '../dev/mode';

/**
 * Local admin-publish auth. In explicit local-dev mode we allow unauthenticated
 * localhost requests so a single-operator Photarium install can publish to a
 * local worker without managing secrets. Public deployments still require the
 * configured shared publish secret.
 */
const LOCAL_REQUEST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const resolveExpectedPublishSecret = (
  env: Pick<Env, 'CLIENT_SITES_PUBLISH_SECRET' | 'ADMIN_API_TOKEN'>
) => env.CLIENT_SITES_PUBLISH_SECRET?.trim() || env.ADMIN_API_TOKEN?.trim() || '';

const isLocalAdminBypassAllowed = (
  request: Request,
  env: Pick<Env, 'LOCAL_DEV_MODE'>
): boolean => {
  if (!isLocalDevMode(env)) return false;
  const { hostname } = new URL(request.url);
  return LOCAL_REQUEST_HOSTS.has(hostname);
};

export const isAuthorizedAdminRequest = (
  request: Request,
  env: Pick<Env, 'LOCAL_DEV_MODE' | 'CLIENT_SITES_PUBLISH_SECRET' | 'ADMIN_API_TOKEN'>
): boolean => {
  if (isLocalAdminBypassAllowed(request, env)) return true;

  const expectedToken = resolveExpectedPublishSecret(env);
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const suppliedToken = header.slice('Bearer '.length).trim();
  if (!suppliedToken || !expectedToken) return false;
  return constantTimeEquals(suppliedToken, expectedToken);
};
