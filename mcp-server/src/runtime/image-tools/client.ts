import { apiRequest } from '../shared/api-client.js';

type ImageToolRequestPatch = {
  effectId?: string;
  paramPreset?: string;
  params?: Record<string, unknown>;
  output?: {
    mode?: 'still' | 'animated';
    format?: string;
    preset?: string;
  };
  timeline?: {
    durationMs?: number;
    fps?: number;
    loop?: boolean;
  };
  renderContext?: {
    seed?: number;
    fps?: number;
    frameIndex?: number;
    time?: number;
  };
};

export type ImageToolRunParams = {
  toolId: string;
  imageId: string;
  request?: ImageToolRequestPatch;
};

export async function listImageTools(): Promise<Record<string, unknown>> {
  return apiRequest('/api/image-tools');
}

export async function startImageToolRun(params: ImageToolRunParams): Promise<Record<string, unknown>> {
  return apiRequest(`/api/image-tools/${encodeURIComponent(params.toolId)}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      imageId: params.imageId,
      request: params.request ?? {},
    }),
  });
}

export async function startImageToolPreview(params: ImageToolRunParams): Promise<Record<string, unknown>> {
  return apiRequest(`/api/image-tools/${encodeURIComponent(params.toolId)}/previews`, {
    method: 'POST',
    body: JSON.stringify({
      imageId: params.imageId,
      request: params.request ?? {},
    }),
  });
}

export async function getImageToolRun(runId: string): Promise<Record<string, unknown>> {
  return apiRequest(`/api/image-tools/runs/${encodeURIComponent(runId)}`);
}

export async function getImageToolPreview(previewId: string): Promise<Record<string, unknown>> {
  return apiRequest(`/api/image-tools/previews/${encodeURIComponent(previewId)}`);
}
