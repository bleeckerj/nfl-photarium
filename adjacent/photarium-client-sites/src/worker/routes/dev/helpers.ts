import type { Context } from 'hono';
import { jsonError } from '../../lib/json';
import { withNoIndex } from '../../lib/http';
import { isLocalDevMode } from '../../dev/mode';

export const requireLocalDevMode = (
  context: Context<{ Bindings: Env }>
): Response | null => {
  if (isLocalDevMode(context.env)) return null;
  return withNoIndex(jsonError(404, 'Not found'));
};

