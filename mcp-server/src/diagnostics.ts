import { execSync } from 'node:child_process';

import type { ToolRegistry } from './core/registry.js';
import type { Logger } from './logging.js';

export const SERVICE_NAME = 'photarium-mcp-server';
export const SERVICE_VERSION = '0.3.0';

function gitOutput(args: string[]): string | null {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function gitDirty(): boolean | null {
  try {
    execSync('git diff --quiet --ignore-submodules HEAD --', {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    return false;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status === 1) return true;
    }
    return null;
  }
}

export function buildStartupDiagnostics(registry: ToolRegistry, logger: Logger, startedAt: string) {
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
