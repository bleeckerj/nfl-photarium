import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import {
  ensureGrainradBaseUrl,
  getGrainradManagedStatus,
  resetGrainradManagedRuntimeForTests,
} from '@/server/image-tools/grainradManagedRuntime';

class FakeChildProcess extends EventEmitter {
  pid = 12345;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM');
    return true;
  });
}

const grainradEnvKeys = [
  'AWS_LAMBDA_FUNCTION_NAME',
  'CF_PAGES',
  'GRAINRAD_BASE_URL',
  'GRAINRAD_MANAGED_ENABLED',
  'GRAINRAD_MANAGED_HOST',
  'GRAINRAD_MANAGED_PORT',
  'GRAINRAD_MANAGED_REPO_PATH',
  'GRAINRAD_MANAGED_START_TIMEOUT_MS',
  'NETLIFY',
  'VERCEL',
];

const clearGrainradEnv = () => {
  grainradEnvKeys.forEach((key) => {
    delete process.env[key];
  });
};

const createChildProcess = () => new FakeChildProcess() as unknown as ChildProcessWithoutNullStreams;

describe('grainrad managed runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    clearGrainradEnv();
    resetGrainradManagedRuntimeForTests();
  });

  it('returns explicit GRAINRAD_BASE_URL without spawning', async () => {
    process.env.GRAINRAD_BASE_URL = 'http://grainrad.local/';
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(ensureGrainradBaseUrl()).resolves.toBe('http://grainrad.local');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getGrainradManagedStatus()).resolves.toMatchObject({
      mode: 'external',
      baseUrl: 'http://grainrad.local',
    });
  });

  it('starts the sibling Grainrad service once for concurrent requests', async () => {
    process.env.GRAINRAD_MANAGED_ENABLED = '1';
    process.env.GRAINRAD_MANAGED_REPO_PATH = '.';
    let healthy = false;
    const child = createChildProcess();
    spawnMock.mockImplementation(() => {
      healthy = true;
      return child;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{}', { status: healthy ? 200 : 503 })
    );

    await expect(Promise.all([
      ensureGrainradBaseUrl(),
      ensureGrainradBaseUrl(),
    ])).resolves.toEqual([
      'http://127.0.0.1:4173',
      'http://127.0.0.1:4173',
    ]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    await expect(getGrainradManagedStatus()).resolves.toMatchObject({
      mode: 'managed-ready',
      pid: 12345,
    });
  });

  it('times out when the managed service never becomes healthy', async () => {
    process.env.GRAINRAD_MANAGED_ENABLED = '1';
    process.env.GRAINRAD_MANAGED_REPO_PATH = '.';
    process.env.GRAINRAD_MANAGED_START_TIMEOUT_MS = '1';
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

    await expect(ensureGrainradBaseUrl()).rejects.toThrow(/timed out/i);

    expect(child.kill).toHaveBeenCalled();
    await expect(getGrainradManagedStatus()).resolves.toMatchObject({
      mode: 'managed-failed',
    });
  });

  it('refuses managed startup in serverless runtimes', async () => {
    process.env.GRAINRAD_MANAGED_ENABLED = '1';
    process.env.GRAINRAD_MANAGED_REPO_PATH = '.';
    process.env.VERCEL = '1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

    await expect(ensureGrainradBaseUrl()).rejects.toThrow(/long-lived Node host/i);

    expect(spawnMock).not.toHaveBeenCalled();
  });
});
