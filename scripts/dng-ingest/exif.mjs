import sharp from "sharp";
import exifReader from "exif-reader";

function safeJsonValue(value, depth = 0) {
  if (depth > 8) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return value.toString();
  if (ArrayBuffer.isView(value)) {
    return summarizeBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    if (isByteArray(value)) {
      return summarizeBytes(Uint8Array.from(value));
    }
    return value.map((item) => safeJsonValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (t === "object") {
    const byteObject = maybeBytesFromNumericObject(value);
    if (byteObject) {
      return summarizeBytes(byteObject);
    }
    const record = {};
    for (const [k, v] of Object.entries(value)) {
      const parsed = safeJsonValue(v, depth + 1);
      if (parsed !== undefined) record[k] = parsed;
    }
    return record;
  }
  return undefined;
}

function isByteArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (value.length > 64) return value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);
  const numericRatio = value.reduce((count, entry) => {
    return count + (Number.isInteger(entry) && entry >= 0 && entry <= 255 ? 1 : 0);
  }, 0) / value.length;
  return numericRatio >= 0.95;
}

function maybeBytesFromNumericObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
  const keys = Object.keys(value);
  if (keys.length < 16) return null;
  if (!keys.every((key) => /^\d+$/.test(key))) return null;

  const sorted = keys.map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i) return null;
  }

  const bytes = new Uint8Array(sorted.length);
  for (const idx of sorted) {
    const raw = value[idx];
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) return null;
    bytes[idx] = raw;
  }
  return bytes;
}

function decodeUserComment(bytes) {
  if (bytes.length < 8) return undefined;
  const marker = String.fromCharCode(...bytes.slice(0, 8));
  const payload = bytes.slice(8);

  if (marker === "ASCII\u0000\u0000\u0000") {
    return decodeAscii(payload);
  }
  if (marker.startsWith("UNICODE")) {
    const be = decodeUtf16(payload, false);
    const le = decodeUtf16(payload, true);
    if (be && le) return be.length >= le.length ? be : le;
    return be || le || undefined;
  }
  if (marker.startsWith("JIS")) {
    return undefined;
  }
  return undefined;
}

function decodeAscii(bytes) {
  const chars = [];
  for (const b of bytes) {
    if (b === 0) break;
    chars.push(String.fromCharCode(b));
  }
  const text = chars.join("").trim();
  return text || undefined;
}

function decodeUtf16(bytes, littleEndian) {
  const evenLength = bytes.length - (bytes.length % 2);
  if (evenLength <= 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength);
  const codeUnits = [];
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

function decodePrintableText(bytes) {
  const trimmed = bytes.slice(0, 4096);
  const chars = [];
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
  const text = chars.join("").trim();
  return text || undefined;
}

function summarizeBytes(bytes) {
  const decodedUserComment = decodeUserComment(bytes);
  const decodedText = decodedUserComment || decodePrintableText(bytes);
  const previewBytes = Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0"));

  return {
    _type: "bytes",
    length: bytes.length,
    preview_hex: previewBytes.join(" "),
    ...(decodedText ? { decoded_text: decodedText } : {}),
  };
}

function analyzeExifTree(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return { keys: 0, byteBlobs: 0 };
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (acc, item) => {
        const next = analyzeExifTree(item, depth + 1);
        return {
          keys: acc.keys + next.keys,
          byteBlobs: acc.byteBlobs + next.byteBlobs,
        };
      },
      { keys: 0, byteBlobs: 0 }
    );
  }

  if (value._type === "bytes") {
    return { keys: 1, byteBlobs: 1 };
  }

  let keys = 0;
  let byteBlobs = 0;
  for (const [k, v] of Object.entries(value)) {
    keys += 1;
    const next = analyzeExifTree(v, depth + 1);
    keys += next.keys;
    byteBlobs += next.byteBlobs;
    if (k === "UserComment" && v && typeof v === "object" && v._type === "bytes") {
      byteBlobs += 0;
    }
  }
  return { keys, byteBlobs };
}

export function buildExifLogLines(exif) {
  const lines = [];
  if (!exif || typeof exif !== "object") return lines;

  if (typeof exif.parseError === "string") {
    lines.push(`parseError: ${exif.parseError}`);
  }

  if (exif.summary && typeof exif.summary === "object" && !Array.isArray(exif.summary)) {
    const summaryEntries = Object.entries(exif.summary).slice(0, 10);
    if (summaryEntries.length) {
      const summaryText = summaryEntries
        .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
        .join(" | ");
      lines.push(`summary: ${summaryText}`);
    }
  }

  if (exif.sharp && typeof exif.sharp === "object" && !Array.isArray(exif.sharp)) {
    const format = typeof exif.sharp.format === "string" ? exif.sharp.format : "?";
    const width = typeof exif.sharp.width === "number" ? exif.sharp.width : "?";
    const height = typeof exif.sharp.height === "number" ? exif.sharp.height : "?";
    const depth = typeof exif.sharp.depth === "string" ? exif.sharp.depth : "?";
    lines.push(`sharp: format=${format} dimensions=${width}x${height} depth=${depth}`);
  }

  if (exif.parsed && typeof exif.parsed === "object" && !Array.isArray(exif.parsed)) {
    const sections = Object.keys(exif.parsed);
    const stats = analyzeExifTree(exif.parsed);
    lines.push(
      `parsed: sections=${sections.length} keys=${stats.keys} byteBlobs=${stats.byteBlobs} (${sections.slice(0, 8).join(", ")}${sections.length > 8 ? ", ..." : ""})`
    );
  }

  if (!lines.length) {
    const raw = JSON.stringify(exif);
    lines.push(raw.length > 400 ? `${raw.slice(0, 400)}...` : raw);
  }
  return lines;
}

function formatExifValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    const cleaned = value.map((entry) => formatExifValue(entry)).filter(Boolean);
    return cleaned.length ? cleaned.join(", ") : undefined;
  }
  if (typeof value === "object") {
    if (
      Object.prototype.hasOwnProperty.call(value, "numerator") &&
      Object.prototype.hasOwnProperty.call(value, "denominator") &&
      typeof value.numerator === "number" &&
      typeof value.denominator === "number" &&
      value.denominator !== 0
    ) {
      return `${value.numerator}/${value.denominator}`;
    }
    const asString = value.toString?.();
    return asString && asString !== "[object Object]" ? asString : undefined;
  }
  return undefined;
}

function addExif(summary, key, value) {
  const formatted = formatExifValue(value);
  if (formatted !== undefined && formatted !== "") summary[key] = formatted;
}

export async function extractExifDetails(filePath) {
  try {
    const metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
    let parsedExif;
    if (metadata.exif) {
      parsedExif = exifReader(metadata.exif);
    }
    const summary = {};
    addExif(summary, "make", parsedExif?.Image?.Make);
    addExif(summary, "model", parsedExif?.Image?.Model);
    addExif(summary, "lens", parsedExif?.Photo?.LensModel || parsedExif?.Photo?.LensSpecification);
    addExif(summary, "dateTimeOriginal", parsedExif?.Photo?.DateTimeOriginal);
    addExif(summary, "exposureTime", parsedExif?.Photo?.ExposureTime);
    addExif(summary, "fNumber", parsedExif?.Photo?.FNumber);
    addExif(summary, "iso", parsedExif?.Photo?.ISOSpeedRatings || parsedExif?.Photo?.PhotographicSensitivity);
    addExif(summary, "focalLength", parsedExif?.Photo?.FocalLength);

    const sharpSummary = safeJsonValue({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      space: metadata.space,
      channels: metadata.channels,
      depth: metadata.depth,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha,
      orientation: metadata.orientation,
      isProgressive: metadata.isProgressive,
      pages: metadata.pages,
      pagePrimary: metadata.pagePrimary,
      compression: metadata.compression,
      resolutionUnit: metadata.resolutionUnit,
    });

    const out = {};
    if (Object.keys(summary).length > 0) out.summary = summary;
    if (parsedExif) out.parsed = safeJsonValue(parsedExif);
    if (sharpSummary && Object.keys(sharpSummary).length > 0) out.sharp = sharpSummary;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}
