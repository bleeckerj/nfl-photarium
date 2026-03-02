import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

type PackageJson = {
  name?: string;
  version?: string;
};

export const runtime = 'nodejs';

const STARTED_AT = new Date().toISOString();
const SERVICE_INFO = readServiceInfo();
const TOOL_COUNT = countApiRoutes();

function readServiceInfo(): { name: string; version: string } {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as PackageJson;
    return {
      name: parsed.name || 'unknown',
      version: parsed.version || 'unknown',
    };
  } catch {
    return { name: 'unknown', version: 'unknown' };
  }
}

function gitOutput(args: string[]): string | null {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
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

function countApiRoutes(): number {
  const root = join(process.cwd(), 'src', 'app', 'api');

  function walk(dir: string): number {
    let total = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += walk(fullPath);
      } else if (entry.isFile() && entry.name === 'route.ts') {
        total += 1;
      }
    }
    return total;
  }

  try {
    return walk(root);
  } catch {
    return 0;
  }
}

function runtimeInfo() {
  return {
    service: SERVICE_INFO.name,
    service_version: SERVICE_INFO.version,
    git_commit: gitOutput(['rev-parse', '--short=12', 'HEAD']),
    git_branch: gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']),
    git_dirty: gitDirty(),
    node_version: process.version,
    started_at: STARTED_AT,
    tool_count: TOOL_COUNT,
  };
}

export async function GET() {
  return NextResponse.json({ status: 'ok', ...runtimeInfo() });
}
