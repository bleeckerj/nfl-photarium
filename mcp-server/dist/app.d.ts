import { ToolExecutor } from './core/executor.js';
import { ToolRegistry } from './core/registry.js';
export declare function createPhotariumMcpApp(startedAt?: string): {
    logger: import("./logging.js").Logger;
    registry: ToolRegistry;
    executor: ToolExecutor;
    startup: {
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
    startedAt: string;
};
