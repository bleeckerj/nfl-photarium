import type { Context } from 'hono';
import { jsonError } from '../../lib/json';
import { withNoIndex } from '../../lib/http';
import { isLocalDevRequest } from '../../dev/mode';

export const requireLocalDevMode = (
  context: Context<{ Bindings: Env }>
): Response | null => {
  if (isLocalDevRequest(context.req.url, context.env)) return null;
  return withNoIndex(jsonError(404, 'Not found'));
};
