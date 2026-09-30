import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { bridgeIsHealthy, superviseBridge } from '../scripts/lib/photarium-bridge-supervisor.mjs';

function child() {
  return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
}

function options() {
  return {
    launch: vi.fn(() => child()),
    healthy: vi.fn(async () => false),
    onFailure: vi.fn(),
    log: vi.fn(),
    stop: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    startupAttempts: 1,
    maxRestarts: 1,
  };
}

describe('Photarium bridge supervision', () => {
  it('accepts only a healthy Photarium MCP endpoint', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', service: 'another-service' }) }));
    expect(await bridgeIsHealthy('http://localhost:8787/', fetcher)).toBe(false);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', service: 'photarium-mcp-server' }) });
    expect(await bridgeIsHealthy('http://localhost:8787/', fetcher)).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8787/health');
  });

  it('reuses an existing healthy bridge without launching or killing it', async () => {
    const config = options();
    config.healthy.mockResolvedValue(true);
    const supervisor = await superviseBridge(config);
    await supervisor.stop();
    await supervisor.done;
    expect(config.launch).not.toHaveBeenCalled();
    expect(config.stop.mock.calls.every(([value]) => value === undefined)).toBe(true);
  });

  it('limits failed startup attempts and cleans up children', async () => {
    const config = options();
    await expect(superviseBridge(config)).rejects.toThrow('startup timeout');
    expect(config.launch).toHaveBeenCalledTimes(2);
    expect(config.stop).toHaveBeenCalledTimes(2);
  });

  it('recovers a lost bridge and reports exhaustion', async () => {
    const config = options();
    config.healthy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const supervisor = await superviseBridge(config);
    await supervisor.done;
    expect(config.launch).toHaveBeenCalledTimes(2);
    expect(config.onFailure).toHaveBeenCalledOnce();
  });

  it('continues after a successful recovery', async () => {
    const config = options();
    let shuttingDown = false;
    config.healthy.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    config.sleep.mockImplementation(async () => {
      if (config.launch.mock.calls.length === 2) shuttingDown = true;
    });
    const supervisor = await superviseBridge({ ...config, isStopping: () => shuttingDown });
    await supervisor.done;
    expect(config.launch).toHaveBeenCalledTimes(2);
    expect(config.onFailure).not.toHaveBeenCalled();
    await supervisor.stop();
  });

  it('cleans up when shutdown interrupts startup', async () => {
    const config = options();
    let shuttingDown = false;
    config.sleep.mockImplementation(async () => { shuttingDown = true; });
    const supervisor = await superviseBridge({ ...config, isStopping: () => shuttingDown });
    await supervisor.done;
    expect(config.stop).toHaveBeenCalledWith(config.launch.mock.results[0].value);
    expect(config.onFailure).not.toHaveBeenCalled();
  });

  it('surfaces child spawn errors through bounded recovery', async () => {
    const config = options();
    config.launch.mockImplementation(() => {
      const process = child();
      queueMicrotask(() => process.emit('error', new Error('spawn denied')));
      return process;
    });
    config.startupAttempts = 2;
    await expect(superviseBridge(config)).rejects.toThrow('spawn denied');
    expect(config.launch).toHaveBeenCalledTimes(2);
  });
});
