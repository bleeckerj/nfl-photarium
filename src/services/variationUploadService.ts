export type VariationAssetType = 'image' | 'video';

type UploadResponse = {
  results?: Array<{ id?: string; url?: string }>;
  failures?: Array<{
    filename?: string;
    error?: string;
    reason?: string;
    duplicates?: Array<{ filename?: string; folder?: string }>;
  }>;
  skipped?: Array<{ filename?: string; reason?: string }>;
  error?: string;
  duplicates?: Array<{ filename?: string; folder?: string }>;
};

type ImportResponse = {
  data?: string;
  type?: string;
  name?: string;
  originalUrl?: string;
  error?: string;
};

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.ogv', '.ogg'];

const isArchiveFile = (file: File) => {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.key');
};

const inferAssetTypeFromFile = (file: File): VariationAssetType => {
  if (file.type.startsWith('video/')) {
    return 'video';
  }
  if (isArchiveFile(file)) {
    return 'image';
  }

  const lower = file.name.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? 'video' : 'image';
};

const inferAssetTypeFromUrl = (value: string): VariationAssetType => {
  try {
    const parsed = new URL(value);
    const lowerPath = parsed.pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((extension) => lowerPath.endsWith(extension)) ? 'video' : 'image';
  } catch {
    const lowerValue = value.toLowerCase();
    return VIDEO_EXTENSIONS.some((extension) => lowerValue.endsWith(extension)) ? 'video' : 'image';
  }
};

const buildFormData = (params: {
  file: File;
  folder?: string;
  tags?: string;
  namespace?: string;
  parentId: string;
}) => {
  const formData = new FormData();
  formData.append('file', params.file);
  if (params.folder) formData.append('folder', params.folder);
  if (params.tags) formData.append('tags', params.tags);
  if (params.namespace) formData.append('namespace', params.namespace);
  formData.append('parentId', params.parentId);
  return formData;
};

const normalizeSingleResultPayload = (
  response: Response,
  payload: Record<string, unknown>
): { ok: boolean; payload: UploadResponse } => ({
  ok: response.ok,
  payload: response.ok
    ? {
        results: [
          {
            id: typeof payload.id === 'string' ? payload.id : undefined,
            url: typeof payload.url === 'string'
              ? payload.url
              : typeof payload.playbackUrl === 'string'
                ? payload.playbackUrl
                : undefined
          }
        ]
      }
    : {
        error: typeof payload.error === 'string' ? payload.error : 'Upload failed'
      }
});

const base64ToFile = (base64: string, filename: string, mimeType: string) => {
  const byteString = atob(base64);
  const len = byteString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
};

export const uploadVariationFile = async (params: {
  file: File;
  folder?: string;
  tags?: string;
  namespace?: string;
  parentId: string;
}): Promise<{ ok: boolean; payload: UploadResponse }> => {
  const assetType = inferAssetTypeFromFile(params.file);
  const response = await fetch(assetType === 'video' ? '/api/import/page/upload-video' : '/api/upload', {
    method: 'POST',
    body: buildFormData(params),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (assetType === 'video') {
    return normalizeSingleResultPayload(response, payload);
  }
  return { ok: response.ok, payload: payload as UploadResponse };
};

export const uploadVariationUrl = async (params: {
  url: string;
  folder?: string;
  tags?: string;
  namespace?: string;
  parentId: string;
  originalUrl?: string;
}): Promise<{ ok: boolean; payload: UploadResponse }> => {
  const assetType = inferAssetTypeFromUrl(params.url);
  const response = await fetch(assetType === 'video' ? '/api/import/page/upload-video' : '/api/import/page/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      assetType === 'video'
        ? {
            url: params.url,
            folder: params.folder || undefined,
            tags: params.tags || undefined,
            namespace: params.namespace || undefined,
            originalUrl: params.originalUrl || params.url,
            parentId: params.parentId
          }
        : {
            items: [
              {
                clientId: `child-url-${Date.now()}`,
                url: params.url,
                folder: params.folder || undefined,
                tags: params.tags || undefined,
                namespace: params.namespace || undefined,
                originalUrl: params.originalUrl || params.url,
                parentId: params.parentId
              }
            ]
          }
    )
  });
  const payload = await response.json() as Record<string, unknown>;
  if (assetType === 'video') {
    return normalizeSingleResultPayload(response, payload);
  }
  return { ok: response.ok, payload: payload as UploadResponse };
};

export const importVariationFromUrl = async (params: {
  url: string;
}): Promise<{ ok: boolean; payload: ImportResponse; file?: File }> => {
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: params.url })
  });
  const payload = (await response.json()) as ImportResponse;
  if (!response.ok) {
    return { ok: false, payload };
  }
  if (!payload?.data || !payload?.type || !payload?.name) {
    return { ok: false, payload: { error: 'Invalid response from import service' } };
  }
  return {
    ok: true,
    payload,
    file: base64ToFile(String(payload.data), String(payload.name), String(payload.type))
  };
};
