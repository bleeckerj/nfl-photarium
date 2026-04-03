import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAvailablePort, isProcessAlive } from '../scripts/dev/runtime.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0, servers.length).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );
});

describe('managed local runtime helpers', () => {
  it('skips an occupied port', async () => {
    const server = net.createServer();
    servers.push(server);

    const occupiedPort = await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve test port.'));
          return;
        }

        resolve(address.port);
      });
    });

    const availablePort = await findAvailablePort(occupiedPort);
    expect(availablePort).toBeGreaterThan(occupiedPort);
  });

  it('treats the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('treats EPERM from process.kill as alive', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('operation not permitted');
      error.code = 'EPERM';
      throw error;
    });

    expect(isProcessAlive(12345)).toBe(true);
    killSpy.mockRestore();
  });
});
