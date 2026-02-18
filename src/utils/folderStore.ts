import { promises as fs } from 'fs';
import os from 'node:os';
import path from 'path';

const RUNTIME_DATA_DIR =
  process.env.PHOTARIUM_RUNTIME_DATA_DIR ??
  (process.env.NODE_ENV === 'development'
    ? path.join(os.tmpdir(), 'photarium-data')
    : path.join(process.cwd(), 'data'));
// Keep runtime writes outside the repo in dev to avoid HMR reloads.
const STORE_PATH = path.join(RUNTIME_DATA_DIR, 'folders.json');

type FolderStoreData = {
  folders: string[];
};

async function ensureStore(): Promise<void> {
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const initial: FolderStoreData = { folders: [] };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

async function readStore(): Promise<FolderStoreData> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.folders)) {
      return { folders: parsed.folders as string[] };
    }
  } catch (error) {
    console.warn('Failed to parse folder store, resetting', error);
  }
  const fallback: FolderStoreData = { folders: [] };
  await fs.writeFile(STORE_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
  return fallback;
}

async function writeStore(data: FolderStoreData): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listStoredFolders(): Promise<string[]> {
  const store = await readStore();
  return store.folders;
}

export async function addFolder(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Folder name cannot be empty');
  }
  const store = await readStore();
  if (!store.folders.includes(trimmed)) {
    store.folders.push(trimmed);
    store.folders.sort((a, b) => a.localeCompare(b));
    await writeStore(store);
  } else {
    throw new Error('Folder already exists');
  }
}

export async function removeFolder(name: string): Promise<void> {
  const store = await readStore();
  const idx = store.folders.indexOf(name);
  if (idx >= 0) {
    store.folders.splice(idx, 1);
    await writeStore(store);
  }
}

export async function renameFolder(oldName: string, newName: string): Promise<void> {
  const trimmedNew = newName.trim();
  if (!trimmedNew) {
    throw new Error('New folder name cannot be empty');
  }
  const store = await readStore();
  const idx = store.folders.indexOf(oldName);
  if (idx >= 0) {
    store.folders[idx] = trimmedNew;
    store.folders = Array.from(new Set(store.folders));
    store.folders.sort((a, b) => a.localeCompare(b));
    await writeStore(store);
  } else if (!store.folders.includes(trimmedNew)) {
    store.folders.push(trimmedNew);
    store.folders.sort((a, b) => a.localeCompare(b));
    await writeStore(store);
  }
}
