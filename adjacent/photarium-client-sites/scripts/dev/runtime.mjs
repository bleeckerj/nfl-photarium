import fs from 'node:fs/promises';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { projectRoot, runtimeDirectory, runtimeLogPath, runtimeStatePath } from './paths.mjs';

export const buildOrigin = (port) => `http://127.0.0.1:${port}`;

export const ensureRuntimeDirectory = async () => {
  await fs.mkdir(runtimeDirectory, { recursive: true });
};

export const readRuntimeState = async () => {
  try {
    const content = await fs.readFile(runtimeStatePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const writeRuntimeState = async (state) => {
  await ensureRuntimeDirectory();
  await fs.writeFile(runtimeStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
};

export const clearRuntimeState = async () => {
  await fs.rm(runtimeStatePath, { force: true });
};

export const isProcessAlive = (pid) => {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') {
      return true;
    }
    return false;
  }
};

export const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const checkHealth = async (origin) => {
  try {
    const response = await fetch(`${origin}/health`);
    if (!response.ok) return false;

    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
};

export const waitForHealthyOrigin = async (
  origin,
  { timeoutMs = 30_000, intervalMs = 500 } = {}
) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await checkHealth(origin)) return;
    await wait(intervalMs);
  }

  throw new Error(`Timed out waiting for ${origin} to become healthy.`);
};

export const findAvailablePort = async (startingPort, host = '127.0.0.1') => {
  const isPortFree = (port) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, host);
    });

  let candidatePort = startingPort;
  while (!(await isPortFree(candidatePort))) {
    candidatePort += 1;
  }

  return candidatePort;
};

export const getWranglerExecutable = () =>
  path.join(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
  );

export const runForegroundCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(' ')} (${code ?? 'unknown'})`));
    });
  });

const lookupListeningProcessId = (port) =>
  new Promise((resolve) => {
    execFile(
      'lsof',
      ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const pid = Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10);
        resolve(Number.isFinite(pid) ? pid : null);
      }
    );
  });

const safeSignalProcess = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const getHealthyRuntimeState = async () => {
  const state = await readRuntimeState();
  if (!state) return null;

  if (!isProcessAlive(state.pid)) {
    await clearRuntimeState();
    return null;
  }

  if (!(await checkHealth(state.origin))) {
    safeSignalProcess(state.pid, 'SIGTERM');
    await clearRuntimeState();
    return null;
  }

  return state;
};

export const spawnManagedWorker = async (port) => {
  await ensureRuntimeDirectory();
  const wranglerExecutable = getWranglerExecutable();
  const logFileHandle = await fs.open(runtimeLogPath, 'a');
  const child = spawn(wranglerExecutable, ['dev', '--port', String(port)], {
    cwd: projectRoot,
    detached: true,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: projectRoot,
      XDG_CACHE_HOME: runtimeDirectory,
      XDG_DATA_HOME: runtimeDirectory,
      XDG_STATE_HOME: runtimeDirectory,
      WRANGLER_REGISTRY_PATH: path.join(runtimeDirectory, 'registry'),
    },
    stdio: ['ignore', logFileHandle.fd, logFileHandle.fd],
  });
  child.unref();
  await logFileHandle.close();

  const state = {
    pid: child.pid,
    port,
    origin: buildOrigin(port),
    healthUrl: `${buildOrigin(port)}/health`,
    startedAt: new Date().toISOString(),
    logPath: runtimeLogPath,
  };

  await writeRuntimeState(state);

  try {
    await waitForHealthyOrigin(state.origin);
    const listenerPid = await lookupListeningProcessId(port);
    if (listenerPid) {
      state.pid = listenerPid;
      await writeRuntimeState(state);
    }
    return state;
  } catch (error) {
    if (isProcessAlive(child.pid)) {
      safeSignalProcess(child.pid, 'SIGTERM');
    }
    await clearRuntimeState();
    throw error;
  }
};

export const stopManagedWorkerProcess = async (state) => {
  if (!state?.pid || !isProcessAlive(state.pid)) {
    await clearRuntimeState();
    return { stopped: false, stale: true };
  }

  const shutdownAttempt = safeSignalProcess(state.pid, 'SIGTERM');
  if (!shutdownAttempt.ok) {
    return {
      stopped: false,
      stale: false,
      blocked: shutdownAttempt.code === 'EPERM',
      errorCode: shutdownAttempt.code,
      errorMessage: shutdownAttempt.message,
    };
  }

  const timeoutMs = 5_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(state.pid)) {
      await clearRuntimeState();
      return { stopped: true, stale: false };
    }
    await wait(150);
  }

  const forcedShutdownAttempt = safeSignalProcess(state.pid, 'SIGKILL');
  if (!forcedShutdownAttempt.ok) {
    return {
      stopped: false,
      stale: false,
      blocked: forcedShutdownAttempt.code === 'EPERM',
      errorCode: forcedShutdownAttempt.code,
      errorMessage: forcedShutdownAttempt.message,
    };
  }

  await clearRuntimeState();
  return { stopped: true, stale: false, forced: true };
};
