import { apiRequest } from '../shared/api-client.js';

export async function getVectorStatus(): Promise<{
  available: boolean;
  stats?: {
    totalImages: number;
    withClipEmbedding: number;
    withColorEmbedding: number;
    clipProgress: string;
    colorProgress: string;
  };
  needsEmbedding?: number;
}> {
  return apiRequest('/api/images/vectors/status');
}

export async function generateEmbeddings(
  imageId: string,
  options: { clip?: boolean; color?: boolean; force?: boolean } = {}
): Promise<{
  imageId: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
  clipGenerated?: boolean;
  colorGenerated?: boolean;
  skipped?: boolean;
}> {
  return apiRequest(`/api/images/${imageId}/embeddings`, {
    method: 'POST',
    body: JSON.stringify({
      clip: options.clip !== false,
      color: options.color !== false,
      force: options.force === true,
    }),
  });
}

export async function getEmbeddingStatus(imageId: string): Promise<{
  imageId: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
  dominantColors?: string[];
  averageColor?: string;
}> {
  return apiRequest(`/api/images/${imageId}/embeddings`);
}

export async function batchGenerateEmbeddings(options: {
  imageIds: string[];
  clip?: boolean;
  color?: boolean;
  force?: boolean;
}): Promise<{
  total: number;
  success: number;
  skipped: number;
  errors: number;
  results: Array<{
    imageId: string;
    success: boolean;
    clipGenerated?: boolean;
    colorGenerated?: boolean;
    skipped?: boolean;
    error?: string;
  }>;
}> {
  return apiRequest('/api/images/embeddings/batch', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function ensureVectorIndex(): Promise<{ success: boolean; message?: string }> {
  return apiRequest('/api/images/vectors/status', { method: 'POST' });
}

export async function getColorsBulk(imageIds: string[]): Promise<Record<string, {
  dominantColors?: string[];
  averageColor?: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
}>> {
  const params = new URLSearchParams();
  params.set('ids', imageIds.join(','));
  const data = await apiRequest<{ colors: Record<string, {
    dominantColors?: string[];
    averageColor?: string;
    hasClipEmbedding: boolean;
    hasColorEmbedding: boolean;
  }> }>(`/api/images/colors?${params}`);
  return data.colors;
}

export async function auditImages(options: {
  refresh?: boolean;
  limit?: number;
  offset?: number;
  concurrency?: number;
  variant?: string;
  verbose?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', '1');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.concurrency !== undefined) params.set('concurrency', String(options.concurrency));
  if (options.variant) params.set('variant', options.variant);
  if (options.verbose) params.set('verbose', '1');
  return apiRequest(`/api/images/audit?${params}`);
}

export async function getDebugRaw(): Promise<Record<string, unknown>> {
  return apiRequest('/api/debug');
}
