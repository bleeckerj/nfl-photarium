import type { Context } from 'hono';
import { json } from '../../lib/json';
import { withNoIndex } from '../../lib/http';
import { requireLocalDevMode } from './helpers';

export const handleLocalDevStatus = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => {
  const blockedResponse = requireLocalDevMode(context);
  if (blockedResponse) return blockedResponse;

  const requestUrl = new URL(context.req.url);
  return withNoIndex(
    json({
      ok: true,
      mode: 'local-dev',
      environmentLabel: 'local dev',
      origin: requestUrl.origin,
      rootUrl: `${requestUrl.origin}/`,
      serviceName: context.env.PUBLIC_SITE_NAME,
    })
  );
};

