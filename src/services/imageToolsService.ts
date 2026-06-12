export type ImageToolOutputMode = 'still' | 'animated';
export type ImageToolControlType = 'text' | 'number' | 'slider' | 'switch' | 'select' | 'color';
export type ImageToolRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ImageToolDiagnosticLevel = 'info' | 'warn' | 'error';

export type ImageToolControlOption = {
  value: string | number | boolean;
  label: string;
  helpText?: string;
  effectId?: string;
};

export type ImageToolControl = {
  id: string;
  label: string;
  type: ImageToolControlType;
  defaultValue?: string | number | boolean;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: ImageToolControlOption[];
  helpText?: string;
  group?: string;
  effectIds?: string[];
  advanced?: boolean;
};

export type ImageToolPresentation = {
  thumbnailUrl: string;
  previewUrl?: string;
  previewMimeType?: string;
  shortDescription?: string;
};

export type ImageToolRequest = {
  effectId: string;
  paramPreset?: string;
  params: Record<string, unknown>;
  output: {
    mode: ImageToolOutputMode;
    format: string;
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

export type ImageToolManifest = {
  id: string;
  label: string;
  description: string;
  adapterKind: string;
  inputAssetTypes: string[];
  outputModes: ImageToolOutputMode[];
  supportsAsync: boolean;
  presentation: ImageToolPresentation;
  controls: ImageToolControl[];
  defaultRequest: ImageToolRequest;
};

export type ImageToolDiagnosticEvent = {
  id: string;
  level: ImageToolDiagnosticLevel;
  phase: string;
  message: string;
  createdAt: string;
  details?: Record<string, string | number | boolean | null>;
};

export type ImageToolRun = {
  id: string;
  toolId: string;
  imageId: string;
  status: ImageToolRunStatus;
  message: string;
  percent: number;
  createdAt: string;
  updatedAt: string;
  request: ImageToolRequest;
  result?: {
    uploadedAsset?: {
      id?: string;
      assetType?: 'image' | 'video';
      filename?: string;
      url?: string;
      playbackUrl?: string;
    };
    artifact?: {
      filename?: string;
      contentType?: string;
    };
    externalJobId?: string;
  };
  error?: string;
  externalJobId?: string;
  events: ImageToolDiagnosticEvent[];
};

export type ImageToolPreview = {
  id: string;
  toolId: string;
  imageId: string;
  status: ImageToolRunStatus;
  message: string;
  percent: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  request: ImageToolRequest;
  artifactUrl?: string;
  contentType?: string;
  filename?: string;
  error?: string;
  externalJobId?: string;
  events: ImageToolDiagnosticEvent[];
};

const STATUS_FETCH_TIMEOUT_MS = 15000;
export const IMAGE_TOOL_STATUS_TIMEOUT_MESSAGE = 'Image tool status refresh timed out. The local server may be busy rendering this effect.';

const isAbortError = (error: unknown) => (
  error instanceof DOMException && error.name === 'AbortError'
) || (
  error instanceof Error && error.name === 'AbortError'
);

export const isImageToolTransientStatusError = (error: unknown) => {
  if (isAbortError(error)) return true;
  return error instanceof Error && error.message === IMAGE_TOOL_STATUS_TIMEOUT_MESSAGE;
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = STATUS_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(IMAGE_TOOL_STATUS_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
};

export const listImageTools = async (): Promise<ImageToolManifest[]> => {
  const response = await fetch('/api/image-tools', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load image tools');
  }
  return Array.isArray(payload.tools) ? payload.tools : [];
};

export const startImageToolRun = async (params: {
  toolId: string;
  imageId: string;
  request: ImageToolRequest;
}): Promise<ImageToolRun> => {
  const response = await fetch(`/api/image-tools/${encodeURIComponent(params.toolId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageId: params.imageId,
      request: params.request,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to start image tool run');
  }
  return payload.run as ImageToolRun;
};

export const createImageToolPreview = async (params: {
  toolId: string;
  imageId: string;
  request: ImageToolRequest;
}): Promise<ImageToolPreview> => {
  const response = await fetch(`/api/image-tools/${encodeURIComponent(params.toolId)}/previews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageId: params.imageId,
      request: params.request,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = payload.preview?.error || 'Failed to create image tool preview';
    throw new Error(typeof payload.error === 'string' ? payload.error : fallback);
  }
  return payload.preview as ImageToolPreview;
};

export const getImageToolPreview = async (previewId: string): Promise<ImageToolPreview> => {
  const response = await fetchWithTimeout(`/api/image-tools/previews/${encodeURIComponent(previewId)}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load image tool preview');
  }
  return payload.preview as ImageToolPreview;
};

export const getImageToolRun = async (runId: string): Promise<ImageToolRun> => {
  const response = await fetchWithTimeout(`/api/image-tools/runs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load image tool run');
  }
  return payload.run as ImageToolRun;
};
