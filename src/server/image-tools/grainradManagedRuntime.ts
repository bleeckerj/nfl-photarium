import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

import type { ImageToolDiagnosticEventInput } from '@/server/image-tools/types';

const DEFAULT_GRAINRAD_BASE_URL = 'http://127.0.0.1:4173';
const DEFAULT_GRAINRAD_MANAGED_HOST = '127.0.0.1';
const DEFAULT_GRAINRAD_MANAGED_PORT = 4173;
const DEFAULT_GRAINRAD_MANAGED_REPO_PATH = '../nfl-grainrad-clone';
const DEFAULT_GRAINRAD_START_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_FETCH_TIMEOUT_MS = 800;
const OUTPUT_BUFFER_LIMIT = 2_000;

export type GrainradManagedStatusMode =
  | 'external'
  | 'managed-ready'
  | 'managed-starting'
  | 'managed-failed'
  | 'disabled';

export type GrainradManagedStatus = {
  mode: GrainradManagedStatusMode;
  baseUrl?: string;
  message: string;
  managedEnabled: boolean;
  pid?: number;
};

type GrainradManagedState = {
  process?: ChildProcessWithoutNullStreams;
  startPromise?: Promise<string>;
  lastFailure?: string;
  lastOutput?: string;
};

type GrainradManagedConfig = {
  baseUrl: string;
  host: string;
  managedEnabled: boolean;
  port: number;
  repoPath: string;
  timeoutMs: number;
};

const stateKey = Symbol.for('photarium.grainradManagedRuntime');
const globalRuntime = globalThis as typeof globalThis & {
  [stateKey]?: GrainradManagedState;
};
const state = globalRuntime[stateKey] ?? {
  process: undefined,
  startPromise: undefined,
  lastFailure: undefined,
  lastOutput: undefined,
};
globalRuntime[stateKey] = state;

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const parseBooleanEnv = (value: string | undefined) =>
  value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes' || value?.toLowerCase() === 'on';

const parsePort = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRAINRAD_MANAGED_PORT;
};

const parseTimeout = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRAINRAD_START_TIMEOUT_MS;
};

const getExplicitBaseUrl = () => {
  const explicit = process.env.GRAINRAD_BASE_URL?.trim();
  return explicit ? normalizeBaseUrl(explicit) : undefined;
};

const getManagedConfig = (): GrainradManagedConfig => {
  const host = process.env.GRAINRAD_MANAGED_HOST?.trim() || DEFAULT_GRAINRAD_MANAGED_HOST;
  const port = parsePort(process.env.GRAINRAD_MANAGED_PORT);
  const repoPath = path.resolve(process.cwd(), process.env.GRAINRAD_MANAGED_REPO_PATH?.trim() || DEFAULT_GRAINRAD_MANAGED_REPO_PATH);
  return {
    baseUrl: normalizeBaseUrl(`http://${host}:${port}`),
    host,
    managedEnabled: parseBooleanEnv(process.env.GRAINRAD_MANAGED_ENABLED),
    port,
    repoPath,
    timeoutMs: parseTimeout(process.env.GRAINRAD_MANAGED_START_TIMEOUT_MS),
  };
};

const isServerlessRuntime = () =>
  Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizeStatusText = (value: string) =>
  value
    .replace(/https?:\/\/[^\s)]+/g, '<url>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<host>')
    .replace(/\[?::1\]?(?::\d+)?/g, '<host>')
    .replace(/\/Users\/[^\s)]+/g, '<path>')
    .replace(/\/private\/[^\s)]+/g, '<path>');

const appendOutput = (chunk: Buffer | string) => {
  const next = `${state.lastOutput ?? ''}${String(chunk)}`;
  state.lastOutput = next.slice(Math.max(0, next.length - OUTPUT_BUFFER_LIMIT));
};

const checkHealth = async (baseUrl: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const waitForHealth = async (baseUrl: string, timeoutMs: number) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkHealth(baseUrl)) {
      return true;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
};

const assertManagedStartupAllowed = async (config: GrainradManagedConfig) => {
  if (isServerlessRuntime()) {
    throw new Error('Managed Grainrad startup requires a long-lived Node host. Set GRAINRAD_BASE_URL to a running Grainrad service in serverless deployments.');
  }
  try {
    await access(config.repoPath);
  } catch {
    throw new Error('Managed Grainrad startup is enabled, but the configured Grainrad repository path is not available.');
  }
};

const startManagedGrainrad = async (
  config: GrainradManagedConfig,
  addEvent?: (event: ImageToolDiagnosticEventInput) => void
) => {
  await assertManagedStartupAllowed(config);
  if (await checkHealth(config.baseUrl)) {
    state.lastFailure = undefined;
    return config.baseUrl;
  }

  addEvent?.({
    phase: 'grainrad.runtime.start',
    message: 'Starting managed Grainrad service',
  });

  state.lastOutput = undefined;
  const child = spawn('npm', ['run', 'dev'], {
    cwd: config.repoPath,
    env: {
      ...process.env,
      HOST: config.host,
      PORT: String(config.port),
    },
  });
  state.process = child;

  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  child.on('exit', (code, signal) => {
    if (state.process === child) {
      state.process = undefined;
    }
    if (code !== 0 && signal !== 'SIGTERM') {
      state.lastFailure = sanitizeStatusText(`Managed Grainrad exited with code ${code ?? 'unknown'}.`);
    }
  });

  const ready = await waitForHealth(config.baseUrl, config.timeoutMs);
  if (!ready) {
    state.lastFailure = sanitizeStatusText(
      `Timed out waiting for managed Grainrad service to become healthy.${state.lastOutput ? ` Last output: ${state.lastOutput}` : ''}`
    );
    child.kill();
    throw new Error('Timed out waiting for managed Grainrad service to become healthy.');
  }

  state.lastFailure = undefined;
  addEvent?.({
    phase: 'grainrad.runtime.ready',
    message: 'Managed Grainrad service is ready',
    details: { pid: child.pid ?? null },
  });
  return config.baseUrl;
};

export const ensureGrainradBaseUrl = async (addEvent?: (event: ImageToolDiagnosticEventInput) => void) => {
  const explicitBaseUrl = getExplicitBaseUrl();
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const config = getManagedConfig();
  if (!config.managedEnabled) {
    return DEFAULT_GRAINRAD_BASE_URL;
  }

  if (await checkHealth(config.baseUrl)) {
    state.lastFailure = undefined;
    return config.baseUrl;
  }

  if (state.startPromise) {
    return state.startPromise;
  }

  state.startPromise = startManagedGrainrad(config, addEvent).finally(() => {
    state.startPromise = undefined;
  });
  return state.startPromise;
};

export const getGrainradManagedStatus = async (): Promise<GrainradManagedStatus> => {
  const explicitBaseUrl = getExplicitBaseUrl();
  if (explicitBaseUrl) {
    return {
      mode: 'external',
      baseUrl: explicitBaseUrl,
      managedEnabled: false,
      message: 'Using configured Grainrad service.',
    };
  }

  const config = getManagedConfig();
  if (!config.managedEnabled) {
    return {
      mode: 'disabled',
      baseUrl: DEFAULT_GRAINRAD_BASE_URL,
      managedEnabled: false,
      message: 'Managed Grainrad startup is disabled. Photarium will use the default local Grainrad URL if it is already running.',
    };
  }

  if (state.startPromise) {
    return {
      mode: 'managed-starting',
      baseUrl: config.baseUrl,
      managedEnabled: true,
      message: 'Managed Grainrad service is starting.',
      pid: state.process?.pid,
    };
  }

  if (await checkHealth(config.baseUrl)) {
    return {
      mode: 'managed-ready',
      baseUrl: config.baseUrl,
      managedEnabled: true,
      message: 'Managed Grainrad service is ready.',
      pid: state.process?.pid,
    };
  }

  if (state.lastFailure) {
    return {
      mode: 'managed-failed',
      baseUrl: config.baseUrl,
      managedEnabled: true,
      message: state.lastFailure,
      pid: state.process?.pid,
    };
  }

  return {
    mode: 'managed-starting',
    baseUrl: config.baseUrl,
    managedEnabled: true,
    message: 'Managed Grainrad service is enabled and will start on first use.',
  };
};

export const resetGrainradManagedRuntimeForTests = () => {
  state.process?.kill();
  state.process = undefined;
  state.startPromise = undefined;
  state.lastFailure = undefined;
  state.lastOutput = undefined;
};
