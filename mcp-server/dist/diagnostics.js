import { execSync } from 'node:child_process';
export const SERVICE_NAME = 'photarium-mcp-server';
export const SERVICE_VERSION = '0.3.0';
function gitOutput(args) {
    try {
        return execSync(`git ${args.join(' ')}`, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8',
        }).trim() || null;
    }
    catch {
        return null;
    }
}
function gitDirty() {
    try {
        execSync('git diff --quiet --ignore-submodules HEAD --', {
            cwd: process.cwd(),
            stdio: 'ignore',
        });
        return false;
    }
    catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
            const status = error.status;
            if (status === 1)
                return true;
        }
        return null;
    }
}
export function buildStartupDiagnostics(registry, logger, startedAt) {
    return {
        service: SERVICE_NAME,
        serviceVersion: SERVICE_VERSION,
        logLevel: logger.level,
        startedAt,
        nodeVersion: process.version,
        gitCommit: gitOutput(['rev-parse', '--short=12', 'HEAD']),
        gitBranch: gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']),
        gitDirty: gitDirty(),
        toolCount: registry.list().length,
        transport: {
            stdio: true,
            httpCompatibility: true,
        },
    };
}
