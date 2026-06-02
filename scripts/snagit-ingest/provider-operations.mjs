import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectProviderFileState, readPrefix } from './source-records.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_EVICT_VERIFY_TIMEOUT_MS = 30 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProviderCommandLabel(command, args) {
  return [command, ...args.map((value) => JSON.stringify(String(value)))].join(' ');
}

function summarizeCommandError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  const message = error instanceof Error ? error.message : String(error);
  return [message, stderr, stdout].filter(Boolean).join(' | ');
}

function isUnsupportedProviderError(errorMessage) {
  const value = String(errorMessage || '').toLowerCase();
  return (
    value.includes('sandboxed process') ||
    value.includes('unknown command') ||
    value.includes('usage:') ||
    value.includes('not found') ||
    value.includes('no such file or directory')
  );
}

async function runProviderCommand(command, args, timeoutMs, logger) {
  const label = buildProviderCommandLabel(command, args);
  logger.debug(`provider command: ${label}`);
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      ok: true,
      supported: true,
      command: label,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (error) {
    const message = summarizeCommandError(error);
    return {
      ok: false,
      supported: !isUnsupportedProviderError(message),
      command: label,
      error: message,
    };
  }
}

async function waitForReadableMedia(filePath, options, logger) {
  const startedAt = Date.now();
  let nextHeartbeatAt = startedAt + options.heartbeatMs;
  let lastError = '';
  while ((Date.now() - startedAt) < options.hydrateTimeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 0) {
        const prefix = await readPrefix(filePath, Math.min(options.probeReadBytes, 4096));
        if (prefix.length > 0 || stat.size > 0) {
          return {
            ok: true,
            stat,
            elapsedMs: Date.now() - startedAt,
            bytesRead: prefix.length,
          };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() >= nextHeartbeatAt) {
      logger.heartbeat(`waiting for hydrate: ${filePath} elapsed=${Date.now() - startedAt}ms`);
      nextHeartbeatAt += options.heartbeatMs;
    }
    await sleep(1000);
  }

  return {
    ok: false,
    error: lastError || `Timed out waiting for hydrated bytes after ${options.hydrateTimeoutMs}ms`,
    elapsedMs: Date.now() - startedAt,
  };
}

async function waitForPlaceholderState(filePath, timeoutMs, logger) {
  const startedAt = Date.now();
  let nextHeartbeatAt = startedAt + DEFAULT_HEARTBEAT_MS;
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size === 0) {
        return {
          ok: true,
          stat,
          elapsedMs: Date.now() - startedAt,
        };
      }
    } catch (error) {
      logger.debug(`placeholder verify stat failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (Date.now() >= nextHeartbeatAt) {
      logger.heartbeat(`waiting for placeholder state: ${filePath} elapsed=${Date.now() - startedAt}ms`);
      nextHeartbeatAt += DEFAULT_HEARTBEAT_MS;
    }
    await sleep(1000);
  }

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function hydrateFileIfNeeded(item, stat, options, logger) {
  const providerState = await detectProviderFileState(item.absolutePath, stat);
  const placeholderLikely = providerState.placeholderLikely;

  if (!placeholderLikely) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: null,
      commandSupported: true,
      stat,
      bytesRead: 0,
    };
  }

  if (options.providerMode === 'manual-stage') {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: null,
      commandSupported: false,
      error: 'Provider mode is manual-stage and file appears to be online-only',
    };
  }

  const commandResult = await runProviderCommand(
    'fileproviderctl',
    ['materialize', item.absolutePath],
    Math.max(30_000, options.hydrateTimeoutMs),
    logger
  );

  if (!commandResult.ok) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: commandResult.command,
      commandSupported: commandResult.supported,
      error: commandResult.error || 'Hydrate command failed',
    };
  }

  const waitResult = await waitForReadableMedia(item.absolutePath, options, logger);
  if (!waitResult.ok) {
    return {
      placeholderLikely,
      providerHint: providerState.providerHint,
      xattrNames: providerState.xattrNames,
      hydratedByScript: false,
      commandAttempted: commandResult.command,
      commandSupported: commandResult.supported,
      error: waitResult.error || commandResult.error || 'Hydrate wait failed',
    };
  }

  return {
    placeholderLikely,
    providerHint: providerState.providerHint,
    xattrNames: providerState.xattrNames,
    hydratedByScript: true,
    commandAttempted: commandResult.command,
    commandSupported: commandResult.supported,
    stat: waitResult.stat,
    bytesRead: waitResult.bytesRead,
    hydrateElapsedMs: waitResult.elapsedMs,
  };
}

export async function evictHydratedFile(item, options, logger) {
  if (options.providerMode !== 'auto') {
    return { status: 'skipped', placeholderAfterEvict: false, command: null };
  }

  const attempts = [
    ['fileproviderctl', ['evict', item.absolutePath]],
    ['brctl', ['evict', item.absolutePath]],
  ];

  let lastFailure = null;
  for (const [command, args] of attempts) {
    const result = await runProviderCommand(command, args, DEFAULT_EVICT_VERIFY_TIMEOUT_MS, logger);
    if (!result.ok) {
      lastFailure = result;
      if (!result.supported) continue;
      return {
        status: 'failed',
        placeholderAfterEvict: false,
        command: result.command,
        error: result.error,
      };
    }

    const verify = await waitForPlaceholderState(item.absolutePath, DEFAULT_EVICT_VERIFY_TIMEOUT_MS, logger);
    if (verify.ok) {
      return {
        status: 'done',
        placeholderAfterEvict: true,
        command: result.command,
      };
    }

    return {
      status: 'failed',
      placeholderAfterEvict: false,
      command: result.command,
      error: 'Evict command returned successfully but file did not return to placeholder state',
    };
  }

  return {
    status: lastFailure?.supported === false ? 'unsupported' : 'failed',
    placeholderAfterEvict: false,
    command: lastFailure?.command || null,
    error: lastFailure?.error || 'No working evict command found',
  };
}
