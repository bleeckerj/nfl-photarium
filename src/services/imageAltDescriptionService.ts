type AltTagResponse = {
  altTag?: string;
  saved?: boolean;
  warning?: string;
  error?: string;
};

type DescriptionResponse = {
  description?: string;
  persistedDescription?: string;
  saved?: boolean;
  error?: string;
};

type DisplayNameResponse = {
  displayName?: string;
  model?: string;
  error?: string;
};

type SemanticTagsResponse = {
  tags?: string[];
  model?: string;
  error?: string;
};

export const requestAltTag = async (imageId: string) => {
  const response = await fetch(`/api/images/${imageId}/alt`, { method: 'POST' });
  const payload = (await response.json()) as AltTagResponse;
  return { ok: response.ok, payload };
};

export const requestDescription = async (imageId: string, existingDescription: string) => {
  const response = await fetch(`/api/images/${imageId}/description`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ existingDescription })
  });
  const payload = (await response.json()) as DescriptionResponse;
  return { ok: response.ok, payload };
};

export const requestDisplayName = async (imageId: string) => {
  const response = await fetch(`/api/images/${imageId}/display-name`, { method: 'POST' });
  const payload = (await response.json()) as DisplayNameResponse;
  return { ok: response.ok, payload };
};

export const requestSemanticTags = async (imageId: string, count: number) => {
  const response = await fetch(`/api/images/${imageId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count })
  });
  const payload = (await response.json()) as SemanticTagsResponse;
  return { ok: response.ok, payload };
};
