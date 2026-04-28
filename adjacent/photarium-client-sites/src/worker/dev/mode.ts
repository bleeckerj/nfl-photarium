/**
 * Local-development guards for routes and diagnostics that must never leak into deployed environments.
 */

const LOCAL_REQUEST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const isLocalDevMode = (env: Pick<Env, 'LOCAL_DEV_MODE'>): boolean =>
  env.LOCAL_DEV_MODE === 'true';

export const isLocalRequestUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url);
    return LOCAL_REQUEST_HOSTS.has(hostname);
  } catch {
    return false;
  }
};

export const isLocalDevRequest = (
  url: string,
  env: Pick<Env, 'LOCAL_DEV_MODE'>
): boolean => isLocalDevMode(env) && isLocalRequestUrl(url);
