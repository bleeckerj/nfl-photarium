import type { ToolRegistry } from './core/registry.js';
import type { Logger } from './logging.js';
export declare const SERVICE_NAME = "photarium-mcp-server";
export declare const SERVICE_VERSION = "0.3.0";
export declare function buildStartupDiagnostics(registry: ToolRegistry, logger: Logger, startedAt: string): {
    service: string;
    serviceVersion: string;
    logLevel: import("./logging.js").LogLevel;
    startedAt: string;
    nodeVersion: string;
    gitCommit: string | null;
    gitBranch: string | null;
    gitDirty: boolean | null;
    toolCount: number;
    transport: {
        stdio: boolean;
        httpCompatibility: boolean;
    };
};
