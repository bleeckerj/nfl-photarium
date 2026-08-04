#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), '.env.telegram-listener');
const DEFAULT_PHOTARIUM_NPM_SCRIPT = 'dev:full';

function getCliArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('-')) return undefined;
  return next;
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const eqIndex = body.indexOf('=');
  if (eqIndex <= 0) return null;

  const key = body.slice(0, eqIndex).trim();
  let value = body.slice(eqIndex + 1).trim();
  const quote = value[0];

  if (quote !== '"' && quote !== "'") {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
  }

  return [key, stripWrappingQuotes(value)];
}

async function readEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      env[key] = value;
    }
    return { ok: true, env };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: false, env: {} };
    }
    throw error;
  }
}

async function waitForPhotariumReady(baseUrl, { timeoutMs }) {
  const start = Date.now();
  const url = `${baseUrl.replace(/\/+$/, '')}/api/upload`;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'OPTIONS' });
      if (response.status === 204 || response.status === 200 || response.ok) return true;
    } catch {
      // Ignore and retry.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function spawnNpmRun(scriptName) {
  const child = spawn('npm', ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
  });
  return child;
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGINT');
  } catch {
    // ignore
  }
}

async function main() {
  const photariumScript = getCliArgValue('--photarium') || DEFAULT_PHOTARIUM_NPM_SCRIPT;
  const configFile = getCliArgValue('--config') || DEFAULT_CONFIG_FILE;

  const config = await readEnvFile(configFile);
  const photariumBaseUrl =
    process.env.PHOTARIUM_BASE_URL ||
    config.env.PHOTARIUM_BASE_URL ||
    'http://localhost:3000';

  console.log('[startup] launching', {
    photarium: photariumScript,
    telegram: 'telegram:listen',
    configFile,
    foundConfigFile: config.ok,
    photariumBaseUrl,
  });

  const photarium = spawnNpmRun(photariumScript);

  let telegram = null;
  let shuttingDown = false;

  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[startup] shutting down', { reason });
    killChild(telegram);
    killChild(photarium);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  photarium.on('exit', (code, signal) => {
    shutdown('photarium-exited');
    if (signal) process.exitCode = 128;
    else process.exitCode = typeof code === 'number' ? code : 1;
  });

  const ready = await waitForPhotariumReady(photariumBaseUrl, { timeoutMs: 60_000 });
  if (!ready) {
    console.warn('[startup] photarium not reachable yet; starting telegram listener anyway');
  }

  if (!shuttingDown) {
    telegram = spawnNpmRun('telegram:listen');
    telegram.on('exit', (code, signal) => {
      shutdown('telegram-exited');
      if (signal) process.exitCode = 128;
      else process.exitCode = typeof code === 'number' ? code : 1;
    });
  }
}

main().catch((error) => {
  console.error('[startup] fatal', error);
  process.exit(1);
});
