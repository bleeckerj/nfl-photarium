async function jsonOrText(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => '');
}

export async function uploadImageToPhotarium({
  apiBase,
  buffer,
  fileName,
  contentType,
  metadata,
}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType || 'image/jpeg' }), fileName);
  form.append('namespace', metadata.namespace);
  if (metadata.folder) form.append('folder', metadata.folder);
  if (metadata.tags?.length) form.append('tags', metadata.tags.join(','));
  if (metadata.description) form.append('description', metadata.description);
  if (metadata.displayName) form.append('displayName', metadata.displayName);
  if (metadata.sourceUrl) form.append('sourceUrl', metadata.sourceUrl);
  if (metadata.originalUrl) form.append('originalUrl', metadata.originalUrl);
  if (metadata.duplicateAction) form.append('duplicateAction', metadata.duplicateAction);

  const response = await fetch(`${apiBase}/api/upload/external`, {
    method: 'POST',
    body: form,
  });
  const payload = await jsonOrText(response);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function uploadVideoToPhotarium({
  apiBase,
  buffer,
  fileName,
  contentType,
  metadata,
}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType || 'video/mp4' }), fileName);
  form.append('namespace', metadata.namespace);
  if (metadata.folder) form.append('folder', metadata.folder);
  if (metadata.tags?.length) form.append('tags', metadata.tags.join(','));
  if (metadata.description) form.append('description', metadata.description);
  if (metadata.displayName) form.append('displayName', metadata.displayName);
  if (metadata.sourceUrl) form.append('sourceUrl', metadata.sourceUrl);
  if (metadata.originalUrl) form.append('originalUrl', metadata.originalUrl);

  const response = await fetch(`${apiBase}/api/import/page/upload-video`, {
    method: 'POST',
    body: form,
  });
  const payload = await jsonOrText(response);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function updatePhotariumImage({ apiBase, imageId, metadata }) {
  const response = await fetch(`${apiBase}/api/images/${imageId}/update`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  const payload = await jsonOrText(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Photarium update failed (${response.status})`);
  }
  return payload;
}

export async function patchPhotariumExtras({ apiBase, imageId, patch }) {
  const response = await fetch(`${apiBase}/api/images/${imageId}/extras`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  const payload = await jsonOrText(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Photarium extras patch failed (${response.status})`);
  }
  return payload;
}
