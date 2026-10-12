import { createHash } from 'node:crypto';

export const MAX_RECEIPT_BYTES = 1_000_000;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export class ProvenanceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type ReceiptOutput = { sha256: string; bytes: number; dimensions: [number, number] };
export type ValidatedReceipt = {
  json: string;
  receiptId: string;
  model: string;
  provider: string;
  createdAt: string;
  requestId?: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  outputs: ReceiptOutput[];
  sourceImageIds: string[];
};

function assertSafe(value: unknown, depth = 0): void {
  if (depth > 25) throw new ProvenanceError('Receipt nesting exceeds the limit');
  if (typeof value === 'string' && /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|\bBearer\s+\S{12,}|[?&](?:token|key|signature|auth)=/i.test(value)) {
    throw new ProvenanceError('Receipt contains credential-like data');
  }
  if (Array.isArray(value)) { value.forEach((entry) => assertSafe(entry, depth + 1)); return; }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:api_?key|api_?token|authorization|password|secret|access_?token|refresh_?token|b64_json|base64|environment|headers)$/i.test(key)) {
      throw new ProvenanceError('Receipt contains a forbidden field');
    }
    assertSafe(entry, depth + 1);
  }
}

const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
export const receiptText = text;

export function validateReceipt(input: unknown): ValidatedReceipt {
  const json = typeof input === 'string' ? input : JSON.stringify(input);
  if (!json || Buffer.byteLength(json) > MAX_RECEIPT_BYTES) throw new ProvenanceError('Receipt is missing or exceeds 1 MB');
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new ProvenanceError('Receipt must be valid JSON'); }
  assertSafe(raw);
  if (!isRecord(raw) || raw.schema_version !== 1) throw new ProvenanceError('Unsupported provenance receipt schema');
  const model = text(raw.model);
  const createdAt = text(raw.created_at);
  if (!model || !createdAt || !Number.isFinite(Date.parse(createdAt)) || !isRecord(raw.request)) {
    throw new ProvenanceError('Receipt requires model, creation date, and request settings');
  }
  if (raw.request.model !== undefined && raw.request.model !== model) throw new ProvenanceError('Receipt model conflicts with request model');
  if (!text(raw.request.prompt)) throw new ProvenanceError('Receipt requires the final generation prompt');
  if (!Array.isArray(raw.outputs) || !raw.outputs.length || raw.outputs.length > 10) throw new ProvenanceError('Receipt requires 1 to 10 outputs');
  const outputs = raw.outputs.map((output): ReceiptOutput => {
    if (!isRecord(output) || typeof output.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(output.sha256)
      || typeof output.bytes !== 'number' || !Number.isSafeInteger(output.bytes) || output.bytes < 1
      || !Array.isArray(output.dimensions) || output.dimensions.length !== 2
      || !output.dimensions.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0)) {
      throw new ProvenanceError('Invalid receipt output hash, byte count, or dimensions');
    }
    return { sha256: output.sha256, bytes: output.bytes, dimensions: [Number(output.dimensions[0]), Number(output.dimensions[1])] };
  });
  const sources = raw.source_images ?? [];
  if (!Array.isArray(sources) || sources.length > 16) throw new ProvenanceError('Invalid receipt sources');
  for (const source of sources) {
    if (!isRecord(source) || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
      || typeof source.bytes !== 'number' || !Number.isSafeInteger(source.bytes) || source.bytes < 1
      || !Array.isArray(source.dimensions) || source.dimensions.length !== 2
      || !source.dimensions.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0)) {
      throw new ProvenanceError('Invalid receipt source hash, byte count, or dimensions');
    }
  }
  const sourceImageIds = sources.flatMap((source) => isRecord(source) && typeof source.imageId === 'string' ? [source.imageId] : []);
  return {
    json, receiptId: sha256(json), model, createdAt, outputs, sourceImageIds,
    provider: text(raw.provider) ?? (typeof raw.api_base === 'string' && raw.api_base.startsWith('https://api.openai.com/') ? 'openai' : 'unavailable'),
    requestId: text(raw.request_id), request: raw.request, response: isRecord(raw.api_response) ? raw.api_response : {},
  };
}

export function selectReceiptOutput(receipt: ValidatedReceipt, bytes: Buffer): number {
  const hash = sha256(bytes);
  const index = receipt.outputs.findIndex((output) => output.sha256 === hash && output.bytes === bytes.length);
  if (index < 0) throw new ProvenanceError('Receipt output does not match image bytes', 409);
  return index;
}
