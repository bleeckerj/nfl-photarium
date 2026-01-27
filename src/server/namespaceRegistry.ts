import fs from 'node:fs/promises';
import path from 'node:path';

// Local JSON registry used to populate namespace dropdown options in the UI.
const REGISTRY_PATH = path.join(process.cwd(), 'data', 'namespace-registry.json');

type NamespaceRegistryPayload = {
  namespaces: string[];
  updatedAt: string;
};

// Normalize input so registry only stores meaningful namespaces.
const normalizeNamespace = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '__none__' || trimmed === '__all__') return '';
  return trimmed;
};

// Reads the registry from disk; missing file yields an empty registry.
const readRegistry = async (): Promise<NamespaceRegistryPayload> => {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const namespaces = Array.isArray(parsed?.namespaces)
      ? parsed.namespaces.filter((entry: unknown) => typeof entry === 'string')
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
  const normalized = Array.from(new Set(payload.namespaces.map((entry) => entry.trim()).filter(Boolean))).sort();
  const nextPayload: NamespaceRegistryPayload = {
    namespaces: normalized,
    updatedAt: payload.updatedAt
  };
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(nextPayload, null, 2) + '\n', 'utf8');
};

// Returns the current list for UI options.
export const listRegistryNamespaces = async () => {
  const payload = await readRegistry();
  return payload.namespaces;
};

// Adds a namespace if it is valid and not already in the registry.
export const upsertRegistryNamespace = async (namespace?: string) => {
  const normalized = normalizeNamespace(namespace);
  if (!normalized) return;
  const payload = await readRegistry();
  if (payload.namespaces.includes(normalized)) return;
  payload.namespaces.push(normalized);
  payload.updatedAt = new Date().toISOString();
  await writeRegistry(payload);
};

// Exposes the registry path for scripts/debugging.
export const getRegistryPath = () => REGISTRY_PATH;
