import path from 'node:path';
import type { PhotariumClient, PhotariumUploadResult } from './types.js';
import { extractImageId } from './photarium-client.js';

type FetchLike = typeof fetch;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
};

function mimeForPath(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) as unknown : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as Record<string, unknown>).error
      : `Photarium request failed (${response.status})`;
    throw new Error(typeof detail === 'string' ? detail : `Photarium request failed (${response.status})`);
  }
  return payload;
}

export class HttpPhotariumClient implements PhotariumClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async connect(): Promise<void> {
    // HTTP has no persistent session to initialize.
  }

  async uploadFromPath(filePath: string, namespace: string, tags: string[], semanticTagCount?: number): Promise<PhotariumUploadResult> {
    const bytes = await (await import('node:fs/promises')).readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeForPath(filePath) }), path.basename(filePath));
    form.append('namespace', namespace);
    if (tags.length > 0) form.append('tags', tags.join(','));
    if (semanticTagCount !== undefined) form.append('semanticTagCount', String(semanticTagCount));
    const payload = await readResponse(await this.fetchImpl(`${this.baseUrl}/api/upload`, {
      method: 'POST',
      body: form,
    }));
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const tagging = record.semanticTagging && typeof record.semanticTagging === 'object'
      ? record.semanticTagging as { jobId?: unknown; state?: unknown; error?: unknown }
      : undefined;
    return {
      imageId: extractImageId(payload),
      ...(tagging && typeof tagging.jobId === 'string' && typeof tagging.state === 'string'
        ? { semanticTagging: { jobId: tagging.jobId, state: tagging.state, ...(typeof tagging.error === 'string' ? { error: tagging.error } : {}) } }
        : {}),
    };
  }

  async generateDescription(imageId: string): Promise<void> {
    await readResponse(await this.fetchImpl(`${this.baseUrl}/api/images/${encodeURIComponent(imageId)}/description`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
  }

  async getSemanticTagStatus(jobId: string): Promise<{ state: string; error?: string }> {
    const payload = await readResponse(await this.fetchImpl(`${this.baseUrl}/api/images/tag-enrichment/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    }));
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return {
      state: typeof record.state === 'string' ? record.state : 'unknown',
      ...(typeof record.error === 'string' ? { error: record.error } : {}),
    };
  }

  async close(): Promise<void> {
    // HTTP has no child process to close.
  }
}
