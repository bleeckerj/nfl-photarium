import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const realFetch = global.fetch;

async function setupTestApp() {
  process.env.PHOTARIUM_BASE_URL = 'http://photarium.test';
  vi.resetModules();

  const [{ createPhotariumMcpApp }, { createMcpServer }, { startHttpCompatibilityServer }, sdk] = await Promise.all([
    import('../mcp-server/src/app.js'),
    import('../mcp-server/src/transports/stdio.js'),
    import('../mcp-server/src/transports/http.js'),
    import('../mcp-server/src/testing/sdk.js'),
  ]);

  const app = createPhotariumMcpApp('2026-03-13T00:00:00.000Z');
  return {
    app,
    createMcpServer,
    startHttpCompatibilityServer,
    Client: sdk.Client,
    InMemoryTransport: sdk.InMemoryTransport,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('Photarium MCP transports', () => {
  let tempDir: string;
  let stateFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'photarium-mcp-test-'));
    stateFile = path.join(tempDir, 'state.json');
    await writeFile(
      stateFile,
      JSON.stringify({
        folders: [],
        extras: {},
      }),
      'utf8',
    );

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('http://photarium.test')) {
        return realFetch(input, init);
      }

      const requestUrl = new URL(url);
      const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
        folders: string[];
        extras: Record<string, { description?: string | null; altText?: string | null }>;
      };

      if (requestUrl.pathname === '/api/folders' && (init?.method || 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as { name: string };
        state.folders.push(body.name);
        await writeFile(stateFile, JSON.stringify(state), 'utf8');
        return jsonResponse({ success: true, name: body.name });
      }

      const extrasMatch = requestUrl.pathname.match(/^\/api\/images\/([^/]+)\/extras$/);
      if (extrasMatch && (init?.method || 'GET') === 'PATCH') {
        const body = JSON.parse(String(init?.body || '{}')) as { description?: string | null; altText?: string | null };
        state.extras[extrasMatch[1]] = body;
        await writeFile(stateFile, JSON.stringify(state), 'utf8');
        return jsonResponse({ imageId: extrasMatch[1], record: body });
      }

      if (requestUrl.pathname === '/api/images/search' && (init?.method || 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as { query: string };
        return jsonResponse({
          results: [
            {
              id: 'img-1',
              filename: `${body.query}.png`,
              url: 'http://cdn.test/img-1/public',
            },
          ],
        });
      }

      return jsonResponse({ error: `Unhandled fake Photarium route: ${requestUrl.pathname}` }, 404);
    }) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.PHOTARIUM_BASE_URL;
    delete process.env.PHOTARIUM_MCP_LOG_LEVEL;
    vi.restoreAllMocks();
  });

  it('stdio list_tools exposes the canonical registry', async () => {
    const { app, createMcpServer, Client, InMemoryTransport } = await setupTestApp();
    const server = createMcpServer(app.executor);
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.listTools();
    expect(result.tools.some((tool: { name: string }) => tool.name === 'photarium_search')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'photarium_create_folder')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'photarium_generate_image')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'photarium_generate_from_references')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'photarium_semantic_merge')).toBe(true);
  });

  it('image generation tools support dry-run contract checks without network calls', async () => {
    const { app } = await setupTestApp();

    const generateResult = await app.executor.invoke(
      'photarium_generate_image',
      {
        prompt: 'A quiet product photo of a ceramic mug',
        dryRun: true,
        outputFormat: 'png',
        namespace: 'test-generated',
        folder: 'mcp-dry-run',
        tags: ['mcp', 'dry-run'],
      },
      { transport: 'stdio' },
    );
    expect(generateResult.isError).not.toBe(true);
    const generatePayload = JSON.parse(generateResult.content[0]?.text || '{}');
    expect(generatePayload).toMatchObject({
      dryRun: true,
      mode: 'text_to_image',
      request: {
        endpoint: '/images/generations',
        body: {
          prompt: 'A quiet product photo of a ceramic mug',
          output_format: 'png',
        },
      },
      upload: {
        namespace: 'test-generated',
        folder: 'mcp-dry-run',
        tags: ['mcp', 'dry-run'],
      },
    });

    const mergeResult = await app.executor.invoke(
      'photarium_semantic_merge',
      {
        mergeBrief: 'Blend the first image mood with the second image subject language.',
        prompt: 'Keep the result quiet and editorial.',
        dryRun: true,
        outputFormat: 'webp',
        sources: [
          { imageId: 'img-style', role: 'style_reference', instructions: 'Use lighting and restraint.' },
          { url: 'https://example.com/source.png', role: 'subject_reference', instructions: 'Use product silhouette only.' },
        ],
      },
      { transport: 'stdio' },
    );
    expect(mergeResult.isError).not.toBe(true);
    const mergePayload = JSON.parse(mergeResult.content[0]?.text || '{}');
    expect(mergePayload.mode).toBe('semantic_merge');
    expect(mergePayload.request.endpoint).toBe('/images/edits');
    expect(mergePayload.request.body.output_format).toBe('webp');
    expect(mergePayload.request.body.prompt).toContain('Semantic merge instruction');
    expect(mergePayload.sources).toHaveLength(2);
    expect(mergePayload.sources[0]).toMatchObject({ imageId: 'img-style', role: 'style_reference' });
    expect(mergePayload.sources[1]).toMatchObject({ url: 'https://example.com/source.png', role: 'subject_reference' });
  });

  it('stdio call_tool uses the shared executor and validator', async () => {
    const { app, createMcpServer, Client, InMemoryTransport } = await setupTestApp();
    const server = createMcpServer(app.executor);
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const okResult = await client.callTool({
      name: 'photarium_search',
      arguments: { query: 'sunset' },
    });
    expect(okResult.isError).not.toBe(true);
    expect(okResult.content[0]?.type).toBe('text');
    expect(okResult.content[0]?.text).toContain('"query": "sunset"');

    const invalidResult = await client.callTool({
      name: 'photarium_search',
      arguments: {},
    });
    expect(invalidResult.isError).toBe(true);
    expect(invalidResult.content[0]?.text).toContain('Missing required field');
  });

  it('HTTP compatibility routes expose the shared registry and executor', async () => {
    const { app, startHttpCompatibilityServer } = await setupTestApp();
    const server = await startHttpCompatibilityServer({
      host: '127.0.0.1',
      port: 0,
      executor: app.executor,
      registry: app.registry,
      logger: app.logger,
      startedAt: app.startedAt,
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve HTTP server address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const toolsResponse = await fetch(`${baseUrl}/tools`);
    expect(toolsResponse.status).toBe(200);
    const toolsPayload = await toolsResponse.json();
    expect(toolsPayload.tools.some((tool: { name: string }) => tool.name === 'photarium_search')).toBe(true);

    const toolResponse = await fetch(`${baseUrl}/tools/photarium_search`);
    expect(toolResponse.status).toBe(200);
    const toolPayload = await toolResponse.json();
    expect(toolPayload.tool.name).toBe('photarium_search');

    const callResponse = await fetch(`${baseUrl}/tools/photarium_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arguments: { query: 'dawn' } }),
    });
    expect(callResponse.status).toBe(200);
    const callPayload = await callResponse.json();
    expect(callPayload.ok).toBe(true);
    expect(callPayload.result.content[0].text).toContain('"query": "dawn"');

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('HTTP validation rejects missing and unknown fields', async () => {
    const { app, startHttpCompatibilityServer } = await setupTestApp();
    const server = await startHttpCompatibilityServer({
      host: '127.0.0.1',
      port: 0,
      executor: app.executor,
      registry: app.registry,
      logger: app.logger,
      startedAt: app.startedAt,
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve HTTP server address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const missingFieldResponse = await fetch(`${baseUrl}/tools/photarium_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
    });
    expect(missingFieldResponse.status).toBe(400);
    expect(await missingFieldResponse.json()).toMatchObject({
      ok: false,
      issues: [{ path: '$.query', message: 'Missing required field' }],
    });

    const unknownFieldResponse = await fetch(`${baseUrl}/tools/photarium_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arguments: { query: 'sunset', unexpected: true } }),
    });
    expect(unknownFieldResponse.status).toBe(400);
    expect(await unknownFieldResponse.json()).toMatchObject({
      ok: false,
      issues: [{ path: '$.unexpected', message: 'Unknown field' }],
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('HTTP preserves args alias handling and mutating write-path behavior', async () => {
    const { app, startHttpCompatibilityServer } = await setupTestApp();
    const server = await startHttpCompatibilityServer({
      host: '127.0.0.1',
      port: 0,
      executor: app.executor,
      registry: app.registry,
      logger: app.logger,
      startedAt: app.startedAt,
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve HTTP server address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const aliasResponse = await fetch(`${baseUrl}/tools/photarium_create_folder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: { name: 'new-folder' } }),
    });
    expect(aliasResponse.status).toBe(200);
    expect(await aliasResponse.json()).toMatchObject({
      ok: true,
      result: {
        content: [{ type: 'text' }],
      },
    });

    const mutateResponse = await fetch(`${baseUrl}/tools/photarium_extras_update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        arguments: {
          imageId: 'img-9',
          description: 'stored in tempdir',
        },
      }),
    });
    expect(mutateResponse.status).toBe(200);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
      folders: string[];
      extras: Record<string, { description?: string | null; altText?: string | null }>;
    };
    expect(state.folders).toContain('new-folder');
    expect(state.extras['img-9']).toMatchObject({ description: 'stored in tempdir' });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
});
