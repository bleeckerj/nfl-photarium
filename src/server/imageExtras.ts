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

export type ImageExtrasRecordV1 = {
  schemaVersion: 1;
  imageId: string;

  /**
   * Freeform descriptive fields that can be larger than Cloudflare metadata limits.
   *
   * NOTE: Keep namespace/folder/tags in Cloudflare metadata for filtering.
   */
  description?: string;
  altText?: string;

  /** Prompt This (generated prompt for recreating the image). */
  promptThis?: PromptThisEntry;

  /** Comfy workflow intelligence for semantic retrieval and diagnostics. */
  comfyWorkflow?: ComfyWorkflowEntry;

  /** Durable pointer to the original local/raw source file. */
  rawSource?: RawSourceReference;

  /** Structured EXIF payload for search/audit and downstream workflows. */
  exif?: ImageExifRecord;

  /** DNG ingest bookkeeping for generated preview artifacts. */
  dngIngest?: DngIngestRecord;

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
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) return null;
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
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();

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

export async function setImageExtrasRecord(record: ImageExtrasRecord): Promise<void> {
  const storage = getExtrasStorage();
  await storage.set(
    getImageExtrasKey(record.imageId),
    sanitizeImageExtrasRecord(record) ?? record
  );
}

export async function deleteImageExtrasRecord(imageId: string): Promise<void> {
  const storage = getExtrasStorage();
  await storage.delete(getImageExtrasKey(imageId));
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
