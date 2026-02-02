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
  parentId: string;
}): Promise<{ ok: boolean; payload: UploadResponse }> => {
  const formData = new FormData();
  formData.append('file', params.file);
  if (params.folder) formData.append('folder', params.folder);
  if (params.tags) formData.append('tags', params.tags);
  formData.append('parentId', params.parentId);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  const payload = (await response.json()) as UploadResponse;
  return { ok: response.ok, payload };
};

export const uploadVariationUrl = async (params: {
  url: string;
  folder?: string;
  tags?: string;
  parentId: string;
  originalUrl?: string;
}): Promise<{ ok: boolean; payload: UploadResponse }> => {
  const response = await fetch('/api/import/page/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [
        {
          clientId: `child-url-${Date.now()}`,
          url: params.url,
          folder: params.folder || undefined,
          tags: params.tags || undefined,
          originalUrl: params.originalUrl || params.url,
          parentId: params.parentId
        }
      ]
    })
  });
  const payload = (await response.json()) as UploadResponse;
  return { ok: response.ok, payload };
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
