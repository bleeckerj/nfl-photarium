import { describe, expect, it } from 'vitest';
import { diagnosticJsonError, getDiagnosticHeaderName } from '../src/worker/dev/diagnostics';
import { isLocalDevMode } from '../src/worker/dev/mode';

describe('local dev mode helpers', () => {
  it('recognizes explicit local dev mode', () => {
    expect(isLocalDevMode({ LOCAL_DEV_MODE: 'true' })).toBe(true);
    expect(isLocalDevMode({ LOCAL_DEV_MODE: 'false' })).toBe(false);
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

