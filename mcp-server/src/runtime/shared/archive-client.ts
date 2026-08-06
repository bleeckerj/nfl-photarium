const ARCHIVE_BASE_URL = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';

async function archiveRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ARCHIVE_BASE_URL}${endpoint}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`Archive catalog error (${response.status}): ${await response.text()}`);
  return await response.json() as T;
}

export interface ArchivePreviewResponse {
  data: string;
  mimeType: string;
}

export function archiveJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return archiveRequest<T>(endpoint, options);
}

export async function archivePreview(assetId: string): Promise<ArchivePreviewResponse> {
  const response = await fetch(`${ARCHIVE_BASE_URL}/assets/${encodeURIComponent(assetId)}/preview`);
  if (!response.ok) throw new Error(`Archive preview error (${response.status}): ${await response.text()}`);
  return { data: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' };
}
