import path from 'node:path';
import { mimeTypeForPath } from './media.js';
import type { PhotariumClient, PhotariumUploadResult } from './types.js';
import { extractImageId } from './photarium-client.js';

type FetchLike = typeof fetch;

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
    form.append('file', new Blob([bytes], { type: mimeTypeForPath(filePath) }), path.basename(filePath));
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

  async uploadVideoFromPath(filePath: string, namespace: string, tags: string[]): Promise<PhotariumUploadResult> {
    const bytes = await (await import('node:fs/promises')).readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeTypeForPath(filePath) }), path.basename(filePath));
    form.append('namespace', namespace);
    if (tags.length > 0) form.append('tags', tags.join(','));
    const payload = await readResponse(await this.fetchImpl(`${this.baseUrl}/api/import/page/upload-video`, {
      method: 'POST',
      body: form,
    }));
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const videoId = typeof record.id === 'string' ? record.id : undefined;
    if (!videoId) throw new Error('Video upload response did not include an asset ID.');
    return { assetType: 'video', imageId: videoId, videoId };
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
