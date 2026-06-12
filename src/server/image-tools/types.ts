import type { UploadSuccess } from '@/server/uploadService';
import type { VideoUploadSuccess } from '@/server/videoUploadService';

// 'grainrad-inproc' is the active in-process adapter. 'grainrad-http' is retained
// only so historical provenance records (imageExtras.imageToolRun) still type-check.
export type ImageToolAdapterKind = 'grainrad-inproc' | 'grainrad-http';
export type ImageToolInputAssetType = 'image' | 'video';
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
  adapterKind: ImageToolAdapterKind;
  inputAssetTypes: ImageToolInputAssetType[];
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

export type ImageToolDiagnosticEventInput = {
  level?: ImageToolDiagnosticLevel;
  phase: string;
  message: string;
  details?: Record<string, string | number | boolean | null | undefined>;
};

export type ImageToolRunInput = {
  imageId: string;
  request: Partial<ImageToolRequest> & {
    effectId?: string;
    paramPreset?: string;
    params?: Record<string, unknown>;
    output?: Partial<ImageToolRequest['output']>;
  };
};

export type ImageToolRunResult = {
  uploadedAsset: UploadSuccess | VideoUploadSuccess;
  artifact?: {
    filename?: string;
    contentType?: string;
    url?: string;
  };
  externalJobId?: string;
};

export type ImageToolPreviewResult = {
  artifact: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  };
  externalJobId?: string;
};

export type ImageToolRunRecord = {
  id: string;
  toolId: string;
  imageId: string;
  status: ImageToolRunStatus;
  message: string;
  percent: number;
  createdAt: string;
  updatedAt: string;
  request: ImageToolRequest;
  result?: ImageToolRunResult;
  error?: string;
  externalJobId?: string;
  events: ImageToolDiagnosticEvent[];
};

export type ImageToolAdapter = {
  manifest: ImageToolManifest;
  run: (params: {
    runId: string;
    imageId: string;
    request: ImageToolRequest;
    updateRun: (patch: Partial<Pick<ImageToolRunRecord, 'message' | 'percent' | 'externalJobId'>>) => void;
    addEvent: (event: ImageToolDiagnosticEventInput) => void;
  }) => Promise<ImageToolRunResult>;
  preview?: (params: {
    previewId: string;
    imageId: string;
    request: ImageToolRequest;
    updatePreview: (patch: { message?: string; percent?: number; externalJobId?: string }) => void;
    addEvent: (event: ImageToolDiagnosticEventInput) => void;
  }) => Promise<ImageToolPreviewResult>;
};
