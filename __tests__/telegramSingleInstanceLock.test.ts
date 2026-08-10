import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { acquireSingleInstanceLock } from '../scripts/telegram-listener/single-instance-lock.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Telegram single-instance lock', () => {
  it('rejects a second local listener and releases cleanly', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-telegram-lock-'));
    directories.push(directory);
    const lockPath = path.join(directory, 'listener.lock');
    const first = await acquireSingleInstanceLock(lockPath);

    await expect(acquireSingleInstanceLock(lockPath)).rejects.toThrow(`pid ${process.pid}`);

    await first.release();
    const second = await acquireSingleInstanceLock(lockPath);
    await second.release();
  });
});
