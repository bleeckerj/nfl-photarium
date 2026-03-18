import { createServer } from 'node:http';
import { ToolValidationError, ToolNotFoundError } from '../contracts/types.js';
import { buildStartupDiagnostics } from '../diagnostics.js';
function getTokenFromHeaders(headers) {
    const rawAuth = headers.authorization || headers.Authorization;
    const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice('bearer '.length).trim();
        return token || undefined;
    }
    const rawToken = headers['x-mcp-token'] || headers['X-MCP-Token'];
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    return token || undefined;
}
function maybeInjectToken(args, headers) {
    if (args.token !== undefined) {
        return args;
    }
    const token = getTokenFromHeaders(headers);
    if (!token) {
        return args;
    }
    return { ...args, token };
}
async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk.toString('utf8');
        });
        req.on('end', () => {
            if (!data.trim()) {
                resolve({});
                return;
            }
            try {
                const parsed = JSON.parse(data);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    reject(new Error('Request body must be a JSON object'));
                    return;
                }
                resolve(parsed);
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}
function buildHttpHelp(registry, toolName) {
    if (toolName) {
        const tool = registry.get(toolName);
        return {
            ok: true,
            tool: {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            },
            usage: {
                endpoint: `/tools/${tool.name}`,
                method: 'POST',
                body: { arguments: {} },
            },
        };
    }
    return {
        ok: true,
        endpoints: {
            health: 'GET /health',
            version: 'GET /version',
            startup: 'GET /startup',
            tools: 'GET /tools',
            toolInfo: 'GET /tools/:name',
            help: 'GET /help',
            toolHelp: 'GET /help/:name',
            callTool: 'POST /tools/call',
            callToolDirect: 'POST /tools/:name',
        },
        notes: [
            'Use GET /help/<tool-name> for a specific tool schema and HTTP call pattern.',
            'Example: /help/photarium_fs_ingest',
        ],
    };
}
async function executeHttpTool(executor, name, args, res) {
    const result = await executor.invoke(name, args, { transport: 'http' });
    sendJson(res, 200, { ok: !result.isError, result });
}
export async function startHttpCompatibilityServer(options) {
    const { host, port, executor, registry, logger, startedAt } = options;
    const startup = buildStartupDiagnostics(registry, logger, startedAt);
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const routePath = url.pathname.replace(/\/+$/, '') || '/';
            if (req.method === 'GET' && routePath === '/health') {
                sendJson(res, 200, { status: 'ok', ...startup });
                return;
            }
            if (req.method === 'GET' && routePath === '/version') {
                sendJson(res, 200, startup);
                return;
            }
            if (req.method === 'GET' && routePath === '/startup') {
                sendJson(res, 200, startup);
                return;
            }
            if (req.method === 'GET' && routePath === '/tools') {
                sendJson(res, 200, { tools: executor.listTools() });
                return;
            }
            if (req.method === 'GET' && routePath === '/help') {
                sendJson(res, 200, buildHttpHelp(registry));
                return;
            }
            if (req.method === 'GET' && routePath.startsWith('/help/')) {
                const name = decodeURIComponent(routePath.slice('/help/'.length));
                sendJson(res, 200, buildHttpHelp(registry, name));
                return;
            }
            if (req.method === 'GET' && routePath.startsWith('/tools/')) {
                const name = decodeURIComponent(routePath.slice('/tools/'.length));
                const tool = executor.getTool(name);
                sendJson(res, 200, {
                    tool: {
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                    },
                });
                return;
            }
            if (req.method === 'POST' && routePath === '/tools/call') {
                const payload = await readJsonBody(req);
                const name = payload.name;
                if (typeof name !== 'string' || name.length === 0) {
                    sendJson(res, 400, { ok: false, error: 'Missing tool name' });
                    return;
                }
                const rawArgs = payload.arguments;
                const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
                    ? rawArgs
                    : {};
                await executeHttpTool(executor, name, maybeInjectToken(args, req.headers), res);
                return;
            }
            if (req.method === 'POST' && routePath.startsWith('/tools/')) {
                const name = decodeURIComponent(routePath.slice('/tools/'.length));
                const payload = await readJsonBody(req);
                const rawArgs = (payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
                    ? payload.arguments
                    : undefined)
                    || (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
                        ? payload.args
                        : undefined)
                    || payload;
                await executeHttpTool(executor, name, maybeInjectToken(rawArgs, req.headers), res);
                return;
            }
            sendJson(res, 404, { ok: false, error: 'Not found' });
        }
        catch (error) {
            if (error instanceof ToolValidationError) {
                sendJson(res, 400, {
                    ok: false,
                    error: error.message,
                    issues: error.issues,
                });
                return;
            }
            if (error instanceof ToolNotFoundError) {
                sendJson(res, 404, { ok: false, error: error.message });
                return;
            }
            sendJson(res, 400, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    await new Promise((resolve) => {
        server.listen(port, host, () => {
            const address = server.address();
            logger.info('http.compat.ready', {
                host,
                port: address && typeof address !== 'string' ? address.port : port,
            });
            resolve();
        });
    });
    return server;
}
