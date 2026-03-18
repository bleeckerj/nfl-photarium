import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { ToolExecutor } from '../core/executor.js';
import type { ToolRegistry } from '../core/registry.js';
import type { Logger } from '../logging.js';
export interface HttpTransportOptions {
    host: string;
    port: number;
    executor: ToolExecutor;
    registry: ToolRegistry;
    logger: Logger;
    startedAt: string;
}
export declare function startHttpCompatibilityServer(options: HttpTransportOptions): Promise<import("http").Server<typeof IncomingMessage, typeof ServerResponse>>;
