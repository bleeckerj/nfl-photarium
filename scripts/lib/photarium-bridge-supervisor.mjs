import { setTimeout as delay } from 'node:timers/promises';

export async function bridgeIsHealthy(baseUrl, fetcher = fetch) {
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.status === 'ok' && body.service === 'photarium-mcp-server';
  } catch {
    return false;
  }
}

export async function stopChild(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGINT');
  const timedOut = await Promise.race([exited.then(() => false), delay(timeoutMs, undefined, { ref: false }).then(() => true)]);
  if (timedOut && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

// Own only processes we launch. A healthy bridge started elsewhere may be reused,
// but is never killed during shutdown or recovery.
export async function superviseBridge({
  launch,
  healthy,
  onFailure,
  log = console.log,
  sleep = delay,
  stop = stopChild,
  startupAttempts = 240,
  pollMs = 1_000,
  monitorMs = 5_000,
  maxRestarts = 3,
  isStopping = () => false,
}) {
  let child;
  let stopped = false;
  let restarts = 0;
  let launchError;

  const cancelled = () => stopped || isStopping();

  async function ensureReady() {
    if (await healthy()) {
      log('[startup] Photarium MCP bridge healthy; reusing existing listener');
      return;
    }
    if (cancelled()) return;
    launchError = undefined;
    child = launch();
    child.once('error', (error) => { launchError = error; });
    for (let attempt = 0; attempt < startupAttempts && !cancelled(); attempt += 1) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`MCP bridge exited before readiness (code ${child.exitCode}, signal ${child.signalCode})`);
      }
      if (await healthy()) {
        log('[startup] Photarium MCP bridge ready');
        return;
      }
      if (attempt % 5 === 0) log('[startup] waiting for Photarium MCP bridge health');
      await sleep(pollMs);
    }
    if (!cancelled()) throw new Error('MCP bridge did not become healthy before startup timeout');
  }

  async function recover() {
    while (!cancelled()) {
      try {
        await ensureReady();
        return;
      } catch (error) {
        await stop(child);
        child = undefined;
        if (cancelled()) return;
        if (restarts >= maxRestarts) throw error;
        restarts += 1;
        log(`[startup] MCP bridge recovery ${restarts}/${maxRestarts}: ${error.message}`);
        await sleep(pollMs);
      }
    }
  }

  try {
    await recover();
    if (cancelled()) await stop(child);
  } catch (error) {
    stopped = true;
    throw error;
  }

  const done = (async () => {
    while (!cancelled()) {
      await sleep(monitorMs);
      if (cancelled()) break;
      if (await healthy()) continue;
      log('[startup] MCP bridge health lost; attempting recovery');
      await stop(child);
      child = undefined;
      if (cancelled()) break;
      if (restarts >= maxRestarts) throw new Error('MCP bridge recovery limit exhausted');
      restarts += 1;
      log(`[startup] MCP bridge recovery ${restarts}/${maxRestarts}`);
      await recover();
    }
  })().catch(async (error) => {
    if (!stopped) {
      stopped = true;
      await stop(child);
      await onFailure(error);
    }
  });

  return {
    done,
    async stop() {
      stopped = true;
      await stop(child);
    },
  };
}
