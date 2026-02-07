import sharp from 'sharp';
import exifReader from 'exif-reader';
import { inflateSync } from 'zlib';

export type ComfyMetadataDetection = {
  detected: boolean;
  source?: string;
  sources: string[];
};

type DetectComfyMetadataOptions = {
  mimeType?: string;
};

const COMFY_METADATA_KEYS = new Set([
  'prompt',
  'workflow',
  'comfyui_workflow',
  'comfy_workflow',
  'parameters',
]);

const MAX_JSON_CANDIDATE_BYTES = 2_000_000;

const looksLikeNodeMap = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  let validNodes = 0;
  for (const [, node] of entries.slice(0, 5)) {
    if (
      node &&
      typeof node === 'object' &&
      !Array.isArray(node) &&
      'class_type' in node &&
      'inputs' in node
    ) {
      validNodes += 1;
    }
  }
  return validNodes > 0;
};

const looksLikeComfyWorkflow = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;

  if (looksLikeNodeMap(obj)) return true;

  if ('prompt' in obj && looksLikeNodeMap(obj.prompt)) return true;
  if ('workflow' in obj && looksLikeComfyWorkflow(obj.workflow)) return true;

  // UI workflow shape often includes a "nodes" array.
  if (Array.isArray(obj.nodes) && obj.nodes.length > 0) return true;

  return false;
};

const safeParseJson = (value: string): unknown | null => {
  if (!value || value.length > MAX_JSON_CANDIDATE_BYTES) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractExifLikePayload = (value: string): { key: string; json: unknown } | null => {
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const key = value.slice(0, idx).trim().toLowerCase();
  if (!COMFY_METADATA_KEYS.has(key)) return null;
  const payload = value.slice(idx + 1).trim();
  if (!payload.startsWith('{') && !payload.startsWith('[')) return null;
  const parsed = safeParseJson(payload);
  if (!parsed) return null;
  return { key, json: parsed };
};

const maybeAddComfyEvidence = (
  key: string,
  value: string,
  sourcePrefix: string,
  sources: Set<string>
) => {
  const normalizedKey = key.trim().toLowerCase();
  if (!COMFY_METADATA_KEYS.has(normalizedKey)) return;
  const parsed = safeParseJson(value.trim());
  if (!parsed) return;
  if (!looksLikeComfyWorkflow(parsed)) return;
  sources.add(`${sourcePrefix}:${normalizedKey}`);
};

const walkStrings = (value: unknown, visit: (value: string) => void, depth = 0) => {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 64)) {
      walkStrings(entry, visit, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>).slice(0, 64)) {
      walkStrings(entry, visit, depth + 1);
    }
  }
};

const detectFromPngChunks = (buffer: Buffer, sources: Set<string>) => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) return;

  let offset = 8;

  const parseTextChunk = (data: Buffer) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const value = data.subarray(nullIdx + 1).toString('utf8');
    maybeAddComfyEvidence(key, value, 'png', sources);
  };

  const parseCompressedTextChunk = (data: Buffer) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0 || nullIdx + 2 > data.length) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const compressed = data.subarray(nullIdx + 2);
    try {
      const value = inflateSync(compressed).toString('utf8');
      maybeAddComfyEvidence(key, value, 'png', sources);
    } catch {
      // ignore malformed chunk
    }
  };

  const parseInternationalTextChunk = (data: Buffer) => {
    const keyEnd = data.indexOf(0x00);
    if (keyEnd <= 0 || keyEnd + 3 >= data.length) return;
    const key = data.subarray(0, keyEnd).toString('latin1');
    const compressed = data[keyEnd + 1] === 1;

    let cursor = keyEnd + 3; // compression flag + method
    const languageEnd = data.indexOf(0x00, cursor);
    if (languageEnd < 0) return;
    cursor = languageEnd + 1;

    const translatedEnd = data.indexOf(0x00, cursor);
    if (translatedEnd < 0) return;
    cursor = translatedEnd + 1;

    const textBytes = data.subarray(cursor);
    try {
      const value = (compressed ? inflateSync(textBytes) : textBytes).toString('utf8');
      maybeAddComfyEvidence(key, value, 'png', sources);
    } catch {
      // ignore malformed chunk
    }
  };

  const parseComfChunk = (data: Buffer) => {
    const nullIdx = data.indexOf(0x00);
    if (nullIdx <= 0) return;
    const key = data.subarray(0, nullIdx).toString('latin1');
    const value = data.subarray(nullIdx + 1).toString('latin1');
    maybeAddComfyEvidence(key, value, 'png-comf', sources);
  };

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (dataEnd > buffer.length || crcEnd > buffer.length) break;

    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (type === 'tEXt') parseTextChunk(chunkData);
    else if (type === 'zTXt') parseCompressedTextChunk(chunkData);
    else if (type === 'iTXt') parseInternationalTextChunk(chunkData);
    else if (type === 'comf') parseComfChunk(chunkData);

    offset = crcEnd;
    if (type === 'IEND') break;
  }
};

const detectFromSvgMetadata = (buffer: Buffer, sources: Set<string>) => {
  const text = buffer.toString('utf8');
  if (!text.includes('<svg') || !text.toLowerCase().includes('<metadata')) return;

  const metadataMatch = text.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!metadataMatch) return;

  const body = metadataMatch[1]
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .trim();
  if (!body) return;

  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return;

  const candidate = body.slice(firstBrace, lastBrace + 1);
  const parsed = safeParseJson(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  const payload = parsed as Record<string, unknown>;
  if (
    ('prompt' in payload && looksLikeComfyWorkflow(payload.prompt)) ||
    ('workflow' in payload && looksLikeComfyWorkflow(payload.workflow))
  ) {
    sources.add('svg:metadata');
  }
};

const detectFromExif = async (buffer: Buffer, sources: Set<string>) => {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return;
  }

  if (!metadata?.exif) return;

  try {
    const parsedExif = exifReader(metadata.exif);
    walkStrings(parsedExif, (value) => {
      const parsed = extractExifLikePayload(value);
      if (!parsed) return;
      if (!looksLikeComfyWorkflow(parsed.json)) return;
      sources.add(`exif:${parsed.key}`);
    });
  } catch {
    // ignore invalid EXIF payloads
  }
};

export const detectComfyMetadata = async (
  buffer: Buffer,
  options: DetectComfyMetadataOptions = {}
): Promise<ComfyMetadataDetection> => {
  const sources = new Set<string>();
  const mimeType = options.mimeType?.toLowerCase();

  const isSvg = mimeType?.includes('svg') || buffer.subarray(0, 256).toString('utf8').includes('<svg');
  if (isSvg) {
    detectFromSvgMetadata(buffer, sources);
  }

  const isPng = mimeType?.includes('png') || (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
  if (isPng) {
    detectFromPngChunks(buffer, sources);
  }

  await detectFromExif(buffer, sources);

  const sourceList = Array.from(sources);
  return {
    detected: sourceList.length > 0,
    source: sourceList[0],
    sources: sourceList,
  };
};
