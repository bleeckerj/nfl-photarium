export const DEMARK_MODES = ['demark', 'metadata'] as const;
export type DemarkMode = (typeof DEMARK_MODES)[number];

export const DEMARK_MODEL_PROFILES = ['default', 'ctrlregen'] as const;
export type DemarkModelProfile = (typeof DEMARK_MODEL_PROFILES)[number];

export const DEMARK_DEVICES = ['auto', 'cpu', 'mps', 'cuda'] as const;
export type DemarkDevice = (typeof DEMARK_DEVICES)[number];

export interface DemarkSettings {
  mode: DemarkMode;
  strength: number;
  steps: number;
  modelProfile: DemarkModelProfile;
  device: DemarkDevice;
  removeAllMetadata: boolean;
}

export interface DemarkInputItem {
  imageId: string;
  sourcePath: string;
  outputPath: string;
}

export interface DemarkWorkerItemResult {
  imageId: string;
  ok: boolean;
  stage?: 'initialize' | 'process' | 'verify';
  error?: string;
  width?: number;
  height?: number;
  aiMetadataPresent?: boolean;
}

export interface DemarkWorkerResponse {
  ok: boolean;
  version?: string;
  error?: string;
  items: DemarkWorkerItemResult[];
}

export interface DemarkSuccessResult {
  imageId: string;
  status: 'succeeded';
  childId: string;
  filename: string;
  displayName: string;
  url: string;
  parentId: string;
  namespace: string;
  dimensions?: { width: number; height: number };
  verification: {
    aiMetadataPresent: false;
    parentLinked: true;
    dimensionsValid: true;
  };
}

export interface DemarkFailureResult {
  imageId: string;
  status: 'failed';
  stage: 'source' | 'download' | 'process' | 'upload' | 'metadata' | 'verify';
  error: string;
  childId?: string;
}

export type DemarkItemResult = DemarkSuccessResult | DemarkFailureResult;

export interface DemarkBatchResult {
  mode: DemarkMode;
  settings: DemarkSettings;
  processed: number;
  succeeded: number;
  failed: number;
  results: DemarkItemResult[];
}
