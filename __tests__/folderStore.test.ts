import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_ENV = { ...process.env };
const tmpDirs: string[] = [];

async function loadStoreWithTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-store-test-'));
  tmpDirs.push(dir);
  process.env = { ...ORIGINAL_ENV, PHOTARIUM_RUNTIME_DATA_DIR: dir };
  vi.resetModules();
  return import('@/utils/folderStore');
}

describe('folderStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    process.env = ORIGINAL_ENV;
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes nullish and blank namespace keys', async () => {
    const { NO_NAMESPACE_KEY, normalizeFolderNamespaceKey } = await loadStoreWithTempDir();
    expect(normalizeFolderNamespaceKey(undefined)).toBe(NO_NAMESPACE_KEY);
    expect(normalizeFolderNamespaceKey(null)).toBe(NO_NAMESPACE_KEY);
    expect(normalizeFolderNamespaceKey('')).toBe(NO_NAMESPACE_KEY);
    expect(normalizeFolderNamespaceKey('  ')).toBe(NO_NAMESPACE_KEY);
    expect(normalizeFolderNamespaceKey('  alpha  ')).toBe('alpha');
  });

  it('stores and lists folders per namespace independently', async () => {
    const { addFolder, listStoredFolders } = await loadStoreWithTempDir();
    await addFolder('shared-name', 'ns-a');
    await addFolder('shared-name', 'ns-b');
    await addFolder('ops', 'ns-a');

    expect(await listStoredFolders('ns-a')).toEqual(['ops', 'shared-name']);
    expect(await listStoredFolders('ns-b')).toEqual(['shared-name']);
    expect(await listStoredFolders(null)).toEqual(['ops', 'shared-name']);
  });

  it('renames and deletes within one namespace only', async () => {
    const { addFolder, listStoredFolders, removeFolder, renameFolder } = await loadStoreWithTempDir();
    await addFolder('campaigns', 'ns-a');
    await addFolder('campaigns', 'ns-b');
    await renameFolder('campaigns', 'ads', 'ns-a');
    await removeFolder('campaigns', 'ns-b');

    expect(await listStoredFolders('ns-a')).toEqual(['ads']);
    expect(await listStoredFolders('ns-b')).toEqual([]);
  });

  it('migrates legacy store format into default namespace key', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-store-legacy-test-'));
    tmpDirs.push(dir);
    process.env = {
      ...ORIGINAL_ENV,
      PHOTARIUM_RUNTIME_DATA_DIR: dir,
      IMAGE_NAMESPACE: 'default-ns',
    };
    await fs.writeFile(
      path.join(dir, 'folders.json'),
      JSON.stringify({ folders: ['legacy-a', 'legacy-b'] }, null, 2),
      'utf8'
    );

    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { listStoredFolders } = await import('@/utils/folderStore');
    const scoped = await listStoredFolders('default-ns');
    const all = await listStoredFolders(null);

    expect(scoped).toEqual(['legacy-a', 'legacy-b']);
    expect(all).toEqual(['legacy-a', 'legacy-b']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Migrated legacy folder store to namespace key "default-ns"')
    );
  });
});
