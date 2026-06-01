import { randomUUID } from 'node:crypto';

import type {
  ImageToolDiagnosticEvent,
  ImageToolDiagnosticEventInput,
  ImageToolRunRecord,
  ImageToolRequest,
  ImageToolRunResult,
} from '@/server/image-tools/types';

type RunStoreState = {
  runs: Map<string, ImageToolRunRecord>;
};

const RUN_STORE_KEY = Symbol.for('photarium.imageTools.runStore');
const globalStore = globalThis as typeof globalThis & {
  [RUN_STORE_KEY]?: RunStoreState;
};

const state = globalStore[RUN_STORE_KEY] ?? { runs: new Map<string, ImageToolRunRecord>() };
if (!globalStore[RUN_STORE_KEY]) {
  globalStore[RUN_STORE_KEY] = state;
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

export const createImageToolRun = (params: {
  toolId: string;
  imageId: string;
  request: ImageToolRequest;
}): ImageToolRunRecord => {
  const timestamp = now();
  const run: ImageToolRunRecord = {
    id: randomUUID(),
    toolId: params.toolId,
    imageId: params.imageId,
    status: 'queued',
    message: 'Queued',
    percent: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    request: params.request,
    events: [
      buildEvent({
        phase: 'run.queued',
        message: 'Image tool run queued',
        details: { toolId: params.toolId, imageId: params.imageId },
      }),
    ],
  };
  state.runs.set(run.id, run);
  return run;
};

export const getImageToolRun = (runId: string): ImageToolRunRecord | undefined => {
  return state.runs.get(runId);
};

export const updateImageToolRun = (
  runId: string,
  patch: Partial<Omit<ImageToolRunRecord, 'id' | 'createdAt'>>
): ImageToolRunRecord | undefined => {
  const current = state.runs.get(runId);
  if (!current) return undefined;
  const next = {
    ...current,
    ...patch,
    updatedAt: now(),
  };
  state.runs.set(runId, next);
  return next;
};

export const addImageToolRunEvent = (
  runId: string,
  input: ImageToolDiagnosticEventInput
): ImageToolRunRecord | undefined => {
  const current = state.runs.get(runId);
  if (!current) return undefined;
  const event = buildEvent(input);
  const next = {
    ...current,
    events: [...current.events, event].slice(-80),
    updatedAt: now(),
  };
  state.runs.set(runId, next);
  return next;
};

export const completeImageToolRun = (runId: string, result: ImageToolRunResult) => {
  return updateImageToolRun(runId, {
    status: 'completed',
    message: 'Completed',
    percent: 1,
    result,
    externalJobId: result.externalJobId,
  });
};

export const failImageToolRun = (runId: string, error: string) => {
  addImageToolRunEvent(runId, {
    level: 'error',
    phase: 'run.failed',
    message: error,
  });
  return updateImageToolRun(runId, {
    status: 'failed',
    message: error,
    percent: 1,
    error,
  });
};
