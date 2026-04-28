import type { Context } from 'hono';
import { isLocalDevRequest } from '../../dev/mode';
import { fetchClientShell } from '../../lib/client-shell';
import { withNoIndex } from '../../lib/http';

export const handleLocalRootShell = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => {
  if (!isLocalDevRequest(context.req.url, context.env)) {
    return withNoIndex(new Response(null, { status: 404 }));
  }

  const response = await fetchClientShell(context.req.raw, context.env.ASSETS, {
    siteName: context.env.PUBLIC_SITE_NAME,
    faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
    logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
    logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
  });
  return withNoIndex(response);
};
