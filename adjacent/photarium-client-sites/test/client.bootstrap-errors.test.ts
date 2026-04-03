import { describe, expect, it } from 'vitest';
import {
  ClientBootstrapError,
  createBootstrapErrorFromResponse,
  getBootstrapErrorMessage,
} from '../src/client/bootstrap/errors';

describe('client bootstrap error mapping', () => {
  it('maps diagnostic headers to typed bootstrap errors', () => {
    const response = new Response(null, {
      status: 404,
      headers: {
        'X-PCS-Dev-Reason': 'session_missing_or_invalid',
      },
    });

    const error = createBootstrapErrorFromResponse(response);
    expect(error).toBeInstanceOf(ClientBootstrapError);
    expect(error.code).toBe('session_missing_or_invalid');
    expect(getBootstrapErrorMessage(error)).toContain('session');
  });

  it('falls back to a generic load failure without diagnostic headers', () => {
    const response = new Response(null, { status: 500 });
    const error = createBootstrapErrorFromResponse(response);

    expect(error.code).toBe('load_failed');
    expect(getBootstrapErrorMessage(error)).toBe('The project could not be loaded.');
  });
});

