import sharp from 'sharp';
import exifReader from 'exif-reader';

export type ExifSummary = Record<string, string | number>;

const isByteArray = (value: unknown): value is number[] => {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (value.length > 64) return value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);
  const numericRatio = value.reduce((count, entry) => {
    return count + (Number.isInteger(entry) && entry >= 0 && entry <= 255 ? 1 : 0);
  }, 0) / value.length;
  return numericRatio >= 0.95;
};

const maybeBytesFromNumericObject = (value: unknown): Uint8Array | null => {
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
};

const decodeAscii = (bytes: Uint8Array): string | undefined => {
  const chars: string[] = [];
  for (const b of bytes) {
    if (b === 0) break;
    chars.push(String.fromCharCode(b));
  }
  const text = chars.join('').trim();
  return text || undefined;
};

const decodeUtf16 = (bytes: Uint8Array, littleEndian: boolean): string | undefined => {
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
};

const decodeUserComment = (bytes: Uint8Array): string | undefined => {
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
};

const decodePrintableText = (bytes: Uint8Array): string | undefined => {
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
  if (chars.length === 0) return undefined;
  if (printable / chars.length < 0.9) return undefined;
  const text = chars.join('').trim();
  return text || undefined;
};

const decodeExifBytes = (bytes: Uint8Array): string | undefined => {
  return decodeUserComment(bytes) || decodePrintableText(bytes);
};

const formatExifValue = (value: unknown): string | number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return decodeExifBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    if (isByteArray(value)) {
      return decodeExifBytes(Uint8Array.from(value));
    }
    const cleaned = value.map((entry) => formatExifValue(entry)).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : undefined;
  }
  if (typeof value === 'object') {
    const byteObject = maybeBytesFromNumericObject(value);
    if (byteObject) {
      return decodeExifBytes(byteObject);
    }
    const maybeRational = value as { numerator?: number; denominator?: number };
    if (
      typeof maybeRational.numerator === 'number' &&
      typeof maybeRational.denominator === 'number' &&
      maybeRational.denominator !== 0
    ) {
      return `${maybeRational.numerator}/${maybeRational.denominator}`;
    }
    const asString = (value as { toString?: () => string }).toString?.();
    return asString && asString !== '[object Object]' ? asString : undefined;
  }
  return undefined;
};

const addValue = (
  summary: ExifSummary,
  key: string,
  value: unknown
) => {
  const formatted = formatExifValue(value);
  if (formatted !== undefined && formatted !== '') {
    summary[key] = formatted;
  }
};

export const extractExifSummary = async (buffer: Buffer): Promise<ExifSummary | undefined> => {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) {
      return undefined;
    }
    const parsed = exifReader(metadata.exif);
    const summary: ExifSummary = {};
    addValue(summary, 'make', parsed?.Image?.Make);
    addValue(summary, 'model', parsed?.Image?.Model);
    addValue(summary, 'lens', parsed?.Photo?.LensModel || parsed?.Photo?.LensSpecification);
    addValue(summary, 'dateTimeOriginal', parsed?.Photo?.DateTimeOriginal);
    addValue(summary, 'exposureTime', parsed?.Photo?.ExposureTime);
    addValue(summary, 'fNumber', parsed?.Photo?.FNumber);
    addValue(summary, 'iso', parsed?.Photo?.ISOSpeedRatings || parsed?.Photo?.PhotographicSensitivity);
    addValue(summary, 'focalLength', parsed?.Photo?.FocalLength);
    const parsedRecord = parsed as Record<string, unknown>;
    const exifSection = parsedRecord.Exif as Record<string, unknown> | undefined;
    addValue(summary, 'userComment', exifSection?.UserComment || parsed?.Photo?.UserComment);
    return Object.keys(summary).length ? summary : undefined;
  } catch (error) {
    console.warn('Failed to extract EXIF data:', error);
    return undefined;
  }
};
