import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

function parseLockRecord(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === 'object' && error.code === 'EPERM';
  }
}

async function readLockRecord(lockPath) {
  try {
    return parseLockRecord(await readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function acquireSingleInstanceLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;

    const existing = await readLockRecord(lockPath);
    if (existing && isProcessRunning(existing.pid)) {
      throw new Error(`Telegram listener is already running (pid ${existing.pid}).`);
    }

    // Rename first so concurrent stale-lock recovery cannot delete a newly acquired lock.
    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
    try {
      await rename(lockPath, stalePath);
      await rm(stalePath, { force: true });
    } catch (staleError) {
      if (!staleError || typeof staleError !== 'object' || staleError.code !== 'ENOENT') throw staleError;
    }
    return acquireSingleInstanceLock(lockPath);
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await rm(lockPath, { force: true });
    },
  };
}
