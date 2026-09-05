import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER_UPLOADER_DIR = path.join(ROOT_DIR, 'adjacent', 'photarium-folder-uploader');
const MCP_BRIDGE_SCRIPT = path.join(ROOT_DIR, 'run_photarium_mcp_server.sh');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function startNpmScript(script, cwd = ROOT_DIR) {
  return spawn(npmCommand, ['run', script], {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
}

// The Photarium MCP bridge serves the HTTP tool endpoints (default 127.0.0.1:8787)
// that image-detail tools such as Creative Brief call. Set PHOTARIUM_MCP_BRIDGE=0 to skip it.
function startMcpBridge() {
  return spawn(MCP_BRIDGE_SCRIPT, ['start'], {
    cwd: ROOT_DIR,
    env: { ...process.env, KILL_IF_OCCUPIED: process.env.KILL_IF_OCCUPIED ?? '1' },
    stdio: 'inherit',
  });
}

function mcpBridgeEnabled() {
  const flag = (process.env.PHOTARIUM_MCP_BRIDGE || '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function requestStop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
}

async function waitForPhotarium(baseUrl, timeoutMs = 60_000, isExited = () => false) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${baseUrl.replace(/\/+$/, '')}/health`;
  while (Date.now() < deadline) {
    if (isExited()) return false;
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return true;
    } catch {
      // The development server may still be compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  let shuttingDown = false;
  let shutdownPromise;
  let watcher;
  let mcpBridge;

  console.log('[startup] launching Photarium development server');
  const photarium = startNpmScript('dev:server');

  photarium.once('error', (error) => {
    console.error(`[startup] Photarium failed to start: ${error.message}`);
  });

  const shutdown = (reason, exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    console.log(`[startup] stopping Photarium, MCP bridge, and CleanShot watcher (${reason})`);
    requestStop(mcpBridge);
    requestStop(watcher);
    requestStop(photarium);
    shutdownPromise = Promise.all([waitForExit(mcpBridge), waitForExit(watcher), waitForExit(photarium)]).then(() => {
      process.exitCode = exitCode;
    });
    return shutdownPromise;
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  photarium.once('exit', (code, signal) => {
    if (shuttingDown) return;
    void shutdown('Photarium exited', signal ? 0 : code ?? 1);
  });

  const ready = await waitForPhotarium(
    process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000',
    60_000,
    () => photarium.exitCode !== null || photarium.signalCode !== null,
  );
  if (!ready && !shuttingDown) {
    console.warn('[startup] Photarium did not become ready before the watcher timeout; starting the watcher anyway');
  }
  if (shuttingDown) {
    await shutdownPromise;
    return;
  }

  if (mcpBridgeEnabled()) {
    console.log('[startup] launching Photarium MCP bridge');
    mcpBridge = startMcpBridge();
    mcpBridge.once('error', (error) => {
      console.error(`[startup] MCP bridge failed to start: ${error.message}`);
    });
    mcpBridge.once('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`[startup] MCP bridge exited${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}; image tools that call it will report "fetch failed"`);
      }
    });
  } else {
    console.log('[startup] skipping Photarium MCP bridge (PHOTARIUM_MCP_BRIDGE is off)');
  }

  console.log('[startup] launching CleanShot Photarium folder watcher');
  watcher = startNpmScript('listen:cleanshot', FOLDER_UPLOADER_DIR);

  watcher.once('error', (error) => {
    console.error(`[startup] CleanShot watcher failed to start: ${error.message}`);
  });
  watcher.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[startup] CleanShot watcher exited${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}`);
    }
  });

  await new Promise((resolve) => photarium.once('exit', resolve));
  await shutdownPromise;
}

main().catch((error) => {
  console.error('[startup] fatal', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
