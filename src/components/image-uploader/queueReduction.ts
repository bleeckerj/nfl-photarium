import { base64ToFile } from '@/components/image-uploader/fileHelpers';
import type { ImportDimensions, UploaderQueueItem } from '@/features/page-import/types';

export type RemoteQueueImageImport = {
  file: File;
  originalUrl?: string;
  processingNote?: string;
};

export type QueueReductionUpdateInput = {
  target: UploaderQueueItem;
  nextFile: File;
  nextPreviewUrl: string;
  processingNote: string;
  dimensions?: ImportDimensions;
  originalUrl?: string;
};

type RemoteImportPayload = {
  data?: unknown;
  type?: unknown;
  name?: unknown;
  error?: unknown;
  originalUrl?: unknown;
  note?: unknown;
};

const readJsonPayload = async (response: Response): Promise<RemoteImportPayload> => {
  try {
    return (await response.json()) as RemoteImportPayload;
  } catch {
    return {};
  }
};

export async function importRemoteQueueImage(sourceUrl: string): Promise<RemoteQueueImageImport> {
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' && payload.error.trim() ? payload.error : 'Failed to import remote image');
  }

  if (typeof payload.data !== 'string' || typeof payload.type !== 'string' || typeof payload.name !== 'string') {
    throw new Error('Invalid response from import service');
  }

  return {
    file: base64ToFile(payload.data, payload.name, payload.type),
    originalUrl: typeof payload.originalUrl === 'string' ? payload.originalUrl : undefined,
    processingNote: typeof payload.note === 'string' ? payload.note : undefined,
  };
}

export function buildQueueReductionUpdate({
  target,
  nextFile,
  nextPreviewUrl,
  processingNote,
  dimensions,
  originalUrl,
}: QueueReductionUpdateInput): Partial<UploaderQueueItem> {
  return {
    file: nextFile,
    filename: nextFile.name,
    previewUrl: nextPreviewUrl,
    sizeBytes: nextFile.size,
    contentType: nextFile.type,
    originalUrl: target.originalUrl ?? originalUrl,
    processingNote,
    metadata: {
      ...target.metadata,
      status: target.metadata?.status ?? 'resolved',
      fileSizeBytes: nextFile.size,
      contentType: nextFile.type,
      dimensions: dimensions ?? target.metadata?.dimensions,
    },
  };
}
