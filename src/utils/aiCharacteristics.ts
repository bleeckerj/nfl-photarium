import sharp from 'sharp';
import exifReader from 'exif-reader';
import { inflateSync } from 'node:zlib';
import { extractComfyWorkflowMetadata } from '@/utils/comfyMetadata';

export const AI_CHARACTERISTICS_SCANNER_VERSION = 'v1' as const;

export const AI_CHARACTERISTICS_SOURCES = ['ai-metadata', 'c2pa-jumbf'] as const;
export type AiCharacteristicsSource = (typeof AI_CHARACTERISTICS_SOURCES)[number];

export type AiCharacteristicsScanStatus = 'detected' | 'clear' | 'unsupported' | 'error';

export type AiCharacteristicsScan = {
  scannerVersion: typeof AI_CHARACTERISTICS_SCANNER_VERSION;
  status: AiCharacteristicsScanStatus;
  sources: AiCharacteristicsSource[];
  format?: string;
  error?: string;
};

const AI_METADATA_KEYS = new Set([
  'parameters',
  'postprocessing',
  'extras',
  'workflow',
  'prompt',
  'negative_prompt',
  'negative prompt',
  'dream',
  'sd:mode',
  'stablediffusionversion',
  'generation_time',
  'seed',
  'sampler',
  'cfg',
  'steps',
  'loras',
]);

const AI_SOFTWARE_VALUES = /(?:stable\s*diffusion|comfyui|midjourney|dall[\s-]?e|firefly|imagen|sora|chatgpt|openai)/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_METADATA_TEXT_BYTES = 2_000_000;

type MetadataText = { key: string; value: string };

const normalizeMetadataKey = (key: string) => key.trim().toLowerCase().replace(/[\s-]+/g, '_');

const hasAiMetadataField = (key: string, value: string): boolean => {
  const normalizedKey = normalizeMetadataKey(key);
  const normalizedValue = value.trim();
  if (!normalizedValue) return false;
  if (AI_METADATA_KEYS.has(normalizedKey) || AI_METADATA_KEYS.has(key.trim().toLowerCase())) {
    return true;
  }
  return /^(software|creator_tool|creator|generator|application)$/i.test(key.trim()) && AI_SOFTWARE_VALUES.test(normalizedValue);
};

const hasAiMetadataTexts = (texts: MetadataText[]): boolean =>
  texts.some(({ key, value }) => hasAiMetadataField(key, value));

const decodeText = (value: Buffer): string => value.toString('utf8').replace(/\u0000/g, '').trim();

const readPngTextChunks = (buffer: Buffer): { texts: MetadataText[]; hasC2pa: boolean } => {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { texts: [], hasC2pa: false };
  }

  const texts: MetadataText[] = [];
  let hasC2pa = false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (length > MAX_METADATA_TEXT_BYTES || chunkEnd > buffer.length) break;
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'caBX' && data.length > 0) hasC2pa = true;
    if (type === 'tEXt') {
      const split = data.indexOf(0);
      if (split > 0) texts.push({ key: decodeText(data.subarray(0, split)), value: decodeText(data.subarray(split + 1)) });
    } else if (type === 'zTXt') {
      const split = data.indexOf(0);
      if (split > 0 && data.length > split + 2) {
        try {
          texts.push({
            key: decodeText(data.subarray(0, split)),
            value: inflateSync(data.subarray(split + 2)).toString('utf8').trim(),
          });
        } catch {
          // Malformed compressed metadata is ignored; the image remains viewable.
        }
      }
    } else if (type === 'iTXt') {
      const keyEnd = data.indexOf(0);
      if (keyEnd > 0 && data.length > keyEnd + 2) {
        let cursor = keyEnd + 3;
        const languageEnd = data.indexOf(0, cursor);
        if (languageEnd >= 0) {
          cursor = languageEnd + 1;
          const translatedEnd = data.indexOf(0, cursor);
          if (translatedEnd >= 0) {
            cursor = translatedEnd + 1;
            const value = data[keyEnd + 1] === 1
              ? (() => {
                  try { return inflateSync(data.subarray(cursor)).toString('utf8').trim(); } catch { return ''; }
                })()
              : decodeText(data.subarray(cursor));
            texts.push({ key: decodeText(data.subarray(0, keyEnd)), value });
          }
        }
      }
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  return { texts, hasC2pa };
};

const readJpegSegments = (buffer: Buffer): { texts: MetadataText[]; hasC2pa: boolean } => {
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return { texts: [], hasC2pa: false };
  const texts: MetadataText[] = [];
  let hasC2pa = false;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    const segmentEnd = offset + length;
    if (length < 2 || segmentEnd > buffer.length) break;
    const payload = buffer.subarray(offset + 2, segmentEnd);
    if (marker === 0xeb && /(?:c2pa|jumb(?:f)?|content.?credentials)/i.test(payload.toString('latin1'))) {
      hasC2pa = true;
    }
    if (marker === 0xe1) {
      const text = payload.toString('utf8');
      const xmpStart = text.indexOf('http://ns.adobe.com/xap/1.0/');
      if (xmpStart >= 0) texts.push(...extractStructuredMetadataTexts(text.slice(xmpStart)));
    }
    offset = segmentEnd;
  }
  return { texts, hasC2pa };
};

const readWebpChunks = (buffer: Buffer): { texts: MetadataText[]; hasC2pa: boolean } => {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return { texts: [], hasC2pa: false };
  }
  const texts: MetadataText[] = [];
  let hasC2pa = false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) break;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'C2PA' && data.length > 0) hasC2pa = true;
    if (type === 'XMP ') texts.push(...extractStructuredMetadataTexts(data.toString('utf8')));
    offset = dataEnd + (length % 2);
  }
  return { texts, hasC2pa };
};

const extractStructuredMetadataTexts = (value: string): MetadataText[] => {
  if (value.length > MAX_METADATA_TEXT_BYTES) return [];
  const entries: MetadataText[] = [];
  const attributePattern = /([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*["']([^"']*)["']/g;
  for (const match of value.matchAll(attributePattern)) {
    entries.push({ key: match[1], value: match[2] });
  }
  const elementPattern = /<([A-Za-z][A-Za-z0-9:_-]*)\b[^>]*>\s*([^<]+?)\s*<\//g;
  for (const match of value.matchAll(elementPattern)) {
    entries.push({ key: match[1], value: match[2] });
  }
  return entries;
};

const readSvgMetadata = (buffer: Buffer): MetadataText[] => {
  const source = buffer.toString('utf8');
  const metadata = source.match(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/i)?.[0];
  return metadata ? extractStructuredMetadataTexts(metadata) : [];
};

const readExifTexts = async (buffer: Buffer): Promise<MetadataText[]> => {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) return [];
    const parsed = exifReader(metadata.exif) as unknown;
    const texts: MetadataText[] = [];
    const visit = (value: unknown, key = '') => {
      if (typeof value === 'string' || typeof value === 'number') {
        if (key) texts.push({ key, value: String(value) });
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 64).forEach((entry) => visit(entry, key));
        return;
      }
      if (value && typeof value === 'object') {
        Object.entries(value as Record<string, unknown>).slice(0, 128).forEach(([childKey, child]) => visit(child, childKey));
      }
    };
    visit(parsed);
    return texts;
  } catch {
    return [];
  }
};

const detectFormat = (buffer: Buffer, mimeType?: string): string | undefined => {
  const mime = mimeType?.toLowerCase();
  if (mime?.includes('svg') || buffer.subarray(0, 256).toString('utf8').includes('<svg')) return 'svg';
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (mime?.includes('avif') || mime?.includes('heic') || mime?.includes('heif')) return 'unsupported';
  return mime?.split(';')[0]?.replace('image/', '') || undefined;
};

export async function scanAiCharacteristics(buffer: Buffer, options: { mimeType?: string } = {}): Promise<AiCharacteristicsScan> {
  const format = detectFormat(buffer, options.mimeType);
  if (!format) {
    return { scannerVersion: AI_CHARACTERISTICS_SCANNER_VERSION, status: 'error', sources: [], error: 'Unrecognized image format' };
  }
  if (format === 'unsupported') {
    return { scannerVersion: AI_CHARACTERISTICS_SCANNER_VERSION, status: 'unsupported', sources: [], format };
  }

  try {
    let texts: MetadataText[] = [];
    let hasC2pa = false;
    if (format === 'png') ({ texts, hasC2pa } = readPngTextChunks(buffer));
    if (format === 'jpeg') ({ texts, hasC2pa } = readJpegSegments(buffer));
    if (format === 'webp') ({ texts, hasC2pa } = readWebpChunks(buffer));
    if (format === 'svg') texts = readSvgMetadata(buffer);
    texts = [...texts, ...(await readExifTexts(buffer))];

    const sources = new Set<AiCharacteristicsSource>();
    if (hasAiMetadataTexts(texts)) sources.add('ai-metadata');
    if ((await extractComfyWorkflowMetadata(buffer, { mimeType: options.mimeType })).detected) {
      sources.add('ai-metadata');
    }
    if (hasC2pa) sources.add('c2pa-jumbf');
    const sourceList = Array.from(sources);
    return {
      scannerVersion: AI_CHARACTERISTICS_SCANNER_VERSION,
      status: sourceList.length > 0 ? 'detected' : 'clear',
      sources: sourceList,
      format,
    };
  } catch (error) {
    return {
      scannerVersion: AI_CHARACTERISTICS_SCANNER_VERSION,
      status: 'error',
      sources: [],
      format,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type AiCharacteristicsEvidenceBasis = 'uploaded-source' | 'persisted-bytes' | 'hosted-original';

export type AiCharacteristicsRecord = {
  schemaVersion: 1;
  scannerVersion: typeof AI_CHARACTERISTICS_SCANNER_VERSION;
  status: AiCharacteristicsScanStatus;
  sources: AiCharacteristicsSource[];
  evidenceBases: AiCharacteristicsEvidenceBasis[];
  scannedAt: string;
  format?: string;
  error?: string;
};

export function combineAiCharacteristicScans(
  scans: Array<{ scan: AiCharacteristicsScan; evidenceBasis: AiCharacteristicsEvidenceBasis }>,
  scannedAt = new Date().toISOString()
): AiCharacteristicsRecord {
  const sources = Array.from(new Set(scans.flatMap(({ scan }) => scan.sources)));
  const detected = sources.length > 0;
  const hasError = scans.some(({ scan }) => scan.status === 'error');
  const allUnsupported = scans.length > 0 && scans.every(({ scan }) => scan.status === 'unsupported');
  const status: AiCharacteristicsScanStatus = detected
    ? 'detected'
    : hasError
      ? 'error'
      : allUnsupported
        ? 'unsupported'
        : 'clear';
  const evidenceBases = Array.from(new Set(
    scans
      .filter(({ scan }) => scan.status === 'detected')
      .map(({ evidenceBasis }) => evidenceBasis)
  ));
  const firstDetected = scans.find(({ scan }) => scan.status === 'detected')?.scan;
  return {
    schemaVersion: 1,
    scannerVersion: AI_CHARACTERISTICS_SCANNER_VERSION,
    status,
    sources,
    evidenceBases: evidenceBases.length
      ? evidenceBases
      : [scans[0]?.evidenceBasis ?? 'persisted-bytes'],
    scannedAt,
    format: firstDetected?.format ?? scans[0]?.scan.format,
    error: scans.find(({ scan }) => scan.error)?.scan.error,
  };
}
