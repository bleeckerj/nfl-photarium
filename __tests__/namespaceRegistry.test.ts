import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
let tempDir = '';

async function loadRegistry() {
  vi.resetModules();
  return import('@/server/namespaceRegistry');
}

describe('namespaceRegistry', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photarium-namespace-registry-'));
    process.env = {
      ...ORIGINAL_ENV,
      PHOTARIUM_RUNTIME_DATA_DIR: tempDir,
    };
  });

  afterEach(async () => {
    process.env = ORIGINAL_ENV;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('removes user-created namespaces from the registry', async () => {
    const registry = await loadRegistry();

    await registry.upsertRegistryNamespace('client-space', 'Client assets');
    await expect(registry.listRegistryNamespaces()).resolves.toContain('client-space');

    await expect(registry.removeRegistryNamespace('client-space')).resolves.toBe(true);
    await expect(registry.listRegistryNamespaces()).resolves.not.toContain('client-space');
  });

  it('refuses to remove protected namespaces', async () => {
    const registry = await loadRegistry();

    await expect(registry.removeRegistryNamespace('cf-default')).resolves.toBe(false);
    await expect(registry.removeRegistryNamespace('cf-site-misc')).resolves.toBe(false);
    await expect(registry.removeRegistryNamespace('__all__')).resolves.toBe(false);
    await expect(registry.listRegistryNamespaces()).resolves.toContain('cf-site-misc');
  });
});
