import type { Context } from 'hono';
import { applyNoIndexHeaders, withNoIndex } from '../../lib/http';
import { diagnosticNotFound } from '../../dev/diagnostics';
import { fetchClientShell } from '../../lib/client-shell';
import { requireAccessibleProject, createAccessService } from './helpers';
import { findRootProjectBySlug } from './root-state';

export const handleProjectShell = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectState = await requireAccessibleProject(context);
  if ('response' in projectState) return projectState.response;

  const accessService = createAccessService(context);
  const rawKey = context.req.query('k');
  if (rawKey) {
    const isValid = await accessService.validateSecretLink(projectState.project, rawKey);
    if (!isValid) {
      return diagnosticNotFound(context.env, 'access_key_invalid');
    }

    const brandedResponse = await fetchClientShell(context.req.raw, context.env.ASSETS, {
      siteName: context.env.PUBLIC_SITE_NAME,
      faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
      logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
      logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
    });
    const headers = applyNoIndexHeaders(new Headers(brandedResponse.headers));
    headers.append('Set-Cookie', await accessService.issueSessionCookie(context.req.raw, projectState.project));

    return new Response(brandedResponse.body, {
      status: brandedResponse.status,
      headers,
    });
  }

  const hasSession = await accessService.hasValidProjectSession(context.req.raw, projectState.project);
  if (!hasSession) {
    const rootProject = findRootProjectBySlug(projectState.project.publicSlug, context.env);
    if (!rootProject) {
      return diagnosticNotFound(context.env, 'session_missing_or_invalid');
    }

    const brandedResponse = await fetchClientShell(context.req.raw, context.env.ASSETS, {
      siteName: context.env.PUBLIC_SITE_NAME,
      faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
      logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
      logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
    });
    const headers = applyNoIndexHeaders(new Headers(brandedResponse.headers));
    headers.append('Set-Cookie', await accessService.issueSessionCookie(context.req.raw, projectState.project));

    return new Response(brandedResponse.body, {
      status: brandedResponse.status,
      headers,
    });
  }

  const response = await fetchClientShell(context.req.raw, context.env.ASSETS, {
    siteName: context.env.PUBLIC_SITE_NAME,
    faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
    logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
    logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
  });
  return withNoIndex(response);
};
