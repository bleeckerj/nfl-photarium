import type { Context } from 'hono';
import { isLocalDevMode } from '../../dev/mode';
import { fetchClientShell } from '../../lib/client-shell';
import { withNoIndex } from '../../lib/http';

export const handleLocalRootShell = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => {
  if (!isLocalDevMode(context.env)) {
    return withNoIndex(new Response(null, { status: 404 }));
  }

  const response = await fetchClientShell(context.req.raw, context.env.ASSETS);
  return withNoIndex(response);
};
