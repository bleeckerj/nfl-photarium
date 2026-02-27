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
  foldersByNamespace: Record<string, string[]>;
};

export const NO_NAMESPACE_KEY = '__none__';

export function normalizeFolderNamespaceKey(namespace?: string | null): string {
  if (namespace === undefined || namespace === null) {
    return NO_NAMESPACE_KEY;
  }
  const trimmed = namespace.trim();
  return trimmed ? trimmed : NO_NAMESPACE_KEY;
}

async function ensureStore(): Promise<void> {
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const initial: FolderStoreData = { foldersByNamespace: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

type LegacyFolderStoreData = {
  folders: string[];
};

function toRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoreData(parsed: unknown): FolderStoreData | null {
  if (!toRecord(parsed)) return null;
  const entry = parsed.foldersByNamespace;
  if (!toRecord(entry)) return null;
  const normalized: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (typeof key !== 'string') continue;
    if (!Array.isArray(value)) continue;
    normalized[key] = value.filter((name): name is string => typeof name === 'string');
  }
  return { foldersByNamespace: normalized };
}

function parseLegacyStoreData(parsed: unknown): LegacyFolderStoreData | null {
  if (!toRecord(parsed)) return null;
  if (!Array.isArray(parsed.folders)) return null;
  return {
    folders: parsed.folders.filter((name): name is string => typeof name === 'string')
  };
}

async function readStore(): Promise<FolderStoreData> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    const current = parseStoreData(parsed);
    if (current) {
      return current;
    }

    const legacy = parseLegacyStoreData(parsed);
    if (legacy) {
      const migrationNamespace = normalizeFolderNamespaceKey(
        process.env.IMAGE_NAMESPACE ?? process.env.NEXT_PUBLIC_IMAGE_NAMESPACE
      );
      const migrated: FolderStoreData = {
        foldersByNamespace: {
          [migrationNamespace]: legacy.folders
        }
      };
      await writeStore(migrated);
      console.warn(
        `[folder-store] Migrated legacy folder store to namespace key "${migrationNamespace}".`
      );
      return migrated;
    }
  } catch (error) {
    console.warn('Failed to parse folder store, resetting', error);
  }
  const fallback: FolderStoreData = { foldersByNamespace: {} };
  await fs.writeFile(STORE_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
  return fallback;
}

async function writeStore(data: FolderStoreData): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeFolderNames(folders: string[]): string[] {
  const seen = new Set<string>();
  for (const folder of folders) {
    const trimmed = folder.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export async function listStoredFolders(namespace?: string | null): Promise<string[]> {
  const store = await readStore();
  if (namespace === null) {
    return Array.from(
      new Set(
        Object.values(store.foldersByNamespace)
          .flat()
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }
  const key = normalizeFolderNamespaceKey(namespace);
  return normalizeFolderNames(store.foldersByNamespace[key] ?? []);
}

export async function addFolder(name: string, namespace?: string | null): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Folder name cannot be empty');
  }
  if (namespace === null) {
    throw new Error('Cannot create a folder while viewing all namespaces');
  }
  const store = await readStore();
  const key = normalizeFolderNamespaceKey(namespace);
  const folders = normalizeFolderNames(store.foldersByNamespace[key] ?? []);
  if (!folders.includes(trimmed)) {
    folders.push(trimmed);
    store.foldersByNamespace[key] = normalizeFolderNames(folders);
    await writeStore(store);
  } else {
    throw new Error('Folder already exists');
  }
}

export async function removeFolder(name: string, namespace?: string | null): Promise<void> {
  if (namespace === null) {
    throw new Error('Cannot delete a folder while viewing all namespaces');
  }
  const store = await readStore();
  const key = normalizeFolderNamespaceKey(namespace);
  const folders = [...(store.foldersByNamespace[key] ?? [])];
  const idx = folders.indexOf(name);
  if (idx >= 0) {
    folders.splice(idx, 1);
    if (folders.length === 0) {
      delete store.foldersByNamespace[key];
    } else {
      store.foldersByNamespace[key] = normalizeFolderNames(folders);
    }
    await writeStore(store);
  }
}

export async function renameFolder(oldName: string, newName: string, namespace?: string | null): Promise<void> {
  const trimmedNew = newName.trim();
  if (!trimmedNew) {
    throw new Error('New folder name cannot be empty');
  }
  if (namespace === null) {
    throw new Error('Cannot rename a folder while viewing all namespaces');
  }
  const store = await readStore();
  const key = normalizeFolderNamespaceKey(namespace);
  const folders = [...(store.foldersByNamespace[key] ?? [])];
  const idx = folders.indexOf(oldName);
  if (idx >= 0) {
    folders[idx] = trimmedNew;
    store.foldersByNamespace[key] = normalizeFolderNames(folders);
    await writeStore(store);
  } else if (!folders.includes(trimmedNew)) {
    folders.push(trimmedNew);
    store.foldersByNamespace[key] = normalizeFolderNames(folders);
    await writeStore(store);
  }
}
