import { describe, expect, it } from 'vitest';
import { diagnosticJsonError, getDiagnosticHeaderName } from '../src/worker/dev/diagnostics';
import { isLocalDevMode, isLocalDevRequest, isLocalRequestUrl } from '../src/worker/dev/mode';

describe('local dev mode helpers', () => {
  it('recognizes explicit local dev mode', () => {
    expect(isLocalDevMode({ LOCAL_DEV_MODE: 'true' })).toBe(true);
    expect(isLocalDevMode({ LOCAL_DEV_MODE: 'false' })).toBe(false);
  });

  it('recognizes localhost-style request URLs only', () => {
    expect(isLocalRequestUrl('http://localhost:8788')).toBe(true);
    expect(isLocalRequestUrl('http://127.0.0.1:8788')).toBe(true);
    expect(isLocalRequestUrl('https://photarium-client-andsons.bleeckerj.workers.dev')).toBe(false);
  });

  it('requires both local mode and a local request origin', () => {
    expect(isLocalDevRequest('http://localhost:8788', { LOCAL_DEV_MODE: 'true' })).toBe(true);
    expect(isLocalDevRequest('https://photarium-client-andsons.bleeckerj.workers.dev', { LOCAL_DEV_MODE: 'true' })).toBe(false);
    expect(isLocalDevRequest('http://localhost:8788', { LOCAL_DEV_MODE: 'false' })).toBe(false);
  });

  it('adds diagnostic headers only in local dev mode', () => {
    const response = diagnosticJsonError(
      { LOCAL_DEV_MODE: 'true' },
      404,
      'Not found',
      'project_not_found'
    );

    expect(response.headers.get(getDiagnosticHeaderName())).toBe('project_not_found');
  });
});
