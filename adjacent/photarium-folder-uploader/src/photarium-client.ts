import type { PhotariumClient } from './types.js';

export function extractJsonFromToolResult(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content.find((item): item is Record<string, unknown> => {
      return Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text');
    });
    if (text && typeof text.text === 'string') {
      try {
        return JSON.parse(text.text) as unknown;
      } catch {
        return text.text;
      }
    }
  }
  return value;
}

export function extractImageId(value: unknown): string {
  const parsed = extractJsonFromToolResult(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Photarium response did not contain an image ID.');
  const record = parsed as Record<string, unknown>;
  const candidates: unknown[] = [
    record.id,
    record.imageId,
    record.result && typeof record.result === 'object' ? (record.result as Record<string, unknown>).id : undefined,
    record.image && typeof record.image === 'object' ? (record.image as Record<string, unknown>).id : undefined,
  ];
  const imageId = candidates.find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()));
  if (!imageId) throw new Error('Photarium response did not contain an image ID.');
  return imageId;
}

export function assertToolSucceeded(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.isError === true) {
    const parsed = extractJsonFromToolResult(value);
    const detail = parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).error === 'string'
      ? (parsed as Record<string, unknown>).error
      : 'Photarium MCP tool failed.';
    throw new Error(typeof detail === 'string' ? detail : 'Photarium MCP tool failed.');
  }
}

export async function closeClient(client: PhotariumClient): Promise<void> {
  await client.close().catch(() => undefined);
}
