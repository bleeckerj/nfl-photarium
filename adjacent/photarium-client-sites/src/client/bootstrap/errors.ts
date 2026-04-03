import { clientCopy } from '../content/copy';

const diagnosticHeaderName = 'X-PCS-Dev-Reason';

type DiagnosticReason =
  | 'project_not_found'
  | 'project_inaccessible'
  | 'access_key_invalid'
  | 'session_missing_or_invalid';

export type ClientBootstrapErrorCode =
  | 'missing_project_slug'
  | 'project_not_found'
  | 'project_inaccessible'
  | 'access_key_invalid'
  | 'session_missing_or_invalid'
  | 'load_failed';

const reasonToCode: Record<DiagnosticReason, ClientBootstrapErrorCode> = {
  project_not_found: 'project_not_found',
  project_inaccessible: 'project_inaccessible',
  access_key_invalid: 'access_key_invalid',
  session_missing_or_invalid: 'session_missing_or_invalid',
};

export class ClientBootstrapError extends Error {
  constructor(
    public readonly code: ClientBootstrapErrorCode,
    public readonly status?: number
  ) {
    super(code);
    this.name = 'ClientBootstrapError';
  }
}

export const createBootstrapErrorFromResponse = (
  response: Response
): ClientBootstrapError => {
  const reason = response.headers.get(diagnosticHeaderName) as DiagnosticReason | null;
  if (reason && reason in reasonToCode) {
    return new ClientBootstrapError(reasonToCode[reason], response.status);
  }

  return new ClientBootstrapError('load_failed', response.status);
};

export const createMissingProjectSlugError = (): ClientBootstrapError =>
  new ClientBootstrapError('missing_project_slug');

export const getBootstrapErrorMessage = (error: unknown): string => {
  if (!(error instanceof ClientBootstrapError)) {
    return clientCopy.projectUnavailableFallback;
  }

  switch (error.code) {
    case 'missing_project_slug':
      return clientCopy.projectRouteMissing;
    case 'project_not_found':
      return clientCopy.projectNotFound;
    case 'project_inaccessible':
      return clientCopy.projectInaccessible;
    case 'access_key_invalid':
      return clientCopy.projectInvalidAccessKey;
    case 'session_missing_or_invalid':
      return clientCopy.projectMissingSession;
    default:
      return clientCopy.projectUnavailableFallback;
  }
};
