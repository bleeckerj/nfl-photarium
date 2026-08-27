import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER_UPLOADER_DIR = path.join(ROOT_DIR, 'adjacent', 'photarium-folder-uploader');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function startNpmScript(script, cwd = ROOT_DIR) {
  return spawn(npmCommand, ['run', script], {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function requestStop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
}

async function main() {
  let shuttingDown = false;
  let shutdownPromise;

  console.log('[startup] launching Photarium development server');
  const photarium = startNpmScript('dev:server');

  photarium.once('error', (error) => {
    console.error(`[startup] Photarium failed to start: ${error.message}`);
  });

  console.log('[startup] launching CleanShot Photarium folder watcher');
  const watcher = startNpmScript('listen:cleanshot', FOLDER_UPLOADER_DIR);

  watcher.once('error', (error) => {
    console.error(`[startup] CleanShot watcher failed to start: ${error.message}`);
  });
  watcher.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[startup] CleanShot watcher exited${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}`);
    }
  });

  const shutdown = (reason, exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    console.log(`[startup] stopping Photarium and CleanShot watcher (${reason})`);
    requestStop(watcher);
    requestStop(photarium);
    shutdownPromise = Promise.all([waitForExit(watcher), waitForExit(photarium)]).then(() => {
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

  await new Promise((resolve) => photarium.once('exit', resolve));
  await shutdownPromise;
}

main().catch((error) => {
  console.error('[startup] fatal', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
