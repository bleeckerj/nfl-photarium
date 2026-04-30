type ImageMetadataPayload = {
  error?: string;
};

type FavoritePayload = {
  success?: boolean;
  favorite?: boolean;
  tags?: string[];
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

export const patchImageFavorite = async (imageId: string, favorite: boolean) => {
  const response = await fetch(`/api/images/${imageId}/favorite`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite })
  });
  const payload = (await response.json().catch(() => ({}))) as FavoritePayload;
  return { ok: response.ok, payload };
};
