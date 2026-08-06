import type { ImageExifRecord, ImageExtrasRecord } from './imageExtras';

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

