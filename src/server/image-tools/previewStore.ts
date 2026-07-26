import { randomUUID } from 'node:crypto';

import type {
  ImageToolDiagnosticEvent,
  ImageToolDiagnosticEventInput,
  ImageToolRequest,
  ImageToolPreviewResult,
} from '@/server/image-tools/types';

export type ImageToolPreviewStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ImageToolPreviewRecord = {
  id: string;
  toolId: string;
  imageId: string;
  status: ImageToolPreviewStatus;
  message: string;
  percent: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  request: ImageToolRequest;
  kind?: 'image' | 'prompt';
  prompt?: string;
  plan?: ImageToolPreviewResult['plan'];
  artifactUrl?: string;
  contentType?: string;
  filename?: string;
  error?: string;
  externalJobId?: string;
  metadata?: Record<string, unknown>;
  events: ImageToolDiagnosticEvent[];
};

type StoredPreview = ImageToolPreviewRecord & {
  artifactBuffer?: Buffer;
};

type PreviewStoreState = {
  previews: Map<string, StoredPreview>;
};

const PREVIEW_STORE_KEY = Symbol.for('photarium.imageTools.previewStore');
const PREVIEW_TTL_MS = 10 * 60 * 1000;

const globalStore = globalThis as typeof globalThis & {
  [PREVIEW_STORE_KEY]?: PreviewStoreState;
};

const state = globalStore[PREVIEW_STORE_KEY] ?? { previews: new Map<string, StoredPreview>() };
if (!globalStore[PREVIEW_STORE_KEY]) {
  globalStore[PREVIEW_STORE_KEY] = state;
}

const now = () => new Date().toISOString();

const buildEvent = (input: ImageToolDiagnosticEventInput): ImageToolDiagnosticEvent => ({
  id: randomUUID(),
  level: input.level ?? 'info',
  phase: input.phase,
  message: input.message,
  createdAt: now(),
  details: input.details
    ? Object.fromEntries(
        Object.entries(input.details).filter((entry): entry is [string, string | number | boolean | null] => (
          entry[1] !== undefined
        ))
      )
    : undefined,
});

const isExpired = (preview: StoredPreview) => Date.parse(preview.expiresAt) <= Date.now();

export const pruneExpiredImageToolPreviews = () => {
  for (const [id, preview] of state.previews.entries()) {
    if (isExpired(preview)) {
      state.previews.delete(id);
    }
  }
};

const publicPreview = (preview: StoredPreview): ImageToolPreviewRecord => {
  return {
    id: preview.id,
    toolId: preview.toolId,
    imageId: preview.imageId,
    status: preview.status,
    message: preview.message,
    percent: preview.percent,
    createdAt: preview.createdAt,
    updatedAt: preview.updatedAt,
    expiresAt: preview.expiresAt,
    request: preview.request,
    kind: preview.kind,
    prompt: preview.prompt,
    plan: preview.plan,
    artifactUrl: preview.artifactUrl,
    contentType: preview.contentType,
    filename: preview.filename,
    error: preview.error,
    externalJobId: preview.externalJobId,
    metadata: preview.metadata,
    events: preview.events,
  };
};

export const createImageToolPreview = (params: {
  toolId: string;
  imageId: string;
  request: ImageToolRequest;
}): ImageToolPreviewRecord => {
  pruneExpiredImageToolPreviews();
  const timestamp = now();
  const preview: StoredPreview = {
    id: randomUUID(),
    toolId: params.toolId,
    imageId: params.imageId,
    status: 'queued',
    message: 'Queued',
    percent: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    request: params.request,
    events: [
      buildEvent({
        phase: 'preview.queued',
        message: 'Image tool preview queued',
        details: { toolId: params.toolId, imageId: params.imageId },
      }),
    ],
  };
  state.previews.set(preview.id, preview);
  return publicPreview(preview);
};

export const getImageToolPreview = (previewId: string): ImageToolPreviewRecord | undefined => {
  pruneExpiredImageToolPreviews();
  const preview = state.previews.get(previewId);
  return preview ? publicPreview(preview) : undefined;
};

export const getImageToolPreviewArtifact = (previewId: string) => {
  pruneExpiredImageToolPreviews();
  const preview = state.previews.get(previewId);
  if (!preview || !preview.artifactBuffer || preview.status !== 'completed') return undefined;
  return {
    buffer: preview.artifactBuffer,
    contentType: preview.contentType || 'application/octet-stream',
    filename: preview.filename || 'image-tool-preview',
  };
};

export const updateImageToolPreview = (
  previewId: string,
  patch: Partial<Omit<ImageToolPreviewRecord, 'id' | 'createdAt' | 'events'>>
): ImageToolPreviewRecord | undefined => {
  const current = state.previews.get(previewId);
  if (!current) return undefined;
  const next = {
    ...current,
    ...patch,
    updatedAt: now(),
  };
  state.previews.set(previewId, next);
  return publicPreview(next);
};

export const addImageToolPreviewEvent = (
  previewId: string,
  input: ImageToolDiagnosticEventInput
): ImageToolPreviewRecord | undefined => {
  const current = state.previews.get(previewId);
  if (!current) return undefined;
  const next = {
    ...current,
    events: [...current.events, buildEvent(input)].slice(-80),
    updatedAt: now(),
  };
  state.previews.set(previewId, next);
  return publicPreview(next);
};

export function completeImageToolPreview(
  previewId: string,
  result: ImageToolPreviewResult,
): ImageToolPreviewRecord | undefined;
/** Preserve the pre-prompt-result artifact signature for existing adapters and tests. */
export function completeImageToolPreview(
  previewId: string,
  artifact: NonNullable<ImageToolPreviewResult['artifact']>,
  externalJobId?: string,
): ImageToolPreviewRecord | undefined;
export function completeImageToolPreview(
  previewId: string,
  resultOrArtifact: ImageToolPreviewResult | NonNullable<ImageToolPreviewResult['artifact']>,
  externalJobId?: string,
) {
  const current = state.previews.get(previewId);
  if (!current) return undefined;
  const result: ImageToolPreviewResult = 'buffer' in resultOrArtifact
    ? { kind: 'image', artifact: resultOrArtifact, externalJobId }
    : resultOrArtifact;
  const next = {
    ...current,
    status: 'completed' as const,
    message: 'Preview ready',
    percent: 1,
    ...(result.artifact ? {
      artifactBuffer: result.artifact.buffer,
      artifactUrl: `/api/image-tools/previews/${encodeURIComponent(previewId)}/artifact`,
      contentType: result.artifact.contentType,
      filename: result.artifact.filename,
    } : {}),
    kind: result.kind,
    prompt: result.prompt,
    plan: result.plan,
    externalJobId: result.externalJobId ?? current.externalJobId,
    metadata: result.metadata,
    updatedAt: now(),
  };
  state.previews.set(previewId, next);
  return publicPreview(next);
}

export const failImageToolPreview = (previewId: string, error: string) => {
  addImageToolPreviewEvent(previewId, {
    level: 'error',
    phase: 'preview.failed',
    message: error,
  });
  return updateImageToolPreview(previewId, {
    status: 'failed',
    message: error,
    percent: 1,
    error,
  });
};
