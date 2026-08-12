import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { REPO_ROOT } from '../shared/config.js';
import type {
  DemarkInputItem,
  DemarkSettings,
  DemarkWorkerResponse,
} from './types.js';

export interface DemarkWorkerPayload {
  settings: DemarkSettings;
  items: DemarkInputItem[];
}

function configuredNoAiRoot(): string {
  const root = process.env.PHOTARIUM_NOAI_WATERMARK_ROOT?.trim();
  if (!root) {
    throw new Error('PHOTARIUM_NOAI_WATERMARK_ROOT is required for photarium_demark_images');
  }
  return path.resolve(root);
}

function configuredPython(noAiRoot: string): string {
  return process.env.PHOTARIUM_NOAI_WATERMARK_PYTHON?.trim()
    || path.join(noAiRoot, '.venv', 'bin', 'python');
}

function workerScriptPath(): string {
  return path.join(REPO_ROOT, 'mcp-server', 'worker', 'demark_worker.py');
}

function parseWorkerResponse(stdout: string): DemarkWorkerResponse {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) throw new Error('The demark worker returned no JSON result');

  try {
    const parsed = JSON.parse(lastLine) as DemarkWorkerResponse;
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('The demark worker returned an invalid result shape');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `The demark worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createDemarkTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'photarium-demark-'));
}

export async function removeDemarkTempDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
}

export async function runDemarkWorker(payload: DemarkWorkerPayload): Promise<DemarkWorkerResponse> {
  const noAiRoot = configuredNoAiRoot();
  await fs.access(noAiRoot);

  return new Promise((resolve, reject) => {
    const child = spawn(configuredPython(noAiRoot), [workerScriptPath()], {
      cwd: noAiRoot,
      env: {
        ...process.env,
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new Error(`Unable to start noai-watermark worker: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : '';
        reject(new Error(`noai-watermark worker exited with code ${code ?? 1}${detail}`));
        return;
      }

      try {
        resolve(parseWorkerResponse(stdout));
      } catch (error) {
        const detail = stderr.trim() ? ` ${stderr.trim().slice(-1000)}` : '';
        reject(new Error(`${error instanceof Error ? error.message : String(error)}${detail}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
