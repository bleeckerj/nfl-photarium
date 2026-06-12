import { getExtrasStorage } from '@/server/extrasStorage';

export type PromptThisProvider = 'openai' | 'manual';

export type PromptThisEntry = {
  prompt: string;
  model: string;
  provider: PromptThisProvider;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowImageDescriptionEntry = {
  altText?: string;
  description?: string;
  aiCaption?: string;
};

export type ComfyWorkflowEntry = {
  workflowJson: unknown;
  promptCandidates: string[];
  imageDescription?: WorkflowImageDescriptionEntry;
  workflowIntentText: string;
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  intentTextVersion: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  updatedAt: string;
};

export type RawSourceReference = {
  absolutePath: string;
  relativePath?: string;
  pathHash?: string;
  contentHash?: string;
  fingerprint?: string;
  size?: number;
  mtimeMs?: number;
  dev?: number;
  ino?: number;
  capturedAt?: string;
};

export type ImageExifRecord = {
  summary?: Record<string, string | number>;
  parsed?: Record<string, unknown>;
  sharp?: Record<string, unknown>;
};

export type ImageToolRunRecord = {
  toolId: string;
  adapterKind: string;
  sourceImageId: string;
  effectId?: string;
  paramPreset?: string;
  params?: Record<string, unknown>;
  output?: Record<string, unknown>;
  externalJobId?: string;
  createdAt: string;
};

export type AnimatedWebpProvenanceRecord = {
  sourceImageIds?: string[];
  sourceFilenames?: string[];
  orderMode?: 'gallery' | 'reverse-gallery' | 'request' | 'reverse';
  fps?: number;
  loop?: boolean;
  generatedAt: string;
  repairedFromImageId?: string;
  replacedImageId?: string;
  repairMode?: 'reverse';
};

export type DngIngestRecord = {
  sourceType?: 'dng';
  ingestedAt?: string;
  preview?: {
    maxDimension?: number;
    quality?: number;
    width?: number;
    height?: number;
    bytes?: number;
    filename?: string;
  };
};

export type FlickrSourceRecord = {
  photoId: string;
  ownerNsid?: string;
  username?: string;
  permalink?: string;
  visibility?: string;
  safety?: string;
  license?: string;
  lastUpdate?: string;
  takenAt?: string;
  dateImported?: string;
  albumTitles?: string[];
  tagList?: string[];
  preferredSize?: string;
  selectedSourceUrl?: string;
  originalAvailable?: boolean;
  originalFormat?: string;
  downloadedContentHash?: string;
  /**
   * Provenance of the ingest path that populated this record.
   * Examples: "flickr-api", "flickr-export".
   */
  importSource?: string;
};

export type SnagitSourceRecord = {
  sourceType: 'snagx' | 'image' | 'video';
  originalFileName: string;
  originalExtension?: string;
  captureDate?: string;
  metadata?: Record<string, unknown>;
  extractedFilename?: string;
};

export type ImageExtrasRecordV1 = {
  schemaVersion: 1;
  imageId: string;

  /**
   * Application-specific metadata that should not depend on Cloudflare metadata persistence.
   */
  folder?: string;
  description?: string;
  altText?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;

  /** Prompt This (generated prompt for recreating the image). */
  promptThis?: PromptThisEntry;

  /** Comfy workflow intelligence for semantic retrieval and diagnostics. */
  comfyWorkflow?: ComfyWorkflowEntry;

  /** Durable pointer to the original local/raw source file. */
  rawSource?: RawSourceReference;

  /** Structured EXIF payload for search/audit and downstream workflows. */
  exif?: ImageExifRecord;

  /** Provenance for generated artifacts created through Photarium image tools. */
  imageToolRun?: ImageToolRunRecord;

  /** Provenance for animated WebP artifacts generated or repaired in Photarium. */
  animatedWebp?: AnimatedWebpProvenanceRecord;

  /** DNG ingest bookkeeping for generated preview artifacts. */
  dngIngest?: DngIngestRecord;

  /** Durable Flickr import provenance for backup/sync workflows. */
  flickrSource?: FlickrSourceRecord;

  /** Durable Snagit import provenance for archive workflows. */
  snagitSource?: SnagitSourceRecord;

  /**
   * Optional future slots (kept here to document intent; not used yet).
   * - caption?: string
   * - ocrText?: string
   * - notes?: string
   */

  createdAt: string;
  updatedAt: string;
};

export type ImageExtrasRecord = ImageExtrasRecordV1;

type JsonLike = null | boolean | number | string | JsonLike[] | { [k: string]: JsonLike };

function isByteArray(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (value.length > 64) return value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);
  const numericRatio = value.reduce((count, entry) => {
    return count + (Number.isInteger(entry) && entry >= 0 && entry <= 255 ? 1 : 0);
  }, 0) / value.length;
  return numericRatio >= 0.95;
}

function maybeBytesFromNumericObject(value: unknown): Uint8Array | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length < 16) return null;
  if (!keys.every((key) => /^\d+$/.test(key))) return null;

  const sorted = keys.map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i) return null;
  }

  const bytes = new Uint8Array(sorted.length);
  for (const idx of sorted) {
    const raw = obj[String(idx)];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 255) return null;
    bytes[idx] = raw;
  }
  return bytes;
}

function decodeAscii(bytes: Uint8Array): string | undefined {
  const chars: string[] = [];
  for (const b of bytes) {
    if (b === 0) break;
    chars.push(String.fromCharCode(b));
  }
  const text = chars.join('').trim();
  return text || undefined;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string | undefined {
  const evenLength = bytes.length - (bytes.length % 2);
  if (evenLength <= 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength);
  const codeUnits: number[] = [];
  for (let i = 0; i < evenLength; i += 2) {
    const code = view.getUint16(i, littleEndian);
    if (code === 0) break;
    if (code >= 32 || code === 9 || code === 10 || code === 13) {
      codeUnits.push(code);
    } else {
      return undefined;
    }
  }
  if (!codeUnits.length) return undefined;
  const text = String.fromCharCode(...codeUnits).trim();
  return text || undefined;
}

function decodeUserComment(bytes: Uint8Array): string | undefined {
  if (bytes.length < 8) return undefined;
  const marker = String.fromCharCode(...bytes.slice(0, 8));
  const payload = bytes.slice(8);
  if (marker === 'ASCII\u0000\u0000\u0000') return decodeAscii(payload);
  if (marker.startsWith('UNICODE')) {
    const be = decodeUtf16(payload, false);
    const le = decodeUtf16(payload, true);
    if (be && le) return be.length >= le.length ? be : le;
    return be || le || undefined;
  }
  return undefined;
}

function decodePrintableText(bytes: Uint8Array): string | undefined {
  const trimmed = bytes.slice(0, 4096);
  const chars: string[] = [];
  let printable = 0;
  for (const b of trimmed) {
    if (b === 0) break;
    if (b >= 32 && b <= 126) {
      printable += 1;
      chars.push(String.fromCharCode(b));
      continue;
    }
    if (b === 9 || b === 10 || b === 13) {
      printable += 1;
      chars.push(String.fromCharCode(b));
      continue;
    }
    return undefined;
  }
  if (!chars.length) return undefined;
  if (printable / chars.length < 0.9) return undefined;
  const text = chars.join('').trim();
  return text || undefined;
}

function summarizeBytes(bytes: Uint8Array): Record<string, JsonLike> {
  const previewBytes = Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0'));
  const decodedText = decodeUserComment(bytes) || decodePrintableText(bytes);
  return {
    _type: 'bytes',
    length: bytes.length,
    preview_hex: previewBytes.join(' '),
    ...(decodedText ? { decoded_text: decodedText } : {})
  };
}

function compactLargeNumericBlobs(value: unknown, depth = 0): JsonLike | undefined {
  if (depth > 10) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  const t = typeof value;

  if (ArrayBuffer.isView(value)) {
    return summarizeBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (Array.isArray(value)) {
    if (isByteArray(value)) {
      return summarizeBytes(Uint8Array.from(value));
    }
    return value
      .map((entry) => compactLargeNumericBlobs(entry, depth + 1))
      .filter((entry) => entry !== undefined) as JsonLike[];
  }

  if (t === 'object') {
    const byteObject = maybeBytesFromNumericObject(value);
    if (byteObject) {
      return summarizeBytes(byteObject);
    }
    const out: Record<string, JsonLike> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const compacted = compactLargeNumericBlobs(v, depth + 1);
      if (compacted !== undefined) out[k] = compacted;
    }
    return out;
  }

  return undefined;
}

export function sanitizeImageExifRecord(exif: ImageExifRecord | undefined): ImageExifRecord | undefined {
  if (!exif) return undefined;
  const compacted = compactLargeNumericBlobs(exif);
  if (!compacted || typeof compacted !== 'object' || Array.isArray(compacted)) {
    return undefined;
  }
  return compacted as unknown as ImageExifRecord;
}

export function sanitizeImageExtrasRecord(record: ImageExtrasRecord | null): ImageExtrasRecord | null {
  if (!record || !record.exif) return record;
  const sanitizedExif = sanitizeImageExifRecord(record.exif);
  if (!sanitizedExif || sanitizedExif === record.exif) return record;
  return { ...record, exif: sanitizedExif };
}

export function getImageExtrasKey(imageId: string): string {
  return `image-extras:${imageId}`;
}

export async function getImageExtrasRecord(imageId: string): Promise<ImageExtrasRecord | null> {
  const storage = getExtrasStorage();
  const record = await storage.get<ImageExtrasRecord>(getImageExtrasKey(imageId));
  return sanitizeImageExtrasRecord(record);
}

export async function getImageExtrasRecords(imageIds: string[]): Promise<Record<string, ImageExtrasRecord | null>> {
  const storage = getExtrasStorage();
  const keys = imageIds.map((id) => getImageExtrasKey(id));
  const keyed = await storage.getMany<ImageExtrasRecord>(keys);
  const result: Record<string, ImageExtrasRecord | null> = {};

  imageIds.forEach((id, idx) => {
    const key = keys[idx];
    result[id] = sanitizeImageExtrasRecord(keyed[key] ?? null);
  });

  return result;
}

// -- Folder override cache -------------------------------------------------
// The gallery list endpoint historically pre-loaded the entire image-extras
// dataset on every paginated request, purely so the folder filter and folder
// facets reflected extras-stored folders. That MGET (~18k keys, ~270ms per
// request) is by far the largest steady-state cost of /api/images.
//
// We replace it with a write-through in-memory map keyed by image id. The map
// is populated lazily on first read, refreshed periodically as a defence
// against multi-process drift, and updated synchronously after every
// successful set/delete so single-process deployments stay consistent without
// hitting storage on the hot path.
//
// `null` (not in map) means "no override -- use cached/Cloudflare folder".
// `undefined` (in map) means "extras explicitly cleared the folder".
// `string` (in map) means "extras specifies this folder".
type FolderOverrideMap = Map<string, string | undefined>;

interface FolderOverrideCacheState {
  map: FolderOverrideMap;
  loadedAt: number;
  inflight: Promise<FolderOverrideMap> | null;
  // Monotonically increasing version bumped on every successful load and on
  // every applyFolderOverrideUpdate. Downstream caches (e.g. galleryQuery
  // memoization) use this in their scope keys so they invalidate as soon as
  // the folder data they snapshotted has changed.
  version: number;
}

const FOLDER_OVERRIDE_CACHE_KEY = Symbol.for('photarium.imageExtras.folderOverrides');
const folderOverrideGlobal = globalThis as typeof globalThis & {
  [FOLDER_OVERRIDE_CACHE_KEY]?: FolderOverrideCacheState;
};

const folderOverrideState: FolderOverrideCacheState =
  folderOverrideGlobal[FOLDER_OVERRIDE_CACHE_KEY] ?? {
    map: new Map(),
    loadedAt: 0,
    inflight: null,
    version: 0,
  };

if (!folderOverrideGlobal[FOLDER_OVERRIDE_CACHE_KEY]) {
  folderOverrideGlobal[FOLDER_OVERRIDE_CACHE_KEY] = folderOverrideState;
}

const FOLDER_OVERRIDE_TTL_MS = (() => {
  const raw = Number(process.env.IMAGE_EXTRAS_FOLDER_OVERRIDE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
})();

type FolderOverrideExtraction =
  | { present: true; folder: string | undefined }
  | { present: false };

function extractExtrasFolder(record: ImageExtrasRecord | null): FolderOverrideExtraction {
  if (!record) return { present: false };
  if (!Object.prototype.hasOwnProperty.call(record, 'folder')) return { present: false };
  const folder = typeof record.folder === 'string' ? record.folder : undefined;
  return { present: true, folder };
}

async function refreshFolderOverridesFromStorage(): Promise<FolderOverrideMap> {
  const allIds = await listImageExtrasImageIds();
  const map: FolderOverrideMap = new Map();
  if (allIds.length === 0) return map;
  const records = await getImageExtrasRecords(allIds);
  for (const id of allIds) {
    const extracted = extractExtrasFolder(records[id]);
    if (extracted.present) {
      map.set(id, extracted.folder);
    }
  }
  return map;
}

/**
 * Returns the in-memory folder override map. Lazily loaded on first call,
 * refreshed after FOLDER_OVERRIDE_TTL_MS. Concurrent first-callers share a
 * single inflight promise.
 */
export async function getImageFolderOverrides(): Promise<FolderOverrideMap> {
  const now = Date.now();
  const isFresh = folderOverrideState.loadedAt > 0
    && now - folderOverrideState.loadedAt < FOLDER_OVERRIDE_TTL_MS;
  if (isFresh) {
    return folderOverrideState.map;
  }
  if (folderOverrideState.inflight) {
    return folderOverrideState.inflight;
  }
  const inflight = refreshFolderOverridesFromStorage()
    .then((map) => {
      folderOverrideState.map = map;
      folderOverrideState.loadedAt = Date.now();
      folderOverrideState.version += 1;
      return map;
    })
    .finally(() => {
      folderOverrideState.inflight = null;
    });
  folderOverrideState.inflight = inflight;
  return inflight;
}

/**
 * Synchronous accessor used by tests and diagnostics. Returns the current
 * map without triggering a load.
 */
export function getImageFolderOverridesSync(): FolderOverrideMap {
  return folderOverrideState.map;
}

/**
 * Version counter for the folder override map. Increments on every successful
 * load and on every mutation. Downstream caches that snapshot folder data
 * should include this in their cache keys to invalidate correctly.
 */
export function getImageFolderOverridesVersion(): number {
  return folderOverrideState.version;
}

function applyFolderOverrideUpdate(imageId: string, record: ImageExtrasRecord | null) {
  // If the cache has never been populated, skip updates -- the first read
  // will fetch a complete fresh copy from storage.
  if (folderOverrideState.loadedAt === 0) return;
  const extracted = extractExtrasFolder(record);
  if (!extracted.present) {
    folderOverrideState.map.delete(imageId);
  } else {
    folderOverrideState.map.set(imageId, extracted.folder);
  }
  folderOverrideState.version += 1;
}

export function invalidateImageFolderOverridesCache(): void {
  folderOverrideState.map = new Map();
  folderOverrideState.loadedAt = 0;
  folderOverrideState.inflight = null;
  folderOverrideState.version += 1;
}

export async function setImageExtrasRecord(record: ImageExtrasRecord): Promise<void> {
  const storage = getExtrasStorage();
  const sanitized = sanitizeImageExtrasRecord(record) ?? record;
  await storage.set(getImageExtrasKey(record.imageId), sanitized);
  applyFolderOverrideUpdate(record.imageId, sanitized);
}

export async function deleteImageExtrasRecord(imageId: string): Promise<void> {
  const storage = getExtrasStorage();
  await storage.delete(getImageExtrasKey(imageId));
  applyFolderOverrideUpdate(imageId, null);
}

export async function listImageExtrasImageIds(): Promise<string[]> {
  const storage = getExtrasStorage();
  const keys = await storage.listKeysByPrefix('image-extras:');
  return keys
    .filter((key) => key.startsWith('image-extras:'))
    .map((key) => key.slice('image-extras:'.length))
    .filter(Boolean);
}

export async function patchImageExtrasRecord(
  imageId: string,
  patch: Partial<Omit<ImageExtrasRecordV1, 'schemaVersion' | 'imageId' | 'createdAt' | 'updatedAt'>>
): Promise<ImageExtrasRecord> {
  const existing = await getImageExtrasRecord(imageId);
  const now = new Date().toISOString();

  const base: ImageExtrasRecordV1 = existing && existing.schemaVersion === 1
    ? (existing as ImageExtrasRecordV1)
    : {
        schemaVersion: 1,
        imageId,
        createdAt: now,
        updatedAt: now
      };

  const normalizedPatch = Object.prototype.hasOwnProperty.call(patch, 'exif')
    ? { ...patch, exif: sanitizeImageExifRecord(patch.exif) }
    : patch;

  const next: ImageExtrasRecordV1 = {
    ...base,
    ...normalizedPatch,
    schemaVersion: 1,
    imageId,
    createdAt: base.createdAt,
    updatedAt: now
  };

  await setImageExtrasRecord(next);
  return next;
}
