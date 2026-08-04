export const DEFAULT_IMAGE_EXTENSIONS = [
  '.avif',
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
] as const;

export type ImageExtension = (typeof DEFAULT_IMAGE_EXTENSIONS)[number];

export type ConnectionConfig =
  | {
      mode: 'http';
      baseUrl: string;
    }
  | {
      mode: 'mcp';
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    };

export interface UploaderConfig {
  watchPath: string;
  namespace: string;
  stateFile: string;
  tags: string[];
  connection: ConnectionConfig;
  extensions: string[];
  tagCount: number;
  stability: {
    pollMs: number;
    checks: number;
  };
  retry: {
    maxAttempts: number;
    delayMs: number;
  };
  concurrency: number;
}

export type MetadataStage = 'uploaded' | 'description' | 'tags';

export interface CheckpointEntry {
  namespace: string;
  contentHash: string;
  lastPath: string;
  imageId?: string;
  semanticTagJobId?: string;
  completed: MetadataStage[];
  attempts: number;
  lastError?: string;
  updatedAt: string;
}

export interface Checkpoint {
  version: 1;
  entries: Record<string, CheckpointEntry>;
}

export interface PhotariumUploadResult {
  imageId: string;
  semanticTagging?: {
    jobId: string;
    state: string;
    error?: string;
  };
}

export interface PhotariumClient {
  connect(): Promise<void>;
  uploadFromPath(filePath: string, namespace: string, tags: string[], semanticTagCount?: number): Promise<PhotariumUploadResult>;
  generateDescription(imageId: string): Promise<void>;
  getSemanticTagStatus(jobId: string): Promise<{ state: string; error?: string }>;
  close(): Promise<void>;
}
