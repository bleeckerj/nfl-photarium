import type { Context } from 'hono';
import { LocalDemoService } from '../../dev/demo-service';
import { json } from '../../lib/json';
import { withNoIndex } from '../../lib/http';
import { requireLocalDevMode } from './helpers';

export const handleCreateLocalDemo = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => {
  const blockedResponse = requireLocalDevMode(context);
  if (blockedResponse) return blockedResponse;

  const demoService = new LocalDemoService(
    context.env.DB,
    context.env.ACCESS_LINK_HASH_SECRET
  );

  const payload = await demoService.create(new URL(context.req.url).origin);
  return withNoIndex(json(payload));
};
