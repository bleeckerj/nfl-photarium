import { jsonError } from '../lib/json';
import { withNoIndex } from '../lib/http';
import { isLocalDevMode } from './mode';

export type DevDiagnosticReason =
  | 'project_not_found'
  | 'project_inaccessible'
  | 'access_key_invalid'
  | 'session_missing_or_invalid';

const diagnosticHeaderName = 'X-PCS-Dev-Reason';

const applyDiagnosticHeader = (
  headers: Headers,
  env: Pick<Env, 'LOCAL_DEV_MODE'>,
  reason: DevDiagnosticReason
): Headers => {
  if (isLocalDevMode(env)) {
    headers.set(diagnosticHeaderName, reason);
  }

  return headers;
};

export const withDiagnosticReason = (
  response: Response,
  env: Pick<Env, 'LOCAL_DEV_MODE'>,
  reason: DevDiagnosticReason
): Response => {
  const headers = applyDiagnosticHeader(new Headers(response.headers), env, reason);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const diagnosticJsonError = (
  env: Pick<Env, 'LOCAL_DEV_MODE'>,
  status: number,
  message: string,
  reason: DevDiagnosticReason
): Response => withDiagnosticReason(jsonError(status, message), env, reason);

export const diagnosticNotFound = (
  env: Pick<Env, 'LOCAL_DEV_MODE'>,
  reason: DevDiagnosticReason
): Response => withDiagnosticReason(withNoIndex(new Response(null, { status: 404 })), env, reason);

export const getDiagnosticHeaderName = (): string => diagnosticHeaderName;

