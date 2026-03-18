import { createPhotariumMcpApp } from './app.js';
import { startHttpCompatibilityServer } from './transports/http.js';
import { startStdioTransport } from './transports/stdio.js';
const HTTP_HOST = process.env.PHOTARIUM_HTTP_HOST || '127.0.0.1';
const HTTP_PORT = process.env.PHOTARIUM_HTTP_PORT ? Number(process.env.PHOTARIUM_HTTP_PORT) : undefined;
const HTTP_ENABLED = new Set(['1', 'true', 'yes', 'on']).has((process.env.PHOTARIUM_HTTP_ENABLED || '').toLowerCase());
async function main() {
    const app = createPhotariumMcpApp();
    app.logger.info('startup', app.startup);
    await startStdioTransport(app.executor, app.logger);
    if (HTTP_ENABLED || HTTP_PORT !== undefined) {
        await startHttpCompatibilityServer({
            host: HTTP_HOST,
            port: HTTP_PORT ?? 8787,
            executor: app.executor,
            registry: app.registry,
            logger: app.logger,
            startedAt: app.startedAt,
        });
    }
}
main().catch((error) => {
    process.stderr.write(`[error] startup.failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
});
