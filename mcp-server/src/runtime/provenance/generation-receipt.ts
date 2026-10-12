import { createHash } from 'node:crypto';
import sharp from 'sharp';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function safeImageResponse(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    created: raw.created, size: raw.size, quality: raw.quality, background: raw.background,
    output_format: raw.output_format, usage: raw.usage,
    data: Array.isArray(raw.data) ? raw.data.map((entry) => ({ generation_id: object(entry).generation_id })) : [],
  };
}

export async function createGenerationReceipt(options: {
  base64: string;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  requestId?: string;
  apiBase?: string;
  sourceImages?: Array<{ bytes: Buffer; provenance: Record<string, unknown> }>;
}): Promise<string> {
  const bytes = Buffer.from(options.base64, 'base64');
  const dimensions = await sharp(bytes).metadata();
  if (!dimensions.width || !dimensions.height) throw new Error('Generation output dimensions are unavailable');
  const sources = await Promise.all((options.sourceImages ?? []).map(async (source, index) => {
    const metadata = await sharp(source.bytes).metadata();
    return { index: index + 1, imageId: source.provenance.imageId, sha256: hash(source.bytes), bytes: source.bytes.length, dimensions: [metadata.width, metadata.height] };
  }));
  const request = Object.fromEntries(['model', 'prompt', 'size', 'quality', 'background', 'output_format'].map((key) => [key, options.request[key]]));
  return JSON.stringify({
    schema_version: 1, provider: 'openai', api_base: options.apiBase ?? 'https://api.openai.com/v1',
    endpoint: sources.length ? '/v1/images/edits' : '/v1/images/generations',
    model: options.request.model, created_at: new Date().toISOString(), request_id: options.requestId,
    request, api_response: options.response, source_images: sources,
    outputs: [{ bytes: bytes.length, sha256: hash(bytes), dimensions: [dimensions.width, dimensions.height] }],
  });
}
