import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTARIUM_MCP_URL,
  describeMcpConnectionFailure,
  generateCreativeBriefThroughMcp,
} from '@/server/image-tools/creativeBriefMcp';

const input = { imageId: 'img-1', prompt: 'a salesman by the track', provider: 'photarium_openai' as const };

function fetchFailure(code?: string): Error {
  const cause = Object.assign(new Error(code ? `connect ${code} 127.0.0.1:8787` : 'boom'), code ? { code } : {});
  return new TypeError('fetch failed', { cause });
}

afterEach(() => {
  delete process.env.PHOTARIUM_MCP_URL;
});

describe('describeMcpConnectionFailure', () => {
  it('explains a refused connection and how to start the bridge', () => {
    const message = describeMcpConnectionFailure(fetchFailure('ECONNREFUSED'), DEFAULT_PHOTARIUM_MCP_URL);
    expect(message).toContain('Photarium MCP bridge at http://127.0.0.1:8787 is not running');
    expect(message).toContain('npm run dev');
    expect(message).toContain('run_photarium_mcp_server.sh start');
    expect(message).toContain('PHOTARIUM_MCP_URL');
  });

  it('points at the hostname for DNS failures', () => {
    expect(describeMcpConnectionFailure(fetchFailure('ENOTFOUND'), 'http://mcp.internal:8787')).toContain('could not be resolved');
  });

  it('keeps the underlying detail for unknown causes', () => {
    expect(describeMcpConnectionFailure(fetchFailure(), 'http://127.0.0.1:8787')).toContain('fetch failed: boom');
  });
});

describe('generateCreativeBriefThroughMcp', () => {
  it('wraps a network failure instead of surfacing "fetch failed"', async () => {
    const failing: typeof fetch = async () => { throw fetchFailure('ECONNREFUSED'); };
    await expect(generateCreativeBriefThroughMcp(input, failing)).rejects.toThrow(/is not running \(connection refused\)/);
  });

  it('honours PHOTARIUM_MCP_URL in the message', async () => {
    process.env.PHOTARIUM_MCP_URL = 'http://10.0.0.5:9000/';
    const failing: typeof fetch = async () => { throw fetchFailure('ECONNREFUSED'); };
    await expect(generateCreativeBriefThroughMcp(input, failing)).rejects.toThrow('http://10.0.0.5:9000 is not running');
  });

  it('explains a 404 as a wrong listener or stale build', async () => {
    const notFound: typeof fetch = async () => new Response('nope', { status: 404 });
    await expect(generateCreativeBriefThroughMcp(input, notFound)).rejects.toThrow(/stale|something else is on that port/);
  });

  it('passes through the bridge error text on a rejected run', async () => {
    const rejected: typeof fetch = async () => Response.json({ error: 'OPENAI_API_KEY is not set' }, { status: 400 });
    await expect(generateCreativeBriefThroughMcp(input, rejected)).rejects.toThrow('OPENAI_API_KEY is not set');
  });

  it('returns the parsed tool result on success', async () => {
    const ok: typeof fetch = async () => Response.json({ result: { content: [{ type: 'text', text: JSON.stringify({ plan: {}, result: { imageId: 'child' } }) }] } });
    await expect(generateCreativeBriefThroughMcp(input, ok)).resolves.toMatchObject({ result: { imageId: 'child' } });
  });
});
