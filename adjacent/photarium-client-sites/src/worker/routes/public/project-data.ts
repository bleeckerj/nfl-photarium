import type { Context } from 'hono';
import { json } from '../../lib/json';
import { diagnosticJsonError } from '../../dev/diagnostics';
import { withNoIndex } from '../../lib/http';
import { mapProjectToPublicPayload } from '../../projects/mapper';
import { createAccessService, requireAccessibleProject } from './helpers';

export const handleProjectData = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectState = await requireAccessibleProject(context);
  if ('response' in projectState) return projectState.response;

  const accessService = createAccessService(context);
  const hasSession = await accessService.hasValidProjectSession(context.req.raw, projectState.project);
  if (!hasSession) {
    return diagnosticJsonError(
      context.env,
      404,
      'Not found',
      'session_missing_or_invalid'
    );
  }

  return withNoIndex(json({ project: mapProjectToPublicPayload(projectState.project) }));
};
