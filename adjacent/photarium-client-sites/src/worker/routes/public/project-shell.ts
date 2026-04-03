import type { Context } from 'hono';
import { applyNoIndexHeaders, withNoIndex } from '../../lib/http';
import { diagnosticNotFound } from '../../dev/diagnostics';
import { fetchClientShell } from '../../lib/client-shell';
import { requireAccessibleProject, createAccessService } from './helpers';

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

    const response = await fetchClientShell(context.req.raw, context.env.ASSETS);
    const headers = applyNoIndexHeaders(new Headers(response.headers));
    headers.append('Set-Cookie', await accessService.issueSessionCookie(context.req.raw, projectState.project));

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  const hasSession = await accessService.hasValidProjectSession(context.req.raw, projectState.project);
  if (!hasSession) {
    return diagnosticNotFound(context.env, 'session_missing_or_invalid');
  }

  const response = await fetchClientShell(context.req.raw, context.env.ASSETS);
  return withNoIndex(response);
};
