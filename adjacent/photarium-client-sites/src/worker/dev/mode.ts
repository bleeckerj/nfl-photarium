/**
 * Local-development guards for routes and diagnostics that must never leak into deployed environments.
 */

export const isLocalDevMode = (env: Pick<Env, 'LOCAL_DEV_MODE'>): boolean =>
  env.LOCAL_DEV_MODE === 'true';

