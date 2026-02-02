type ImageMetadataPayload = {
  error?: string;
};

export const patchImageMetadata = async (imageId: string, body: Record<string, unknown>) => {
  const response = await fetch(`/api/images/${imageId}/update`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as ImageMetadataPayload;
  return { ok: response.ok, payload };
};
