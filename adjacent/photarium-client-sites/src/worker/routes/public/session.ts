import type { Context } from 'hono';
import { z } from 'zod';
import { json, jsonError } from '../../lib/json';
import { diagnosticJsonError } from '../../dev/diagnostics';
import { withNoIndex } from '../../lib/http';
import { createAccessService, requireAccessibleProject } from './helpers';

const sessionRequestSchema = z.object({
  accessKey: z.string().min(1),
});

export const handleCreateSession = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectState = await requireAccessibleProject(context);
  if ('response' in projectState) return projectState.response;

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const parsed = sessionRequestSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'Invalid session payload');

  const accessService = createAccessService(context);
  const isValid = await accessService.validateSecretLink(projectState.project, parsed.data.accessKey);
  if (!isValid) {
    return diagnosticJsonError(
      context.env,
      404,
      'Not found',
      'access_key_invalid'
    );
  }

  const response = withNoIndex(json({ ok: true }));
  response.headers.append('Set-Cookie', await accessService.issueSessionCookie(context.req.raw, projectState.project));
  return response;
};
