import type { UploadSuccess } from '@/server/uploadService';
import type { VideoUploadSuccess } from '@/server/videoUploadService';
import type { CreativeBriefGenerationPlan } from '@/server/creativeBrief';

// 'grainrad-inproc' is the active in-process adapter. 'grainrad-http' is retained
// only so historical provenance records (imageExtras.imageToolRun) still type-check.
export type ImageToolAdapterKind =
  | 'grainrad-inproc'
  | 'grainrad-http'
  | 'grainrad-eight-bit-reinterpretation'
  | 'creative-brief'
  | 'aspect-ratio-provider';
// 'animatedImage' marks tools that preserve the motion of animated image assets
// (GIF / animated WebP) rather than flattening them to their first frame.
export type ImageToolInputAssetType = 'image' | 'video' | 'animatedImage';
export type ImageToolOutputMode = 'still' | 'animated';
export type ImageToolControlType = 'text' | 'textarea' | 'number' | 'slider' | 'switch' | 'select' | 'color';
export type ImageToolRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ImageToolResultState = 'prompt' | 'handoff' | 'running' | 'uploaded' | 'recorded' | 'failed';
export type ImageToolDiagnosticLevel = 'info' | 'warn' | 'error';

export type ImageToolWorkflowMode = 'filter' | 'reinterpretation';

export type ImageToolWorkflow = {
  mode?: ImageToolWorkflowMode;
  styleStrength?: string;
  promptHint?: string;
  colorDepth?: string;
  pixelScale?: string;
};

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
  workflow?: ImageToolWorkflow;
};

export type ImageToolWorkflowManifest = {
  id: string;
  label: string;
  description?: string;
  effectId: string;
  defaultMode?: ImageToolWorkflowMode;
  modes?: ImageToolWorkflowMode[];
  defaultStyleStrength?: string;
  styleStrengths?: string[];
};

export type ImageToolManifest = {
  id: string;
  label: string;
  description: string;
  adapterKind: ImageToolAdapterKind;
  inputAssetTypes: ImageToolInputAssetType[];
  outputModes: ImageToolOutputMode[];
  supportsAsync: boolean;
  resultKinds?: Array<'image' | 'prompt'>;
  presentation: ImageToolPresentation;
  controls: ImageToolControl[];
  workflows?: ImageToolWorkflowManifest[];
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
    workflow?: ImageToolWorkflow;
  };
};

export type ImageToolRunResult = {
  kind?: 'image' | 'prompt';
  state?: ImageToolResultState;
  uploadedAsset?: UploadSuccess | VideoUploadSuccess;
  prompt?: string;
  plan?: CreativeBriefGenerationPlan;
  artifact?: {
    filename?: string;
    contentType?: string;
    url?: string;
  };
  externalJobId?: string;
  metadata?: Record<string, unknown>;
};

export type ImageToolPreviewResult = {
  kind?: 'image' | 'prompt';
  state?: ImageToolResultState;
  prompt?: string;
  plan?: CreativeBriefGenerationPlan;
  artifact?: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  };
  externalJobId?: string;
  metadata?: Record<string, unknown>;
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
  uploadArtifact?: (params: {
    sourceImageId: string;
    sourceFilename: string;
    sourceBuffer: Buffer;
    artifact: NonNullable<ImageToolPreviewResult['artifact']>;
    request: ImageToolRequest;
    metadata?: Record<string, unknown>;
  }) => Promise<UploadSuccess | VideoUploadSuccess>;
};
