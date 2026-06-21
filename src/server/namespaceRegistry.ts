import fs from 'node:fs/promises';
import path from 'node:path';
import { getPhotariumRuntimeDataDir } from './runtimeDataDir';

const RUNTIME_DATA_DIR = getPhotariumRuntimeDataDir();
// Local JSON registry used to populate namespace dropdown options in the UI.
const REGISTRY_PATH = path.join(RUNTIME_DATA_DIR, 'namespace-registry.json');

type NamespaceRegistryPayload = {
  namespaces: Array<string | NamespaceRegistryEntry>;
  updatedAt: string;
};

export type NamespaceRegistryEntry = {
  name: string;
  description: string;
};

export const DEFAULT_NAMESPACE = 'cf-default';

export const BUILT_IN_NAMESPACE_DETAILS: NamespaceRegistryEntry[] = [
  {
    name: 'cf-site-misc',
    description: 'Miscellaneous images used across various websites.',
  },
];

// Normalize input so registry only stores meaningful namespaces.
export const normalizeRegistryNamespace = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '__none__' || trimmed === '__all__') return '';
  return trimmed;
};

export const isProtectedRegistryNamespace = (value?: string) => {
  const normalized = normalizeRegistryNamespace(value);
  if (!normalized) return true;
  if (normalized === DEFAULT_NAMESPACE) return true;
  return BUILT_IN_NAMESPACE_DETAILS.some((entry) => entry.name === normalized);
};

const normalizeDescription = (value?: string) => (typeof value === 'string' ? value.trim() : '');

const normalizeEntry = (entry: unknown): NamespaceRegistryEntry | null => {
  if (typeof entry === 'string') {
    const name = normalizeRegistryNamespace(entry);
    return name ? { name, description: '' } : null;
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const name = normalizeRegistryNamespace(typeof record.name === 'string' ? record.name : undefined);
  if (!name) {
    return null;
  }
  return {
    name,
    description: normalizeDescription(typeof record.description === 'string' ? record.description : undefined),
  };
};

const normalizeEntries = (entries: unknown[]): NamespaceRegistryEntry[] => {
  const byName = new Map<string, NamespaceRegistryEntry>();
  entries.forEach((entry) => {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;
    const existing = byName.get(normalized.name);
    byName.set(normalized.name, {
      name: normalized.name,
      description: normalized.description || existing?.description || '',
    });
  });
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
};

// Reads the registry from disk; missing file yields an empty registry.
const readRegistry = async (): Promise<NamespaceRegistryPayload> => {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const namespaces = Array.isArray(parsed?.namespaces)
      ? parsed.namespaces
      : [];
    return {
      namespaces,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[namespace-registry] Failed to read registry', error);
    }
    return { namespaces: [], updatedAt: new Date(0).toISOString() };
  }
};

// Writes the registry, ensuring stable sort + de-duplication.
const writeRegistry = async (payload: NamespaceRegistryPayload) => {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  const normalized = normalizeEntries(payload.namespaces);
  const nextPayload: NamespaceRegistryPayload = {
    namespaces: normalized,
    updatedAt: payload.updatedAt
  };
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(nextPayload, null, 2) + '\n', 'utf8');
};

// Returns the current list for UI options.
export const listRegistryNamespaces = async () => {
  const payload = await readRegistry();
  return normalizeEntries([...BUILT_IN_NAMESPACE_DETAILS, ...payload.namespaces]).map((entry) => entry.name);
};

export const listRegistryNamespaceDetails = async () => {
  const payload = await readRegistry();
  return normalizeEntries([...BUILT_IN_NAMESPACE_DETAILS, ...payload.namespaces]);
};

// Adds a namespace if it is valid and not already in the registry.
export const upsertRegistryNamespace = async (namespace?: string, description?: string) => {
  const normalized = normalizeRegistryNamespace(namespace);
  if (!normalized) return;
  const payload = await readRegistry();
  const entries = normalizeEntries(payload.namespaces);
  const existing = entries.find((entry) => entry.name === normalized);
  const nextDescription = normalizeDescription(description);
  if (existing) {
    if (!nextDescription || existing.description === nextDescription) return;
    existing.description = nextDescription;
  } else {
    entries.push({ name: normalized, description: nextDescription });
  }
  payload.namespaces = entries;
  payload.updatedAt = new Date().toISOString();
  await writeRegistry(payload);
};

export const upsertRegistryNamespaces = async (namespaces: string[]) => {
  const normalized = Array.from(
    new Set(namespaces.map((entry) => normalizeRegistryNamespace(entry)).filter(Boolean))
  );
  if (!normalized.length) return;

  const payload = await readRegistry();
  const entries = normalizeEntries(payload.namespaces);
  let didChange = false;
  normalized.forEach((namespace) => {
    if (!entries.some((entry) => entry.name === namespace)) {
      entries.push({ name: namespace, description: '' });
      didChange = true;
    }
  });

  if (!didChange) return;
  payload.namespaces = entries;
  payload.updatedAt = new Date().toISOString();
  await writeRegistry(payload);
};

export const removeRegistryNamespace = async (namespace?: string) => {
  const normalized = normalizeRegistryNamespace(namespace);
  if (!normalized || isProtectedRegistryNamespace(normalized)) return false;

  const payload = await readRegistry();
  const entries = normalizeEntries(payload.namespaces);
  const nextEntries = entries.filter((entry) => entry.name !== normalized);
  if (nextEntries.length === entries.length) return false;

  payload.namespaces = nextEntries;
  payload.updatedAt = new Date().toISOString();
  await writeRegistry(payload);
  return true;
};

export const renameRegistryNamespace = async (sourceNamespace?: string, targetNamespace?: string) => {
  const source = normalizeRegistryNamespace(sourceNamespace);
  const target = normalizeRegistryNamespace(targetNamespace);
  if (
    !source ||
    !target ||
    source === target ||
    isProtectedRegistryNamespace(source) ||
    isProtectedRegistryNamespace(target)
  ) return false;

  const payload = await readRegistry();
  const entries = normalizeEntries(payload.namespaces);
  const sourceEntry = entries.find((entry) => entry.name === source);
  const targetEntry = entries.find((entry) => entry.name === target);
  const nextEntries = entries.filter((entry) => entry.name !== source);

  if (!targetEntry) {
    nextEntries.push({ name: target, description: sourceEntry?.description ?? '' });
  } else if (!targetEntry.description && sourceEntry?.description) {
    targetEntry.description = sourceEntry.description;
  }

  payload.namespaces = nextEntries;
  payload.updatedAt = new Date().toISOString();
  await writeRegistry(payload);
  return true;
};

// Exposes the registry path for scripts/debugging.
export const getRegistryPath = () => REGISTRY_PATH;
