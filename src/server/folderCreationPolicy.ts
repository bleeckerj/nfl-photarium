import { listStoredFolders } from '@/utils/folderStore';
import { listCatalogImagesWithFolderOverrides } from './folderInventory';
import { requireValidFolderName } from './folderPolicy';

/**
 * Folder creation is an operator decision, not a side effect of an upload.
 *
 * Uploads may file into a folder that already exists. Minting a new one requires
 * an explicit `createFolder` opt-in on the request (or the folder manager's
 * `POST /api/folders`). Without this gate, every automated uploader — MCP tools,
 * ingest scripts, agent runs — mints a folder per batch, which is how the
 * catalog accumulated 881 `signals/<hex>` folders and four near-identical
 * `service-manual-*` variants.
 */
export class UnknownFolderError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UnknownFolderError';
  }
}

const matchesNamespace = (imageNamespace: string | undefined, namespace: string | null) => {
  if (namespace === null) return true;
  if (namespace === '') return !imageNamespace;
  return imageNamespace === namespace;
};

export const listKnownFolderNames = async (namespace: string | null): Promise<Set<string>> => {
  const [images, storedFolders] = await Promise.all([
    listCatalogImagesWithFolderOverrides(),
    listStoredFolders(namespace),
  ]);
  const names = new Set<string>(storedFolders);
  images.forEach((image) => {
    if (image.folder && matchesNamespace(image.namespace, namespace)) names.add(image.folder);
  });
  return names;
};

const tokens = (name: string) => new Set(name.split(/[-/]/).filter(Boolean));

/**
 * Cheap lexical ranking over the folder list — shared tokens first, then shared
 * prefixes. The point is to make reusing an existing folder the path of least
 * resistance when an upload is rejected, so callers retry with `blog-2026`
 * rather than with `createFolder: true`.
 */
export const suggestSimilarFolders = (
  name: string,
  known: Iterable<string>,
  limit = 3
): string[] => {
  const wanted = tokens(name);
  const scored: Array<{ candidate: string; score: number }> = [];
  for (const candidate of known) {
    const shared = [...tokens(candidate)].filter((token) => wanted.has(token)).length;
    const prefix = candidate.startsWith(name) || name.startsWith(candidate) ? 1 : 0;
    const score = shared * 2 + prefix;
    if (score > 0) scored.push({ candidate, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
};

/**
 * Normalizes and validates the requested folder, then confirms it is filable:
 * either it already exists in this namespace, or the caller explicitly asked to
 * create it. Returns the normalized name to store.
 */
export const requireFilableFolder = async (
  rawFolder: string,
  namespace: string | null,
  allowCreate: boolean
): Promise<string> => {
  const name = requireValidFolderName(rawFolder);
  if (allowCreate) return name;

  const known = await listKnownFolderNames(namespace);
  if (known.has(name)) return name;

  const suggestions = suggestSimilarFolders(name, known);
  const hint = suggestions.length
    ? ` Did you mean: ${suggestions.join(', ')}?`
    : '';
  throw new UnknownFolderError(
    `Folder "${name}" does not exist in this namespace.${hint} File into an existing folder, ` +
      'or pass createFolder=true to create it deliberately.'
  );
};

export const parseCreateFolderFlag = (value: FormDataEntryValue | null): boolean =>
  typeof value === 'string' && value.trim().toLowerCase() === 'true';
