import {
  addImageToolRunEvent,
  completeImageToolRun,
  createImageToolRun,
  failImageToolRun,
  updateImageToolRun,
} from '@/server/image-tools/runStore';
import { getImageToolRegistry } from '@/server/image-tools/registry';
import {
  addImageToolPreviewEvent,
  completeImageToolPreview,
  createImageToolPreview,
  failImageToolPreview,
  updateImageToolPreview,
} from '@/server/image-tools/previewStore';
import { buildImageToolPreviewRequest } from '@/server/image-tools/previewRequest';
import type { ImageToolRunInput } from '@/server/image-tools/types';

const logImageToolEvent = (params: {
  level: 'info' | 'warn' | 'error';
  operation: 'run' | 'preview';
  operationId: string;
  toolId: string;
  imageId: string;
  phase: string;
  message: string;
  externalJobId?: string;
}) => {
  const payload = {
    operation: params.operation,
    operationId: params.operationId,
    toolId: params.toolId,
    imageId: params.imageId,
    phase: params.phase,
    externalJobId: params.externalJobId,
  };
  const prefix = `[image-tools] ${params.operation} ${params.level}`;
  if (params.level === 'error') {
    console.error(prefix, params.message, payload);
  } else if (params.level === 'warn') {
    console.warn(prefix, params.message, payload);
  } else {
    console.info(prefix, params.message, payload);
  }
};

export const startImageToolRun = (toolId: string, input: ImageToolRunInput) => {
  const registry = getImageToolRegistry();
  const adapter = registry.getAdapter(toolId);
  if (!adapter) {
    throw new Error(`Unknown image tool: ${toolId}`);
  }
  if (!input.imageId || typeof input.imageId !== 'string') {
    throw new Error('imageId is required');
  }

  const request = registry.buildRequest(toolId, input.request ?? {});
  const run = createImageToolRun({
    toolId,
    imageId: input.imageId,
    request,
  });
  const startedRun = updateImageToolRun(run.id, {
    status: 'running',
    message: 'Starting',
    percent: 0.01,
  }) ?? run;

  setTimeout(() => {
    void (async () => {
      try {
        const result = await adapter.run({
          runId: run.id,
          imageId: input.imageId,
          request,
          updateRun: (patch) => {
            updateImageToolRun(run.id, {
              status: 'running',
              ...patch,
            });
          },
          addEvent: (event) => {
            addImageToolRunEvent(run.id, event);
            logImageToolEvent({
              level: event.level ?? 'info',
              operation: 'run',
              operationId: run.id,
              toolId,
              imageId: input.imageId,
              phase: event.phase,
              message: event.message,
              externalJobId: event.details?.externalJobId ? String(event.details.externalJobId) : undefined,
            });
          },
        });
        addImageToolRunEvent(run.id, {
          phase: 'run.completed',
          message: 'Image tool run completed',
        });
        completeImageToolRun(run.id, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image tool run failed';
        logImageToolEvent({
          level: 'error',
          operation: 'run',
          operationId: run.id,
          toolId,
          imageId: input.imageId,
          phase: 'run.failed',
          message,
        });
        failImageToolRun(run.id, message);
      }
    })();
  }, 0);

  return startedRun;
};

export const startImageToolPreviewRun = (toolId: string, input: ImageToolRunInput) => {
  const registry = getImageToolRegistry();
  const adapter = registry.getAdapter(toolId);
  if (!adapter) {
    throw new Error(`Unknown image tool: ${toolId}`);
  }
  if (!adapter.preview) {
    throw new Error(`Image tool ${toolId} does not support previews`);
  }
  const previewAdapter = adapter.preview;
  if (!input.imageId || typeof input.imageId !== 'string') {
    throw new Error('imageId is required');
  }

  const request = registry.buildRequest(toolId, input.request ?? {});
  const previewRequest = buildImageToolPreviewRequest(request);
  const preview = createImageToolPreview({
    toolId,
    imageId: input.imageId,
    request: previewRequest,
  });
  const startedPreview = updateImageToolPreview(preview.id, {
    status: 'running',
    message: 'Starting preview',
    percent: 0.01,
  }) ?? preview;

  setTimeout(() => {
    void (async () => {
      try {
        const result = await previewAdapter({
          previewId: preview.id,
          imageId: input.imageId,
          request: previewRequest,
          updatePreview: (patch) => {
            updateImageToolPreview(preview.id, {
              status: 'running',
              ...patch,
            });
          },
          addEvent: (event) => {
            addImageToolPreviewEvent(preview.id, event);
            logImageToolEvent({
              level: event.level ?? 'info',
              operation: 'preview',
              operationId: preview.id,
              toolId,
              imageId: input.imageId,
              phase: event.phase,
              message: event.message,
              externalJobId: event.details?.externalJobId ? String(event.details.externalJobId) : undefined,
            });
          },
        });
        addImageToolPreviewEvent(preview.id, {
          phase: 'preview.completed',
          message: 'Image tool preview completed',
        });
        completeImageToolPreview(preview.id, result.artifact, result.externalJobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image tool preview failed';
        logImageToolEvent({
          level: 'error',
          operation: 'preview',
          operationId: preview.id,
          toolId,
          imageId: input.imageId,
          phase: 'preview.failed',
          message,
        });
        failImageToolPreview(preview.id, message);
      }
    })();
  }, 0);

  return startedPreview;
};
